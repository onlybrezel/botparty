#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${LOCAL_CI_RUN_ID:-botparty}-e2e-${$}"
SECRET_DIR="$(mktemp -d)"
RESULT_DIR="${E2E_RESULT_DIR:-$(mktemp -d)}"
FAILOVER_SIGNAL_DIR="${RESULT_DIR}/failover-signals"
RUNNER_IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27"
RESULT_DIR_IS_TEMP=true
if [[ -n "${E2E_RESULT_DIR:-}" ]]; then
  RESULT_DIR_IS_TEMP=false
  if [[ -d "${RESULT_DIR}" ]] && ! chmod -R u+rwX "${RESULT_DIR}" 2>/dev/null; then
    docker run --rm \
      --mount "type=bind,src=${RESULT_DIR},dst=/results" \
      "${RUNNER_IMAGE}" chmod -R a+rwX /results
  fi
  rm -rf "${RESULT_DIR}"
  mkdir -p "${RESULT_DIR}"
fi
COMPOSE=(
  docker compose -p "${PROJECT}"
  -f "${ROOT_DIR}/docker-compose.yml"
  -f "${ROOT_DIR}/docker-compose.e2e.yml"
)

export BOTPARTY_SECRET_DIR="${SECRET_DIR}"
# The production proxy intentionally allows only a small number of logins per
# client IP. All browser workers share one Docker IP, so use an isolated copy
# with a higher auth rate while retaining dedicated 429 behavior tests.
sed \
  -e 's/rate=3r\/m/rate=100r\/s/' \
  -e 's/rate=5r\/m/rate=100r\/s/' \
  "${ROOT_DIR}/docker/nginx/nginx.conf" > "${SECRET_DIR}/nginx-e2e.conf"
export NGINX_CONF="${SECRET_DIR}/nginx-e2e.conf"
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
  if [[ -d "${RESULT_DIR}" ]] && ! chmod -R u+rwX "${RESULT_DIR}" 2>/dev/null; then
    if ! docker run --rm \
      --mount "type=bind,src=${RESULT_DIR},dst=/results" \
      "${RUNNER_IMAGE}" chmod -R a+rwX /results >/dev/null 2>&1; then
      echo "Warning: failed to restore test result permissions in ${RESULT_DIR}." >&2
    fi
  fi
  rm -rf "${SECRET_DIR}"
  if [[ "${RESULT_DIR_IS_TEMP}" == true ]]; then
    rm -rf "${RESULT_DIR}"
  fi
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
write_secret object_storage_secret_access_key 'e2e-object-storage-password'
export OBJECT_STORAGE_SECRET_ACCESS_KEY="$(cat "${SECRET_DIR}/object_storage_secret_access_key")"
export OBJECT_STORAGE_ACCESS_KEY_ID="${OBJECT_STORAGE_ACCESS_KEY_ID:-botparty}"
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

wait_for_signal_file() {
  local path="$1"
  while [[ ! -f "${path}" ]]; do
    sleep 0.2
  done
}

