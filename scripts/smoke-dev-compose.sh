#!/usr/bin/env bash
set -euo pipefail

PROJECT="botparty-dev-smoke-$$"
SECRET_DIR="$(mktemp -d)"
SOURCE_DIR="$(mktemp -d)"
COMPOSE=(
  docker compose -p "${PROJECT}"
  -f docker-compose.yml
  -f docker-compose.dev.yml
  -f docker-compose.smoke.yml
)

export BOTPARTY_SECRET_DIR="${SECRET_DIR}"
export LIVEKIT_API_KEY="botparty-dev-smoke"
export POSTGRES_HOST_PORT=0
export REDIS_HOST_PORT=0
export MINIO_API_HOST_PORT=0
export MINIO_CONSOLE_HOST_PORT=0
export API_HOST_PORT=0
export WEB_HOST_PORT=0
export API_SOURCE_DIR="${SOURCE_DIR}/api"
export WEB_SOURCE_DIR="${SOURCE_DIR}/web"
export APP_URL=http://web:3000
export CORS_ORIGIN=http://127.0.0.1
export NEXT_PUBLIC_APP_URL=http://127.0.0.1
export NEXT_PUBLIC_API_URL=http://127.0.0.1/api
export NEXT_PUBLIC_WS_URL=ws://127.0.0.1
export NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880
export NEXT_PUBLIC_LEGAL_OPERATOR_NAME='BotParty Test Operator'
export NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL='legal@botparty.test'
export NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS='Teststrasse 1, 10115 Berlin'

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${SECRET_DIR}" "${SOURCE_DIR}"
}
trap cleanup EXIT

mkdir -p "${API_SOURCE_DIR}" "${WEB_SOURCE_DIR}"
cp -a apps/api/src/. "${API_SOURCE_DIR}/"
cp -a apps/web/src/. "${WEB_SOURCE_DIR}/"

write_secret() {
  printf '%s' "$2" > "${SECRET_DIR}/$1"
  chmod 600 "${SECRET_DIR}/$1"
}

write_secret db_password 'dev-smoke-database-password'
write_secret api_database_url 'postgresql://botparty:dev-smoke-database-password@postgres:5432/botparty?schema=public'
write_secret redis_password 'dev-smoke-redis-password'
write_secret minio_root_password 'dev-smoke-minio-password'
write_secret livekit_api_secret 'dev-smoke-livekit-secret-at-least-32-characters'
write_secret jwt_secret 'dev-smoke-jwt-secret-at-least-32-characters'
write_secret jwt_refresh_secret 'dev-smoke-refresh-secret-at-least-32-characters'
write_secret robot_jwt_secret 'dev-smoke-robot-secret-at-least-32-characters'
write_secret webhook_secret_encryption_key 'dev-smoke-webhook-key-at-least-32-characters'
write_secret payout_destination_encryption_key 'dev-smoke-payout-key-at-least-32-characters'
write_secret metrics_password 'dev-smoke-metrics-password'
write_secret smtp_password ''
write_secret seed_admin_password ''
write_secret seed_demo_user_password ''

wait_for_health() {
  local service="$1"
  local container="${PROJECT}-${service}-1"
  local state
  for _ in $(seq 1 120); do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || true)"
    if [[ "${state}" == healthy ]]; then
      return 0
    fi
    if [[ "${state}" == exited || "${state}" == dead ]]; then
      break
    fi
    sleep 1
  done
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --no-color "${service}"
  return 1
}

wait_for_reload() {
  local service="$1"
  local source_file="$2"
  local log_pattern="$3"
  local probe_url="${4:-}"
  local container="${PROJECT}-${service}-1"
  local first_new_line
  first_new_line="$(( $(docker logs "${container}" 2>&1 | wc -l) + 1 ))"

  # The smoke uses isolated source copies, so a real content change is safe and
  # verifies the watcher behavior more accurately than an mtime-only touch.
  printf '\n' >> "${source_file}"
  for _ in $(seq 1 30); do
    if [[ -n "${probe_url}" ]]; then
      curl --fail --silent "${probe_url}" >/dev/null 2>&1 || true
    fi
    if docker logs "${container}" 2>&1 \
      | tail -n "+${first_new_line}" \
      | grep -Eq "${log_pattern}"; then
      return 0
    fi
    sleep 1
  done

  docker logs "${container}" 2>&1 | tail -n "+${first_new_line}"
  echo "${service} did not reload after its mounted source changed." >&2
  return 1
}

wait_for_web_reload() {
  local source_file="$1"
  local probe_url="$2"
  local marker='botparty-dev-reload-marker'

  if ! grep -q 'Real robots\.' "${source_file}"; then
    echo 'Web reload fixture text was not found.' >&2
    return 1
  fi
  sed -i "0,/Real robots\\./s//Real robots. ${marker}/" "${source_file}"

  for _ in $(seq 1 60); do
    if curl --fail --silent "${probe_url}" | grep -q "${marker}"; then
      return 0
    fi
    sleep 1
  done

  docker logs "${PROJECT}-web-1" 2>&1 | tail -n 100
  echo 'web did not serve its mounted source change.' >&2
  return 1
}

"${COMPOSE[@]}" config --quiet
if [[ "${DEV_COMPOSE_SKIP_BUILD:-false}" != true ]]; then
  "${COMPOSE[@]}" build api web
fi

"${COMPOSE[@]}" up -d postgres redis minio livekit-config livekit
wait_for_health postgres
wait_for_health redis
wait_for_health livekit

"${COMPOSE[@]}" up -d --no-deps api
wait_for_health api
"${COMPOSE[@]}" up -d --no-deps web
wait_for_health web

api_port="$("${COMPOSE[@]}" port api 4000 | awk -F: 'END { print $NF }')"
web_port="$("${COMPOSE[@]}" port web 3000 | awk -F: 'END { print $NF }')"
curl --fail --silent --show-error "http://127.0.0.1:${api_port}/api/v1/health/live" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${web_port}/" >/dev/null

api_mounts="$(docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "${PROJECT}-api-1")"
web_mounts="$(docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "${PROJECT}-web-1")"
grep -qx '/app/apps/api/src' <<<"${api_mounts}"
grep -qx '/app/apps/web/src' <<<"${web_mounts}"
grep -q '"dev"' <<<"$(docker inspect -f '{{json .Config.Cmd}}' "${PROJECT}-api-1")"
grep -q '"dev"' <<<"$(docker inspect -f '{{json .Config.Cmd}}' "${PROJECT}-web-1")"

wait_for_reload api "${API_SOURCE_DIR}/main.ts" 'File change detected|Starting incremental compilation'
wait_for_health api
wait_for_web_reload "${WEB_SOURCE_DIR}/app/page.tsx" "http://127.0.0.1:${web_port}/"
wait_for_health web

echo 'Development Compose runtime smoke passed.'
