#!/usr/bin/env bash
# setup-env.sh — BotParty environment wizard
#
# Generates .env and (optionally) updates nginx.conf for HTTPS.
# Run once before the first `docker compose up -d`.
# Safe to re-run: asks before overwriting an existing .env.
#
# Usage:
#   bash setup-env.sh

set -euo pipefail

# ─── helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "  ${CYAN}→${RESET} $*"; }
success() { echo -e "  ${GREEN}✔${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}!${RESET} $*"; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }
die()     { echo -e "\n${RED}Error:${RESET} $*" >&2; exit 1; }

ask() {
  # ask <var_name> <prompt> [default]
  local var="$1" prompt="$2" default="${3:-}"
  local hint=""
  [[ -n "$default" ]] && hint=" [${default}]"
  printf "  %s%s: " "$prompt" "$hint"
  read -r answer || answer=""
  [[ -z "$answer" && -n "$default" ]] && answer="$default"
  printf -v "$var" '%s' "$answer"
}

ask_yn() {
  # ask_yn <prompt> [y|n]  → sets $REPLY_YN to "y" or "n"
  local prompt="$1" default="${2:-n}"
  local hint="[y/n]"
  [[ "$default" == "y" ]] && hint="[Y/n]" || hint="[y/N]"
  while true; do
    printf "  %s %s: " "$prompt" "$hint"
    read -r answer || answer="$default"
    [[ -z "$answer" ]] && answer="$default"
    case "$answer" in
      y|Y|yes|YES) REPLY_YN="y"; return ;;
      n|N|no|NO)   REPLY_YN="n"; return ;;
      *) echo "    Please answer y or n." ;;
    esac
  done
}

gen_secret() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  elif command -v dd &>/dev/null; then
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | xxd -p | tr -d '\n'
  else
    die "Cannot generate secrets: openssl not found. Install openssl and try again."
  fi
}

# ─── start ────────────────────────────────────────────────────────────────────

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║         BotParty  –  setup wizard        ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  This script generates your .env file and sets"
echo "  up nginx for HTTPS if needed."
echo ""

# Existing .env check
if [[ -f ".env" ]]; then
  warn ".env already exists."
  ask_yn "Overwrite it?" "n"
  [[ "$REPLY_YN" == "n" ]] && echo -e "\n  Cancelled.\n" && exit 0
fi

# ─── 1. Deployment type ───────────────────────────────────────────────────────

header "1 / 4  Deployment type"
echo ""
echo "  (1) Local development  — everything on localhost, no SSL needed"
echo "  (2) Server / VPS       — public URL, optional HTTPS"
echo ""
printf "  Choose [1/2]: "
read -r DEPLOY_TYPE
[[ -z "$DEPLOY_TYPE" ]] && DEPLOY_TYPE="1"

IS_LOCAL="n"
[[ "$DEPLOY_TYPE" == "1" ]] && IS_LOCAL="y"

# ─── 2. Domain / URLs ─────────────────────────────────────────────────────────

header "2 / 4  URLs"
echo ""

if [[ "$IS_LOCAL" == "y" ]]; then
  API_URL="http://localhost:4000"
  WS_URL="ws://localhost:4000"
  LIVEKIT_URL="ws://localhost:7880"
  LIVEKIT_EXT_URL="ws://localhost:7880"
  APP_URL="http://localhost:3000"
  SMTP_HOST="localhost"
  SMTP_PORT="1025"
  SMTP_SECURE="false"
  SMTP_USER=""
  SMTP_PASSWORD=""
  SMTP_FROM="BotParty <no-reply@localhost>"
  CORS_ORIGIN="http://localhost:3000"
  success "Using localhost defaults."
  NGINX_CONF_VALUE=./docker/nginx/nginx.conf