orchestrate_api_failover() (
  set -e
  trap 'printf "%s\n" "Docker failover orchestration failed." > "${FAILOVER_SIGNAL_DIR}/failover-error"' ERR

  wait_for_signal_file "${FAILOVER_SIGNAL_DIR}/failover-ready"
  mapfile -t api_containers < <("${COMPOSE[@]}" ps -q api)
  if (( ${#api_containers[@]} != 2 )); then
    echo "Expected two API containers for failover, found ${#api_containers[@]}." >&2
    exit 1
  fi

  docker stop --time 10 "${api_containers[0]}" >/dev/null
  printf '%s\n' 'stopped' > "${FAILOVER_SIGNAL_DIR}/failover-stopped"

  wait_for_signal_file "${FAILOVER_SIGNAL_DIR}/failover-restart-requested"
  docker start "${api_containers[0]}" >/dev/null

  local state='starting'
  for _ in $(seq 1 90); do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${api_containers[0]}")"
    if [[ "${state}" == healthy ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${state}" != healthy ]]; then
    echo "Restarted API remained ${state}." >&2
    exit 1
  fi
  printf '%s\n' 'healthy' > "${FAILOVER_SIGNAL_DIR}/failover-restarted"
  wait_for_signal_file "${FAILOVER_SIGNAL_DIR}/failover-complete"
)

"${COMPOSE[@]}" config --quiet
if [[ "${E2E_SKIP_BUILD:-false}" != true ]]; then
  "${COMPOSE[@]}" build api web
fi
"${COMPOSE[@]}" up -d --scale api=2 --scale web=2 nginx
wait_for_replicas api 2
wait_for_replicas web 2
wait_for_replicas nginx 1

FAILOVER_ORCHESTRATOR_PID=''
if [[ "${E2E_RUN_FAILOVER:-false}" == true ]]; then
  mkdir -p "${FAILOVER_SIGNAL_DIR}"
  chmod a+rwx "${FAILOVER_SIGNAL_DIR}"
  orchestrate_api_failover &
  FAILOVER_ORCHESTRATOR_PID=$!
fi

set +e
docker run --rm --init --ipc=host \
  --name "${PROJECT}-e2e-runner" \
  --network "${PROJECT}_frontend" \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --memory 2g \
  --cpus 2 \
  --mount "type=bind,src=${ROOT_DIR},dst=/work,readonly" \
  --mount "type=bind,src=${ROOT_DIR}/apps/web/tests/e2e/visual,dst=/work/apps/web/tests/e2e/visual" \
  --mount "type=bind,src=${RESULT_DIR},dst=/results" \
  -e CI=true \
  -e PLAYWRIGHT_EXTERNAL_SERVERS=true \
  -e PLAYWRIGHT_BASE_URL=http://nginx \
  -e PLAYWRIGHT_OUTPUT_DIR=/results \
  -e API_URL=http://api:4000 \
  -e E2E_ADMIN_EMAIL=admin@botparty.test \
  -e E2E_ADMIN_PASSWORD='E2eAdminPassword!2026' \
  -e E2E_USER_PASSWORD='E2eDemoPassword!2026' \
  -e E2E_TEST_FILE="${E2E_TEST_FILE:-}" \
  -e E2E_PLAYWRIGHT_PROJECT="${E2E_PLAYWRIGHT_PROJECT:-}" \
  -e E2E_SKIP_FUNCTIONAL="${E2E_SKIP_FUNCTIONAL:-false}" \
  -e E2E_SKIP_AUXILIARY="${E2E_SKIP_AUXILIARY:-false}" \
  -e E2E_RUN_FAILOVER="${E2E_RUN_FAILOVER:-false}" \
  -e E2E_FAILOVER_SIGNAL_DIR=/results/failover-signals \
  -e E2E_UPDATE_VISUAL_SNAPSHOTS="${E2E_UPDATE_VISUAL_SNAPSHOTS:-false}" \
  "${RUNNER_IMAGE}" \
  bash -lc 'cd /work/apps/web; code=0; playwright=/work/apps/web/node_modules/.bin/playwright; functional_args=(); if [[ -n "$E2E_TEST_FILE" ]]; then functional_args+=("$E2E_TEST_FILE"); fi; if [[ -n "$E2E_PLAYWRIGHT_PROJECT" ]]; then functional_args+=("--project=$E2E_PLAYWRIGHT_PROJECT"); fi; LOAD_TEST_ALLOW_REMOTE=true LOAD_TEST_MIN_INSTANCES=2 LOAD_TEST_MAX_REQUESTS=20 LOAD_TEST_DURATION_SECONDS=3 LOAD_TEST_CONCURRENCY=1 node /work/scripts/load-smoke.mjs http://nginx/api/v1/health/stats || code=$?; if (( code == 0 )) && [[ "$E2E_SKIP_FUNCTIONAL" != true ]]; then PLAYWRIGHT_OUTPUT_DIR=/results/functional "$playwright" test "${functional_args[@]}" || code=$?; fi; if (( code == 0 )) && [[ "$E2E_SKIP_AUXILIARY" != true ]]; then PLAYWRIGHT_OUTPUT_DIR=/results/responsive "$playwright" test --config playwright.responsive.config.ts || code=$?; fi; if (( code == 0 )) && [[ "$E2E_SKIP_AUXILIARY" != true ]]; then visual_args=(); if [[ "$E2E_UPDATE_VISUAL_SNAPSHOTS" == true ]]; then visual_args+=(--update-snapshots=all); fi; PLAYWRIGHT_OUTPUT_DIR=/results/visual "$playwright" test --config playwright.visual.config.ts "${visual_args[@]}" || code=$?; fi; if (( code == 0 )) && [[ "$E2E_RUN_FAILOVER" == true ]]; then PLAYWRIGHT_OUTPUT_DIR=/results/failover "$playwright" test --config playwright.failover.config.ts || code=$?; fi; chmod -R a+rwX /results; exit $code'
RUNNER_STATUS=$?
set -e

if [[ -n "${FAILOVER_ORCHESTRATOR_PID}" ]]; then
  if (( RUNNER_STATUS != 0 )) && kill -0 "${FAILOVER_ORCHESTRATOR_PID}" 2>/dev/null; then
    kill "${FAILOVER_ORCHESTRATOR_PID}"
  fi
  set +e
  wait "${FAILOVER_ORCHESTRATOR_PID}"
  FAILOVER_STATUS=$?
  set -e
  if (( RUNNER_STATUS == 0 && FAILOVER_STATUS != 0 )); then
    RUNNER_STATUS=${FAILOVER_STATUS}
  fi
fi

if (( RUNNER_STATUS != 0 )); then
  exit "${RUNNER_STATUS}"
fi

echo 'Docker E2E suite passed.'
