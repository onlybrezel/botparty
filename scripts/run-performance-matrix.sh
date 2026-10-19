#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PHASE="${PERFORMANCE_MATRIX_PHASE:-baseline}"
case "${PHASE}" in baseline|optimized) ;; *) echo "PERFORMANCE_MATRIX_PHASE must be baseline or optimized" >&2; exit 2 ;; esac

PROFILE_FILTER="${PERFORMANCE_MATRIX_PROFILES:-}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
REPORT_ROOT="${PERFORMANCE_MATRIX_REPORT_DIR:-data/performance-matrix}"
PHASE_DIR="${REPORT_ROOT}/${PHASE}"
SECRET_DIR="$(mktemp -d)"
ACTIVE_PROJECT=""
COLLECTOR_PID=""
STOP_FILE=""

export BOTPARTY_SECRET_DIR="${SECRET_DIR}"
export IMAGE_REGISTRY=local
export IMAGE_NAMESPACE=botparty
export APP_VERSION="${PERFORMANCE_MATRIX_APP_VERSION:-performance-matrix-${PHASE}-${RUN_ID}}"
export LIVEKIT_API_KEY=botparty-performance-matrix
export APP_URL=http://performance-gateway:8080
export PUBLIC_WEB_URL=http://performance-gateway:8080
export CORS_ORIGIN=http://performance-gateway:8080
export SEED_ADMIN_EMAIL=admin@botparty.test
export SEED_ADMIN_USERNAME=admin
export SEED_DEMO_DATA=true
export SEED_E2E_FIXTURES=true
export PUBLIC_DEPLOYMENT=false
export LEGAL_PROVIDER_NAME='BotParty Performance Matrix'
export LEGAL_PROVIDER_ADDRESS='Isolated benchmark stack'
export LEGAL_PROVIDER_CITY='Local Docker network'
export LEGAL_PROVIDER_COUNTRY=Deutschland
export LEGAL_CONTACT_EMAIL=legal@performance.invalid
export LEGAL_PRIVACY_EMAIL=privacy@performance.invalid
export OBJECT_STORAGE_ACCESS_KEY_ID=botparty
export OBJECT_STORAGE_SECRET_ACCESS_KEY=performance-matrix-object-storage

COMPOSE_BASE=(
  docker compose
  -f docker-compose.yml
  -f docker-compose.performance.yml
  --profile performance
)

cleanup() {
  local status=$?
  if [[ -n "${STOP_FILE}" ]]; then touch "${STOP_FILE}" 2>/dev/null || true; fi
  if [[ -n "${COLLECTOR_PID}" ]]; then wait "${COLLECTOR_PID}" 2>/dev/null || true; fi
  if [[ -n "${ACTIVE_PROJECT}" ]]; then
    "${COMPOSE_BASE[@]}" -p "${ACTIVE_PROJECT}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "${SECRET_DIR}"
  exit "${status}"
}
trap cleanup EXIT INT TERM

write_secret() {
  printf '%s' "$2" > "${SECRET_DIR}/$1"
  chmod 600 "${SECRET_DIR}/$1"
}

write_secret db_password performance-matrix-database-password
write_secret redis_password performance-matrix-redis-password
write_secret object_storage_secret_access_key "${OBJECT_STORAGE_SECRET_ACCESS_KEY}"
write_secret livekit_api_secret performance-matrix-livekit-secret-at-least-32-characters
write_secret jwt_secret performance-matrix-jwt-secret-at-least-32-characters
write_secret jwt_refresh_secret performance-matrix-refresh-secret-at-least-32-characters
write_secret robot_jwt_secret performance-matrix-robot-secret-at-least-32-characters
write_secret webhook_secret_encryption_key performance-matrix-webhook-key-at-least-32-characters
write_secret payout_destination_encryption_key performance-matrix-payout-key-at-least-32-characters
write_secret metrics_password performance-matrix-metrics-password
write_secret smtp_password ''
write_secret seed_admin_password 'E2eAdminPassword!2026'
write_secret seed_demo_user_password 'E2eDemoPassword!2026'
write_secret stripe_secret_key ''
write_secret stripe_webhook_secret ''
write_secret paypal_client_secret ''
write_secret paypal_webhook_id ''