else
  ask DOMAIN "Your domain (e.g. botparty.live)"
  [[ -z "$DOMAIN" ]] && die "Domain is required for server deployment."

  # SSL choice
  echo ""
  echo "  SSL / HTTPS:"
  echo "  (1) HTTP only — no SSL (not recommended for production)"
  echo "  (2) Let's Encrypt — free cert via certbot"
  echo "  (3) Own certificate — you already have fullchain.pem + privkey.pem"
  echo ""
  printf "  Choose [1/2/3]: "
  read -r SSL_CHOICE
  [[ -z "$SSL_CHOICE" ]] && SSL_CHOICE="1"

  case "$SSL_CHOICE" in
    2|3) PROTO="https"; WS_PROTO="wss"; USE_SSL="y" ;;
    *)   PROTO="http";  WS_PROTO="ws";  USE_SSL="n" ;;
  esac
  [[ "$USE_SSL" == "y" ]] && NGINX_CONF_VALUE=./docker/nginx/nginx.ssl.conf || NGINX_CONF_VALUE=./docker/nginx/nginx.conf

  API_URL="${PROTO}://${DOMAIN}/api"
  WS_URL="${WS_PROTO}://${DOMAIN}"
  APP_URL="${PROTO}://${DOMAIN}"
  CORS_ORIGIN="${PROTO}://${DOMAIN}"

  # LiveKit is accessed directly by robot clients and the browser.
  # If nginx doesn't proxy it, clients need the direct port.
  ask LIVEKIT_HOST "LiveKit public host" "$DOMAIN"
  LIVEKIT_URL="${WS_PROTO}://${LIVEKIT_HOST}:7880"
  LIVEKIT_EXT_URL="${WS_PROTO}://${LIVEKIT_HOST}:7880"

  echo ""
  ask SMTP_HOST "SMTP host" "smtp.example.com"
  ask SMTP_PORT "SMTP port" "587"
  ask SMTP_SECURE "SMTP secure (true/false)" "false"
  ask SMTP_USER "SMTP username" ""
  ask SMTP_PASSWORD "SMTP password" ""
  ask SMTP_FROM "SMTP from address" "BotParty <no-reply@${DOMAIN}>"
fi

# ─── 3. Secrets ───────────────────────────────────────────────────────────────

header "3 / 4  Secrets"
echo ""
info "Generating random secrets..."

JWT_SECRET=$(gen_secret)
JWT_REFRESH_SECRET=$(gen_secret)
DB_PASSWORD=$(gen_secret | head -c 24)
REDIS_PASSWORD=$(gen_secret | head -c 24)

# LiveKit secrets — user can override with existing key/secret
echo ""
ask LIVEKIT_API_KEY   "LiveKit API key (leave empty to generate)" ""
ask LIVEKIT_API_SECRET "LiveKit API secret (leave empty to generate)" ""

[[ -z "$LIVEKIT_API_KEY" ]]    && LIVEKIT_API_KEY="botparty-$(gen_secret | head -c 8)"
[[ -z "$LIVEKIT_API_SECRET" ]] && LIVEKIT_API_SECRET=$(gen_secret)

# Seed admin password
echo ""
ask SEED_ADMIN_PASSWORD "Demo admin password (for the seeded admin@botparty.live account)" "admin123456"

success "Secrets ready."

# ─── 4. Write .env ────────────────────────────────────────────────────────────

header "4 / 4  Writing .env"
echo ""

cat > .env <<EOF
# Generated by setup-env.sh on $(date -u '+%Y-%m-%d %H:%M UTC')
# Re-run  bash setup-env.sh  to regenerate.

# ─── General ──────────────────────────────────────────
NODE_ENV=production
PORT=4000

# ─── Database ─────────────────────────────────────────
# DB_PASSWORD is read directly by docker-compose for the postgres container.
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://botparty:${DB_PASSWORD}@postgres:5432/botparty?schema=public

# ─── Redis ────────────────────────────────────────────
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}

# ─── JWT / Auth ───────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_REFRESH_EXPIRES_IN=7d
PASSWORD_RESET_TTL_SEC=3600

# ─── Email / Password Reset ───────────────────────────
APP_URL=${APP_URL}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
SMTP_FROM=${SMTP_FROM}

# ─── LiveKit ──────────────────────────────────────────
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_URL=${LIVEKIT_URL}

# ─── Frontend ─────────────────────────────────────────
NEXT_PUBLIC_API_URL=${API_URL}
NEXT_PUBLIC_WS_URL=${WS_URL}
NEXT_PUBLIC_LIVEKIT_URL=${LIVEKIT_EXT_URL}

# ─── CORS ─────────────────────────────────────────────
CORS_ORIGIN=${CORS_ORIGIN}

# ─── Rate Limiting ─────────────────────────────────────
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# ─── Seeding ──────────────────────────────────────────
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}

