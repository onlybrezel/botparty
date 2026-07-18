#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="botparty-e2e-${$}"
SECRET_DIR="$(mktemp -d)"
RESULT_DIR="$(mktemp -d)"
RUNNER_IMAGE="mcr.microsoft.com/playwright:v1.59.1-noble@sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53"
COMPOSE=(
  docker compose -p "${PROJECT}"
  -f "${ROOT_DIR}/docker-compose.yml"
  -f "${ROOT_DIR}/docker-compose.e2e.yml"
)

export BOTPARTY_SECRET_DIR="${SECRET_DIR}"
export LIVEKIT_API_KEY="botparty-e2e-key"
export APP_URL="http://nginx"
export PUBLIC_WEB_URL="http://nginx"
export CORS_ORIGIN="http://nginx"
export NEXT_PUBLIC_APP_URL="http://nginx"
export NEXT_PUBLIC_API_URL="http://nginx"
export NEXT_PUBLIC_WS_URL="ws://nginx"
export NEXT_PUBLIC_LIVEKIT_URL="ws://nginx/rtc"
export SEED_ADMIN_EMAIL="admin@botparty.test"
export SEED_ADMIN_USERNAME="admin"
export SEED_DEMO_DATA="true"
export SEED_E2E_FIXTURES="true"
export IMAGE_REGISTRY="local"
export IMAGE_NAMESPACE="botparty"
export APP_VERSION="${APP_VERSION:-e2e-${$}}"
export PUBLIC_DEPLOYMENT="false"
export NEXT_PUBLIC_LEGAL_OPERATOR_NAME="BotParty E2E"
export NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL="e2e@botparty.test"
export NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS="Isolated Docker test environment"
export NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY="Germany"
export NEXT_PUBLIC_LEGAL_GOVERNING_LAW="Germany"

cleanup() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    echo "E2E environment failed; recent container logs follow." >&2
    "${COMPOSE[@]}" ps >&2 || echo "Warning: failed to inspect ${PROJECT}." >&2
    "${COMPOSE[@]}" logs --no-color --tail 200 >&2 || echo "Warning: failed to read ${PROJECT} logs." >&2
  fi
  if ! "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1; then
    echo "Warning: failed to remove ${PROJECT} after E2E." >&2
  fi
  rm -rf "${SECRET_DIR}" "${RESULT_DIR}"
  return "${exit_code}"
}
trap cleanup EXIT

write_secret() {
  printf '%s' "$2" > "${SECRET_DIR}/$1"
  chmod 600 "${SECRET_DIR}/$1"
}

write_secret db_password 'e2e-database-password'
write_secret api_database_url 'postgresql://botparty:e2e-database-password@postgres:5432/botparty?schema=public&connection_limit=10&pool_timeout=5&connect_timeout=5&sslmode=disable'
write_secret redis_password 'e2e-redis-password'
write_secret minio_root_password 'e2e-minio-password'
write_secret livekit_api_secret 'e2e-livekit-secret-at-least-32-characters'
write_secret jwt_secret 'e2e-jwt-secret-at-least-32-characters'
write_secret jwt_refresh_secret 'e2e-refresh-secret-at-least-32-characters'
write_secret robot_jwt_secret 'e2e-robot-secret-at-least-32-characters'
write_secret webhook_secret_encryption_key 'e2e-webhook-key-at-least-32-characters'
write_secret payout_destination_encryption_key 'e2e-payout-key-at-least-32-characters'
write_secret metrics_password 'e2e-metrics-password'
write_secret smtp_password ''
write_secret seed_admin_password 'E2eAdminPassword!2026'
write_secret seed_demo_user_password 'E2eDemoPassword!2026'

wait_for_replicas() {
  local service="$1"
  local expected_replicas="$2"
  local state="missing"
  for _ in $(seq 1 180); do
    mapfile -t containers < <("${COMPOSE[@]}" ps -q "${service}")
    if (( ${#containers[@]} == expected_replicas )); then
      local healthy_replicas=0
      for container in "${containers[@]}"; do
        state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container}" 2>/dev/null || printf missing)"
        if [[ "${state}" == healthy ]]; then
          healthy_replicas=$((healthy_replicas + 1))
        elif [[ "${state}" == exited || "${state}" == dead || "${state}" == unhealthy ]]; then
          break 2
        fi
      done
      if (( healthy_replicas == expected_replicas )); then return 0; fi
    fi
    sleep 1
  done
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --no-color --tail 200 "${service}"
  echo "${service} did not reach ${expected_replicas} healthy replica(s) (last state: ${state})." >&2
  return 1
}

"${COMPOSE[@]}" config --quiet
if [[ "${E2E_SKIP_BUILD:-false}" != true ]]; then
  "${COMPOSE[@]}" build api web
fi
"${COMPOSE[@]}" up -d --scale api=2 --scale web=2 nginx
wait_for_replicas api 2
wait_for_replicas web 2
wait_for_replicas nginx 1

docker run --rm --init --ipc=host \
  --name "${PROJECT}-e2e-runner" \
  --network "${PROJECT}_frontend" \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --memory 2g \
  --cpus 2 \
  --mount "type=bind,src=${ROOT_DIR},dst=/work,readonly" \
  --mount "type=bind,src=${RESULT_DIR},dst=/results" \
  -e CI=true \
  -e PLAYWRIGHT_EXTERNAL_SERVERS=true \
  -e PLAYWRIGHT_BASE_URL=http://nginx \
  -e PLAYWRIGHT_OUTPUT_DIR=/results \
  -e API_URL=http://api:4000 \
  -e E2E_ADMIN_EMAIL=admin@botparty.test \
  -e E2E_ADMIN_PASSWORD='E2eAdminPassword!2026' \
  "${RUNNER_IMAGE}" \
  bash -lc 'cd /work/apps/web; code=0; LOAD_TEST_ALLOW_REMOTE=true LOAD_TEST_MIN_INSTANCES=2 LOAD_TEST_MAX_REQUESTS=20 LOAD_TEST_DURATION_SECONDS=3 LOAD_TEST_CONCURRENCY=1 node /work/scripts/load-smoke.mjs http://nginx/api/v1/health/stats || code=$?; if (( code == 0 )); then /work/node_modules/.bin/playwright test --project=chromium || code=$?; fi; chmod -R a+rwX /results; exit $code'

echo 'Docker E2E suite passed.'