mkdir -p "${PHASE_DIR}"
node scripts/capture-performance-host.mjs > "${REPORT_ROOT}/host-reference.json"

profile_lines="$(node - "${PROFILE_FILTER}" <<'NODE'
const fs = require('node:fs');
const filter = new Set((process.argv[2] || '').split(',').filter(Boolean));
const matrix = JSON.parse(fs.readFileSync('config/performance-profiles.json', 'utf8'));
for (const profile of matrix.profiles) {
  if (filter.size === 0 || filter.has(profile.id)) {
    process.stdout.write(`${Buffer.from(JSON.stringify(profile)).toString('base64')}\n`);
  }
}
NODE
)"
if [[ -z "${profile_lines}" ]]; then echo "No selected performance profiles." >&2; exit 2; fi
mapfile -t selected_profiles <<< "${profile_lines}"

host_cpus="$(node -p 'require("node:os").cpus().length')"
host_memory_mb="$(node -p 'Math.floor(require("node:os").totalmem()/1024/1024)')"
for encoded in "${selected_profiles[@]}"; do
  profile_json="$(printf '%s' "${encoded}" | base64 -d)"
  api_total_cpus="$(node -e 'const p=JSON.parse(process.argv[1]); console.log(p.api.replicas*p.api.cpusPerReplica)' "${profile_json}")"
  total_memory_mb="$(node -e 'const p=JSON.parse(process.argv[1]); console.log(p.api.replicas*p.api.memoryMbPerReplica+p.postgres.memoryMb+p.redis.memoryMb+p.nginx.memoryMb)' "${profile_json}")"
  if node -e 'process.exit(Number(process.argv[1]) <= Number(process.argv[2]) ? 0 : 1)' "${api_total_cpus}" "${host_cpus}"; then :; else
    echo "Profile requests ${api_total_cpus} API CPUs but host exposes ${host_cpus}." >&2; exit 2
  fi
  if (( total_memory_mb > host_memory_mb )); then
    echo "Profile requests ${total_memory_mb} MiB for measured services but host has ${host_memory_mb} MiB." >&2; exit 2
  fi
done

BUILD_PROJECT="botparty-perf-matrix-build-${PHASE}-${RUN_ID,,}"
"${COMPOSE_BASE[@]}" -p "${BUILD_PROJECT}" config --quiet
if [[ "${PERFORMANCE_MATRIX_SKIP_BUILD:-false}" != true ]]; then
  "${COMPOSE_BASE[@]}" -p "${BUILD_PROJECT}" build api
fi
API_IMAGE_ID="$(docker image inspect "local/botparty/botparty-api:${APP_VERSION}" --format '{{.Id}}')"

wait_for_service() {
  local project="$1" service="$2" expected="$3"
  for _ in $(seq 1 180); do
    mapfile -t ids < <(docker ps -q --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.service=${service}")
    local healthy=0
    for id in "${ids[@]}"; do
      state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}")"
      [[ "${state}" == healthy || "${state}" == running ]] && healthy=$((healthy + 1))
    done
    (( healthy == expected )) && return 0
    sleep 1
  done
  "${COMPOSE_BASE[@]}" -p "${project}" ps >&2
  "${COMPOSE_BASE[@]}" -p "${project}" logs --no-color --tail=200 "${service}" >&2
  return 1
}