# ─── nginx ────────────────────────────────────────────
# For HTTPS production: ./docker/nginx/nginx.ssl.conf (generated below, gitignored)
# For local dev:        ./docker/nginx/nginx.conf
NGINX_CONF=${NGINX_CONF_VALUE}
EOF

success ".env written."

# ─── nginx: HTTPS setup ───────────────────────────────────────────────────────

if [[ "${USE_SSL:-n}" == "y" ]]; then
  echo ""
  header "  HTTPS / nginx setup"
  echo ""

  SSL_DIR="docker/nginx/ssl"
  mkdir -p "$SSL_DIR"

  case "${SSL_CHOICE:-1}" in
    2)
      # Let's Encrypt
      echo "  To get a certificate from Let's Encrypt:"
      echo ""
      echo "    1. Make sure port 80 is reachable from the internet."
      echo "       (Stop any existing nginx first if it's running.)"
      echo ""
      echo "    2. Install certbot if you haven't already:"
      echo "         sudo apt install certbot           # Debian/Ubuntu"
      echo "         brew install certbot               # macOS"
      echo ""
      echo "    3. Get the certificate:"
      echo "         sudo certbot certonly --standalone -d ${DOMAIN}"
      echo ""
      echo "    4. Copy the certificates here:"
      echo "         sudo cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem docker/nginx/ssl/"
      echo "         sudo cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem   docker/nginx/ssl/"
      echo "         sudo chown \$USER docker/nginx/ssl/*.pem"
      echo ""
      echo "    5. For auto-renewal, add to crontab:"
      echo "         0 3 * * * certbot renew --quiet && \\"
      echo "           cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem $(pwd)/docker/nginx/ssl/ && \\"
      echo "           cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem   $(pwd)/docker/nginx/ssl/ && \\"
      echo "           docker compose -f $(pwd)/docker-compose.yml exec nginx nginx -s reload"
      echo ""
      ;;
    3)
      # Own cert
      echo "  Copy your certificates to docker/nginx/ssl/:"
      echo "    docker/nginx/ssl/fullchain.pem"
      echo "    docker/nginx/ssl/privkey.pem"
      echo ""
      if [[ -f "$SSL_DIR/fullchain.pem" && -f "$SSL_DIR/privkey.pem" ]]; then
        success "Certificates already present in $SSL_DIR/"
      else
        warn "Certificates not found yet. Put them there before starting nginx."
      fi
      ;;
  esac

  # Generate nginx.ssl.conf from the template (this file is gitignored).
  # git pull never touches it, so production config survives deploys.
  NGINX_TEMPLATE="docker/nginx/nginx.ssl.conf.template"
  if [[ -f "$NGINX_TEMPLATE" ]]; then
    sed "s/__DOMAIN__/${DOMAIN}/g" "$NGINX_TEMPLATE" > docker/nginx/nginx.ssl.conf
    success "Generated docker/nginx/nginx.ssl.conf for ${DOMAIN}."
    info "LiveKit signaling will be proxied on /rtc and /twirp via nginx."
  else
    warn "Template $NGINX_TEMPLATE not found — nginx will use the default HTTP config."
  fi
fi

# ─── done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║               All done!                  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

if [[ "$IS_LOCAL" == "y" ]]; then
  echo "  Start everything:"
  echo ""
  echo "    docker compose up -d postgres redis livekit mailpit"
  echo "    pnpm dev"
  echo ""
  echo "  Or full Docker stack:"
  echo ""
  echo "    docker compose up -d --build"
  echo ""
  echo "  Frontend:  http://localhost:3000"
  echo "  API:       http://localhost:4000"
  echo "  Swagger:   http://localhost:4000/docs"
  echo "  Mailpit:   http://localhost:8025"
else
  if [[ "${USE_SSL:-n}" == "y" ]]; then
    echo "  Once certificates are in place:"
  fi
  echo "  Start the stack:"
  echo ""
  echo "    docker compose up -d --build"
  echo ""
  echo "  Site:  ${APP_URL}"
  echo "  API:   ${API_URL}"
fi

echo ""
echo "  Demo login (seeded on first start):"
echo "    admin@botparty.live  /  ${SEED_ADMIN_PASSWORD}"
echo ""
