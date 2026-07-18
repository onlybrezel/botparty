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
echo "  (2) Server / VPS       — public URL with HTTPS"
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
  LIVEKIT_URL="ws://livekit:7880"
  LIVEKIT_EXT_URL="ws://localhost:7880"
  APP_URL="http://localhost:3000"
  SMTP_HOST=""
  SMTP_PORT="587"
  SMTP_SECURE="false"
  SMTP_USER=""
  SMTP_PASSWORD=""
  SMTP_FROM="BotParty <no-reply@localhost>"
  ALERTMANAGER_WEBHOOK_URL=""
  CORS_ORIGIN="http://localhost:3000"
  success "Using localhost defaults. SMTP is disabled unless you configure it manually."
  NGINX_CONF_VALUE=./docker/nginx/nginx.conf
else
  ask DOMAIN "Your domain (e.g. botparty.live)"
  [[ -z "$DOMAIN" ]] && die "Domain is required for server deployment."

  # SSL choice
  echo ""
  echo "  SSL / HTTPS:"
  echo "  (1) Let's Encrypt — free cert via certbot"
  echo "  (2) Own certificate — you already have fullchain.pem + privkey.pem"
  echo ""
  printf "  Choose [1/2]: "
  read -r SSL_CHOICE
  [[ -z "$SSL_CHOICE" ]] && SSL_CHOICE="1"

  [[ "$SSL_CHOICE" == "1" || "$SSL_CHOICE" == "2" ]] || die "Choose 1 or 2."
  PROTO="https"; WS_PROTO="wss"; USE_SSL="y"
  NGINX_CONF_VALUE=./docker/nginx/nginx.ssl.conf

  API_URL="${PROTO}://${DOMAIN}/api"
  WS_URL="${WS_PROTO}://${DOMAIN}"
  APP_URL="${PROTO}://${DOMAIN}"
  CORS_ORIGIN="${PROTO}://${DOMAIN}"

  # Internal services should use the Docker service name.
  # Public clients connect through nginx on /rtc.
  LIVEKIT_URL="ws://livekit:7880"
  LIVEKIT_EXT_URL="${WS_PROTO}://${DOMAIN}/rtc"

  echo ""
  ask SMTP_HOST "SMTP host" "smtp.example.com"
  ask SMTP_PORT "SMTP port" "587"
  ask SMTP_SECURE "SMTP secure (true/false)" "false"
  ask SMTP_USER "SMTP username" ""
  ask SMTP_PASSWORD "SMTP password" ""
  ask SMTP_FROM "SMTP from address" "BotParty <no-reply@${DOMAIN}>"
  [[ -n "$SMTP_HOST" && -n "$SMTP_FROM" ]] || die "SMTP host and from address are required for server deployments."

  ask ALERTMANAGER_WEBHOOK_URL "Alert webhook URL"
  [[ "$ALERTMANAGER_WEBHOOK_URL" == http://* || "$ALERTMANAGER_WEBHOOK_URL" == https://* ]] || die "A valid alert webhook URL is required for server deployments."

  echo ""
  ask LEGAL_OPERATOR_NAME "Legal operator name"
  ask LEGAL_OPERATOR_EMAIL "Legal operator email"
  ask LEGAL_OPERATOR_ADDRESS "Legal operator postal address"
  ask LEGAL_OPERATOR_COUNTRY "Operator country" "Germany"
  ask LEGAL_GOVERNING_LAW "Governing law" "$LEGAL_OPERATOR_COUNTRY"
  [[ -n "$LEGAL_OPERATOR_NAME" && -n "$LEGAL_OPERATOR_EMAIL" && -n "$LEGAL_OPERATOR_ADDRESS" ]] || die "Complete legal operator details are required."
fi

if [[ "$IS_LOCAL" == "y" ]]; then
  LEGAL_OPERATOR_NAME="Local development"
  LEGAL_OPERATOR_EMAIL="developer@localhost.invalid"
  LEGAL_OPERATOR_ADDRESS="Local development environment"
  LEGAL_OPERATOR_COUNTRY="Germany"
  LEGAL_GOVERNING_LAW="Germany"
fi

# ─── 3. Secrets ───────────────────────────────────────────────────────────────

header "3 / 4  Secrets"
echo ""
info "Generating random secrets..."

JWT_SECRET=$(gen_secret)
JWT_REFRESH_SECRET=$(gen_secret)
ROBOT_JWT_SECRET=$(gen_secret)
WEBHOOK_SECRET_ENCRYPTION_KEY=$(gen_secret)
PAYOUT_DESTINATION_ENCRYPTION_KEY=$(gen_secret)
METRICS_PASSWORD=$(gen_secret)
DB_PASSWORD=$(gen_secret | head -c 24)
REDIS_PASSWORD=$(gen_secret | head -c 24)
MINIO_ROOT_USER=botpartyminio
MINIO_ROOT_PASSWORD=$(gen_secret | head -c 24)

# LiveKit secrets — user can override with existing key/secret
echo ""
ask LIVEKIT_API_KEY   "LiveKit API key (leave empty to generate)" ""
ask LIVEKIT_API_SECRET "LiveKit API secret (leave empty to generate)" ""

[[ -z "$LIVEKIT_API_KEY" ]]    && LIVEKIT_API_KEY="botparty-$(gen_secret | head -c 8)"
[[ -z "$LIVEKIT_API_SECRET" ]] && LIVEKIT_API_SECRET=$(gen_secret)

# Optional initial administrator
echo ""
ask SEED_ADMIN_EMAIL "Initial admin email (leave empty to skip)" ""
SEED_ADMIN_PASSWORD=""
if [[ -n "$SEED_ADMIN_EMAIL" ]]; then
  ask SEED_ADMIN_PASSWORD "Initial admin password (minimum 16 characters)" ""
  [[ ${#SEED_ADMIN_PASSWORD} -ge 16 ]] || die "Initial admin password must contain at least 16 characters."
fi

success "Secrets ready."

# ─── 4. Write .env ────────────────────────────────────────────────────────────

header "4 / 4  Writing .env"
echo ""

[[ "$IS_LOCAL" == "y" ]] && APP_ENVIRONMENT=development || APP_ENVIRONMENT=production

SECRET_DIR="docker/secrets"
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"
write_secret() {
  printf '%s' "$2" > "${SECRET_DIR}/$1"
  chmod 600 "${SECRET_DIR}/$1"
}
write_secret db_password "$DB_PASSWORD"
write_secret api_database_url "postgresql://botparty:${DB_PASSWORD}@postgres:5432/botparty?schema=public&connection_limit=10&pool_timeout=30"
write_secret redis_password "$REDIS_PASSWORD"
write_secret minio_root_password "$MINIO_ROOT_PASSWORD"
write_secret jwt_secret "$JWT_SECRET"
write_secret jwt_refresh_secret "$JWT_REFRESH_SECRET"
write_secret robot_jwt_secret "$ROBOT_JWT_SECRET"
write_secret webhook_secret_encryption_key "$WEBHOOK_SECRET_ENCRYPTION_KEY"
write_secret payout_destination_encryption_key "$PAYOUT_DESTINATION_ENCRYPTION_KEY"
write_secret livekit_api_secret "$LIVEKIT_API_SECRET"
write_secret metrics_password "$METRICS_PASSWORD"
write_secret smtp_password "$SMTP_PASSWORD"
write_secret alertmanager_webhook_url "$ALERTMANAGER_WEBHOOK_URL"
write_secret seed_admin_password "$SEED_ADMIN_PASSWORD"
write_secret seed_demo_user_password ""

cat > .env <<EOF
# Generated by setup-env.sh on $(date -u '+%Y-%m-%d %H:%M UTC')
# Re-run  bash setup-env.sh  to regenerate.

# ─── General ──────────────────────────────────────────
NODE_ENV=${APP_ENVIRONMENT}
PUBLIC_DEPLOYMENT=$([[ "$IS_LOCAL" == "y" ]] && printf false || printf true)
PORT=4000

# ─── Database ─────────────────────────────────────────
DATABASE_URL_FILE=/run/secrets/api_database_url

# ─── Redis ────────────────────────────────────────────
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD_FILE=/run/secrets/redis_password

# ─── JWT / Auth ───────────────────────────────────────
JWT_SECRET_FILE=/run/secrets/jwt_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET_FILE=/run/secrets/jwt_refresh_secret
ROBOT_JWT_SECRET_FILE=/run/secrets/robot_jwt_secret
WEBHOOK_SECRET_ENCRYPTION_KEY_FILE=/run/secrets/webhook_secret_encryption_key
PAYOUT_DESTINATION_ENCRYPTION_KEY_FILE=/run/secrets/payout_destination_encryption_key
JWT_REFRESH_EXPIRES_IN=7d
AUTH_COOKIE_SAMESITE=Strict
AUTH_COOKIE_SECURE=$([[ "$IS_LOCAL" == "y" ]] && printf false || printf true)
PASSWORD_RESET_TTL_SEC=3600

# ─── Email / Password Reset ───────────────────────────
APP_URL=${APP_URL}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD_FILE=/run/secrets/smtp_password
SMTP_FROM=${SMTP_FROM}

# ─── LiveKit ──────────────────────────────────────────
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET_FILE=/run/secrets/livekit_api_secret
LIVEKIT_URL=${LIVEKIT_URL}
LIVEKIT_WHIP_BASE_URL=${APP_URL}/whip

# ─── Frontend ─────────────────────────────────────────
NEXT_PUBLIC_API_URL=${API_URL}
NEXT_PUBLIC_WS_URL=${WS_URL}
NEXT_PUBLIC_LIVEKIT_URL=${LIVEKIT_EXT_URL}
NEXT_PUBLIC_APP_URL=${APP_URL}
NEXT_PUBLIC_LEGAL_OPERATOR_NAME=${LEGAL_OPERATOR_NAME}
NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL=${LEGAL_OPERATOR_EMAIL}
NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS=${LEGAL_OPERATOR_ADDRESS}
NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY=${LEGAL_OPERATOR_COUNTRY}
NEXT_PUBLIC_LEGAL_GOVERNING_LAW=${LEGAL_GOVERNING_LAW}

# ─── CORS ─────────────────────────────────────────────
CORS_ORIGIN=${CORS_ORIGIN}

# ─── Rate Limiting ─────────────────────────────────────
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# ─── Thumbnail Storage ────────────────────────────────
THUMBNAIL_PUBLIC_BASE_URL=${APP_URL}/storage/botparty-thumbnails
THUMBNAIL_S3_BUCKET=botparty-thumbnails
THUMBNAIL_S3_REGION=us-east-1
THUMBNAIL_S3_ENDPOINT=http://minio:9000
THUMBNAIL_S3_ACCESS_KEY_ID=${MINIO_ROOT_USER}
THUMBNAIL_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/minio_root_password
THUMBNAIL_S3_FORCE_PATH_STYLE=true

# ─── Recording Storage ────────────────────────────────
LIVEKIT_RECORDING_OBJECT_KEY_TEMPLATE=sessions/{session_id}/{camera_id}-{time}.mp4
LIVEKIT_RECORDINGS_S3_BUCKET=botparty-recordings
LIVEKIT_RECORDINGS_S3_REGION=us-east-1
LIVEKIT_RECORDINGS_S3_ENDPOINT=http://minio:9000
LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID=${MINIO_ROOT_USER}
LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/minio_root_password
LIVEKIT_RECORDINGS_S3_FORCE_PATH_STYLE=true

# ─── MinIO / Object Storage ──────────────────────────
MINIO_ROOT_USER=${MINIO_ROOT_USER}

# ─── Metrics ─────────────────────────────────────────
METRICS_AUTH_REQUIRED=true
METRICS_USERNAME=metrics
METRICS_PASSWORD_FILE=/run/secrets/metrics_password

# ─── Seeding ──────────────────────────────────────────
SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
SEED_ADMIN_PASSWORD_FILE=/run/secrets/seed_admin_password

# ─── Release gates (fail closed) ──────────────────────
FEATURE_BILLING_ENABLED=false
FEATURE_DONATIONS_ENABLED=false
FEATURE_PAYOUTS_ENABLED=false
FEATURE_PAID_CONTROLS_ENABLED=false
FEATURE_SUBSCRIPTIONS_ENABLED=false
NEXT_PUBLIC_FEATURE_BILLING=false
NEXT_PUBLIC_FEATURE_DONATIONS=false
NEXT_PUBLIC_FEATURE_PAYOUTS=false
NEXT_PUBLIC_FEATURE_PAID_CONTROLS=false

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
    1)
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
    2)
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
  echo "    docker compose up -d postgres redis livekit"
  echo "    pnpm dev"
  echo ""
  echo "  Or full Docker stack:"
  echo ""
  echo "    docker compose up -d --build"
  echo ""
  echo "  Frontend:  http://localhost:3000"
  echo "  API:       http://localhost:4000"
  echo "  Swagger:   http://localhost:4000/docs"
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