capture_host_gate() {
  local output="$1" idle load_one captured accepted=false foreign_containers
  idle="$(LC_ALL=C mpstat 1 3 | awk '/^Average:/ && $2 == "all" {print $NF}')"
  load_one="$(cut -d' ' -f1 /proc/loadavg)"
  captured="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  foreign_containers="$(docker ps --format '{{.Names}}' | awk -v own="${ACTIVE_PROJECT}" '($0 ~ /perf-matrix|load-generator/) && (own == "" || index($0, own "-") != 1) { print }')"
  if node -e 'process.exit(Number(process.argv[1]) >= 75 && Number(process.argv[2]) < 16 ? 0 : 1)' "${idle}" "${load_one}"; then
    accepted=true
  fi
  node - "${captured}" "${idle}" "${load_one}" "${accepted}" "${foreign_containers}" > "${output}" <<'NODE'
const [capturedAt, idle, loadAverageOneMinute, accepted, foreign] = process.argv.slice(2);
console.log(JSON.stringify({
  capturedAt,
  sample: 'mpstat 1 3 average',
  hostIdlePercent: Number(idle),
  loadAverageOneMinute: Number(loadAverageOneMinute),
  thresholds: { minimumHostIdlePercent: 75, maximumLoadAverageOneMinuteExclusive: 16 },
  foreignPerformanceContainers: foreign ? foreign.split('\n') : [],
  accepted: accepted === 'true',
}, null, 2));
NODE
  [[ "${accepted}" == true ]]
}

wait_for_host_gate() {
  local output="$1"
  local candidate="${output}.candidate"
  until capture_host_gate "${candidate}"; do
    echo "Host gate rejected; waiting for >=75% idle, loadavg1 <16, and no foreign performance stack."
    sleep 10
  done
  mv "${candidate}" "${output}"
}

wait_for_exclusive_start_gate() {
  local output="$1"
  local candidate="${output}.candidate" stable_since=0 now elapsed backoff jitter foreign_count
  while :; do
    if capture_host_gate "${candidate}"; then
      now="$(date +%s)"
      (( stable_since == 0 )) && stable_since="${now}"
      elapsed=$((now - stable_since))
      if (( elapsed >= 30 )); then
        jitter=$((5 + RANDOM % 21))
        echo "Exclusive gate stable for ${elapsed}s; applying ${jitter}s start jitter."
        sleep "${jitter}"
        if capture_host_gate "${candidate}"; then
          mv "${candidate}" "${output}"
          return 0
        fi
        stable_since=0
      else
        sleep 3
      fi
      continue
    fi

    stable_since=0
    foreign_count="$(node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(v.foreignPerformanceContainers.length)' "${candidate}")"
    if (( foreign_count > 0 )); then
      backoff=$((90 + RANDOM % 91))
      echo "Foreign performance stack detected; backing off for ${backoff}s."
      sleep "${backoff}"
    else
      echo "Host utilization gate rejected; retrying in 10s."
      sleep 10
    fi
  done
}

for encoded in "${selected_profiles[@]}"; do
  profile_json="$(printf '%s' "${encoded}" | base64 -d)"
  id="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "${profile_json}")"
  report_dir="${PHASE_DIR}/${id}"
  mkdir -p "${report_dir}"
  printf '%s\n' "${profile_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))' > "${report_dir}/profile.json"

  eval "$(node - "${profile_json}" <<'NODE'
