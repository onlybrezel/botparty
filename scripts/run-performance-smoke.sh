#!/usr/bin/env bash
set -euo pipefail

PROJECT="botparty-performance-smoke-$$"
SECRET_DIR="$(mktemp -d)"
REPORT_DIR="${PERFORMANCE_REPORT_DIR:-data/performance-smoke}"
COMPOSE=(
  docker compose -p "${PROJECT}"
  -f docker-compose.yml
  -f docker-compose.e2e.yml
  -f docker-compose.performance.yml
)

export BOTPARTY_SECRET_DIR="${SECRET_DIR}"
export IMAGE_REGISTRY=local
export IMAGE_NAMESPACE=botparty
export APP_VERSION="${PERFORMANCE_SMOKE_APP_VERSION:-performance-smoke-${GITHUB_RUN_ID:-$$}}"
export LIVEKIT_API_KEY=botparty-performance-smoke
export APP_URL=http://nginx
export PUBLIC_WEB_URL=http://nginx
export CORS_ORIGIN=http://nginx
export NEXT_PUBLIC_APP_URL=http://nginx
export NEXT_PUBLIC_API_URL=http://nginx
export NEXT_PUBLIC_WS_URL=ws://nginx
export NEXT_PUBLIC_LIVEKIT_URL=ws://nginx/rtc
export SEED_ADMIN_EMAIL=admin@botparty.test
export SEED_ADMIN_USERNAME=admin
export SEED_DEMO_DATA=true
export SEED_E2E_FIXTURES=true
export PUBLIC_DEPLOYMENT=false
export LEGAL_PROVIDER_NAME='BotParty Performance Test'
export LEGAL_PROVIDER_ADDRESS='Teststrasse 1'
export LEGAL_PROVIDER_CITY='10115 Berlin'
export LEGAL_PROVIDER_COUNTRY=Deutschland
export LEGAL_CONTACT_EMAIL=legal@botparty.test
export LEGAL_PRIVACY_EMAIL=privacy@botparty.test

cleanup() {
  local status=$?
  if [[ "${status}" -ne 0 ]]; then
    echo "Performance smoke failed; collecting service logs before cleanup." >&2
    if ! "${COMPOSE[@]}" logs --no-color --tail=300 api postgres redis >&2; then
      echo "Warning: failed to collect performance smoke logs." >&2
    fi
  fi
  if ! "${COMPOSE[@]}" --profile performance down -v --remove-orphans >/dev/null 2>&1; then
    echo "Warning: failed to remove ${PROJECT} after the performance smoke." >&2
  fi
  rm -rf "${SECRET_DIR}"
  return "${status}"
}
trap cleanup EXIT

write_secret() {
  printf '%s' "$2" > "${SECRET_DIR}/$1"
  chmod 600 "${SECRET_DIR}/$1"
}

write_secret db_password 'performance-smoke-database-password'
write_secret api_database_url 'postgresql://botparty:performance-smoke-database-password@postgres:5432/botparty_performance?schema=public&connection_limit=10&pool_timeout=3&connect_timeout=5&sslmode=disable'
write_secret redis_password 'performance-smoke-redis-password'
write_secret minio_root_password 'performance-smoke-minio-password'
write_secret livekit_api_secret 'performance-smoke-livekit-secret-at-least-32-characters'
write_secret jwt_secret 'performance-smoke-jwt-secret-at-least-32-characters'
write_secret jwt_refresh_secret 'performance-smoke-refresh-secret-at-least-32-characters'
write_secret robot_jwt_secret 'performance-smoke-robot-secret-at-least-32-characters'
write_secret webhook_secret_encryption_key 'performance-smoke-webhook-key-at-least-32-characters'
write_secret payout_destination_encryption_key 'performance-smoke-payout-key-at-least-32-characters'
write_secret metrics_password 'performance-smoke-metrics-password'
write_secret smtp_password ''
write_secret seed_admin_password 'E2eAdminPassword!2026'
write_secret seed_demo_user_password 'E2eDemoPassword!2026'
write_secret stripe_secret_key ''
write_secret stripe_webhook_secret ''
write_secret paypal_client_secret ''
write_secret paypal_webhook_id ''

wait_for_health() {
  local service="$1"
  local container="${PROJECT}-${service}-1"
  local state
  for _ in $(seq 1 120); do
    if state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null)"; then
      if [[ "${state}" == healthy ]]; then
        return 0
      fi
      if [[ "${state}" == exited || "${state}" == dead ]]; then
        break
      fi
    fi
    sleep 1
  done
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --no-color "${service}"
  return 1
}

mkdir -p "${REPORT_DIR}"
"${COMPOSE[@]}" --profile performance config --quiet
if [[ "${PERFORMANCE_SMOKE_SKIP_BUILD:-false}" != true ]]; then
  "${COMPOSE[@]}" build api
fi

"${COMPOSE[@]}" up -d postgres redis minio minio-init livekit-config livekit livekit-ingress mail-test
wait_for_health postgres
wait_for_health redis
wait_for_health minio
wait_for_health livekit
wait_for_health mail-test
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --no-deps api
wait_for_health api

"${COMPOSE[@]}" exec -T \
  -e PERFORMANCE_FIXTURE_ALLOW_WRITES=true \
  -e PERFORMANCE_DATASET=small \
  api sh -c '. /load-file-secrets.sh; node /performance/seed-performance.mjs'

"${COMPOSE[@]}" --profile performance run --rm \
  -e PERFORMANCE_BASE_URL=http://api:4000 \
  -e PERFORMANCE_SCENARIO=mixed \
  -e PERFORMANCE_DURATION_SECONDS="${PERFORMANCE_SMOKE_DURATION_SECONDS:-20}" \
  -e PERFORMANCE_CONCURRENCY="${PERFORMANCE_SMOKE_CONCURRENCY:-10}" \
  -e PERFORMANCE_CLIENT_OFFSET=45000 \
  -e PERFORMANCE_MAX_SUCCESSFUL_P95_MS="${PERFORMANCE_SMOKE_MAX_P95_MS:-1000}" \
  -e PERFORMANCE_MAX_ERROR_RATE=0 \
  -e PERFORMANCE_MIN_SUCCESS_RPS="${PERFORMANCE_SMOKE_MIN_RPS:-20}" \
  load-generator | tee "${REPORT_DIR}/result.json"

echo "Performance smoke passed; report: ${REPORT_DIR}/result.json"