const p=JSON.parse(process.argv[2]);
const values={
  PERFORMANCE_POSTGRES_CPUS:p.postgres.cpus,
  PERFORMANCE_POSTGRES_MEMORY_MB:p.postgres.memoryMb,
  PERFORMANCE_POSTGRES_MAX_CONNECTIONS:p.postgres.maxConnections,
  PERFORMANCE_REDIS_CPUS:Math.max(p.redis.cpus,1),
  PERFORMANCE_REDIS_MEMORY_MB:p.redis.memoryMb,
  PERFORMANCE_NGINX_CPUS:p.nginx.cpus,
  PERFORMANCE_NGINX_MEMORY_MB:p.nginx.memoryMb,
  PERFORMANCE_API_CPUS:Math.max(p.api.cpusPerReplica,2),
  PERFORMANCE_API_MEMORY_MB:p.api.memoryMbPerReplica,
  PERFORMANCE_API_WORKERS:Math.max(1,Math.ceil(p.api.cpusPerReplica)),
  PERFORMANCE_API_MAX_OLD_SPACE_MB:Math.floor(p.api.maxOldSpaceMb/Math.max(1,Math.ceil(p.api.cpusPerReplica))),
  PERFORMANCE_UV_THREADPOOL_SIZE:p.runtime.uvThreadpoolSize,
  PERFORMANCE_MAX_CONCURRENT_REQUESTS:p.runtime.maxConcurrentRequestsPerApi,
  PERFORMANCE_MAX_CONCURRENT_LOGIN_REQUESTS:p.runtime.maxConcurrentLoginRequestsPerApi,
  PROFILE_REPLICAS:p.api.replicas,
  PROFILE_API_CPUS:p.api.cpusPerReplica,
  PROFILE_REDIS_CPUS:p.redis.cpus,
  PROFILE_CONNECTION_LIMIT:p.runtime.connectionLimitPerApi,
  PROFILE_DATASET:p.load.dataset,
  PROFILE_SCENARIO:p.load.scenario,
  PROFILE_DURATION:p.load.durationSeconds,
  PROFILE_CONCURRENCY:p.load.concurrency,
};
for(const [key,value] of Object.entries(values)) console.log(`export ${key}=${JSON.stringify(String(value))}`);
NODE
)"
  write_secret api_database_url "postgresql://botparty:performance-matrix-database-password@postgres:5432/botparty_performance?schema=public&connection_limit=${PROFILE_CONNECTION_LIMIT}&pool_timeout=3&connect_timeout=5&sslmode=disable"

  ACTIVE_PROJECT="botparty-perf-matrix-${PHASE}-${id}-${RUN_ID,,}"
  COMPOSE=("${COMPOSE_BASE[@]}" -p "${ACTIVE_PROJECT}")
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  wait_for_host_gate "${report_dir}/startup-host-gate.json"
  echo "[${id}] starting isolated stack ${ACTIVE_PROJECT}"
  "${COMPOSE[@]}" up -d postgres redis mail-test
  wait_for_service "${ACTIVE_PROJECT}" postgres 1
  wait_for_service "${ACTIVE_PROJECT}" redis 1
  wait_for_service "${ACTIVE_PROJECT}" mail-test 1
  "${COMPOSE[@]}" run --rm migrate
  "${COMPOSE[@]}" up -d --no-deps --scale api="${PROFILE_REPLICAS}" api
  wait_for_service "${ACTIVE_PROJECT}" api "${PROFILE_REPLICAS}"

  mapfile -t api_ids < <(docker ps -q --filter "label=com.docker.compose.project=${ACTIVE_PROJECT}" --filter 'label=com.docker.compose.service=api')
  for api_id in "${api_ids[@]}"; do docker update --cpus "${PROFILE_API_CPUS}" "${api_id}" >/dev/null; done
  redis_id="$(docker ps -q --filter "label=com.docker.compose.project=${ACTIVE_PROJECT}" --filter 'label=com.docker.compose.service=redis')"
  docker update --cpus "${PROFILE_REDIS_CPUS}" "${redis_id}" >/dev/null
  node - "${PROFILE_API_CPUS}" "${PERFORMANCE_API_CPUS}" "${PROFILE_REDIS_CPUS}" "${PERFORMANCE_REDIS_CPUS}" > "${report_dir}/startup-cpu-staging.json" <<'NODE'
const [measuredCpus, startupCpus, measuredRedisCpus, startupRedisCpus] = process.argv.slice(2).map(Number);
console.log(JSON.stringify({
  startupCpusPerReplica: startupCpus,
  measuredCpusPerReplica: measuredCpus,
  startupRedisCpus,
  measuredRedisCpus,
  reason: startupCpus === measuredCpus && startupRedisCpus === measuredRedisCpus ? 'No staging allowance required.' : 'CPU-only startup allowance avoids conflating initialization deadlines with steady-state load; requested API and Redis limits are restored before seeding, warmup, and measurement.',
}, null, 2));
NODE

  first_api="$(docker ps -q --filter "label=com.docker.compose.project=${ACTIVE_PROJECT}" --filter 'label=com.docker.compose.service=api' | head -1)"
  docker exec \
    -e PERFORMANCE_FIXTURE_ALLOW_WRITES=true \
    -e PERFORMANCE_DATASET="${PROFILE_DATASET}" \
    "${first_api}" sh -c '. /load-file-secrets.sh; node /app/scripts/seed-performance.mjs' \
    | tee "${report_dir}/seed.log"

  "${COMPOSE[@]}" up -d --no-deps performance-gateway
  wait_for_service "${ACTIVE_PROJECT}" performance-gateway 1
  attempt=1
  while :; do
    wait_for_host_gate "${report_dir}/pre-host-gate.json"
    "${COMPOSE[@]}" run --rm --no-deps \
      -e PERFORMANCE_BASE_URL=http://performance-gateway:8080 \
      -e PERFORMANCE_SCENARIO=public-read \
      -e PERFORMANCE_DURATION_SECONDS=3 \
      -e PERFORMANCE_CONCURRENCY="${PROFILE_CONCURRENCY}" \
      -e PERFORMANCE_CLIENT_OFFSET=800000 \
      load-generator > "${report_dir}/warmup.json"

    STOP_FILE="${report_dir}/collector.stop"
    rm -f "${STOP_FILE}"
    node scripts/performance-metrics-collector.mjs "${ACTIVE_PROJECT}" "${report_dir}/metrics.json" "${STOP_FILE}" &
    COLLECTOR_PID=$!
    sleep 2
    set +e
    "${COMPOSE[@]}" run --rm --no-deps \
      -e PERFORMANCE_BASE_URL=http://performance-gateway:8080 \
      -e PERFORMANCE_SCENARIO="${PROFILE_SCENARIO}" \
      -e PERFORMANCE_DURATION_SECONDS="${PROFILE_DURATION}" \
      -e PERFORMANCE_CONCURRENCY="${PROFILE_CONCURRENCY}" \
      -e PERFORMANCE_CLIENT_OFFSET=100000 \
      load-generator > "${report_dir}/load.json"
    load_status=$?
    set -e
    touch "${STOP_FILE}"
    wait "${COLLECTOR_PID}"
    COLLECTOR_PID=""
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    set +e
    capture_host_gate "${report_dir}/post-host-gate.json"
    post_gate_status=$?
    set -e
    node scripts/merge-performance-result.mjs \
      "${report_dir}/profile.json" "${report_dir}/load.json" "${report_dir}/metrics.json" \
      "${report_dir}/result.json" "${load_status}" "${PHASE}" "${started_at}" "${finished_at}" "${API_IMAGE_ID}" \
      "${report_dir}/pre-host-gate.json" "${report_dir}/post-host-gate.json"
    if (( post_gate_status == 0 )); then break; fi
    mv "${report_dir}/result.json" "${report_dir}/result-contended-${attempt}.json"
    attempt=$((attempt + 1))
    if (( attempt > 3 )); then echo "Host gate rejected three post-run samples for ${id}." >&2; exit 1; fi
    echo "[${id}] post-run host gate rejected; repeating measured load."
  done

  "${COMPOSE[@]}" down -v --remove-orphans
  ACTIVE_PROJECT=""
  STOP_FILE=""
  echo "[${id}] result: ${report_dir}/result.json"
done

node - "${PHASE_DIR}" <<'NODE'
const fs=require('node:fs'); const path=require('node:path'); const dir=process.argv[2];
const results=fs.readdirSync(dir).map(id=>path.join(dir,id,'result.json')).filter(file=>fs.existsSync(file)).map(file=>JSON.parse(fs.readFileSync(file)));
fs.writeFileSync(path.join(dir,'summary.json'), JSON.stringify({schemaVersion:1,phase:path.basename(dir),profiles:results},null,2)+'\n');
NODE
echo "Performance matrix complete: ${PHASE_DIR}/summary.json"
