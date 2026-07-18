#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/load-dotenv.sh
. "${SCRIPT_DIR}/load-dotenv.sh"
load_dotenv_file "${PROJECT_ROOT}/.env"
NODE_BACKUP_IMAGE="node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2"
OUTPUT_DIR="${1:-${PROJECT_ROOT}/data/backups}"
DATABASE_URL="${DATABASE_WRITE_URL:-${DATABASE_URL:-}}"
if [[ -z "${DATABASE_URL}" && -n "${BACKUP_DATABASE_URL_FILE:-}" ]]; then
  if [[ ! -r "${BACKUP_DATABASE_URL_FILE}" ]]; then
    echo "Backup database URL file is not readable: ${BACKUP_DATABASE_URL_FILE}" >&2
    exit 1
  fi
  DATABASE_URL="$(<"${BACKUP_DATABASE_URL_FILE}")"
fi
: "${DATABASE_URL:?DATABASE_WRITE_URL, DATABASE_URL, or BACKUP_DATABASE_URL_FILE is required; no backup credential fallback is allowed}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY is required}"
: "${BACKUP_S3_SECRET_KEY_FILE:?BACKUP_S3_SECRET_KEY_FILE is required}"
if [[ ! -r "${BACKUP_S3_SECRET_KEY_FILE}" ]]; then
  echo "Backup object-storage secret is not readable: ${BACKUP_S3_SECRET_KEY_FILE}" >&2
  exit 1
fi
BACKUP_S3_SECRET_KEY_FILE="$(realpath "${BACKUP_S3_SECRET_KEY_FILE}")"
: "${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"
if [[ ! -r "${BACKUP_ENCRYPTION_KEY_FILE}" ]]; then
  echo "Backup encryption key is not readable: ${BACKUP_ENCRYPTION_KEY_FILE}" >&2
  exit 1
fi
BACKUP_ENCRYPTION_KEY_FILE="$(realpath "${BACKUP_ENCRYPTION_KEY_FILE}")"

# Prisma accepts pool and schema URL parameters that PostgreSQL client tools do
# not. Preserve standard libpq parameters such as sslmode and connect_timeout.
PG_DUMP_DATABASE_URL="$(docker run --rm --network none \
  --security-opt no-new-privileges:true --cap-drop ALL \
  -e DATABASE_URL="${DATABASE_URL}" -v "${SCRIPT_DIR}:/scripts:ro" \
  "${NODE_BACKUP_IMAGE}" node /scripts/sanitize-postgres-url.mjs)"

BACKUP_S3_BUCKETS="${BACKUP_S3_BUCKETS:-botparty-thumbnails botparty-recordings}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
if [[ -n "${BACKUP_MAX_AGE_SECONDS:-}" && ! "${BACKUP_MAX_AGE_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo 'BACKUP_MAX_AGE_SECONDS must be a positive integer when set.' >&2
  exit 1
fi
BACKUP_DATABASE_DOCKER_NETWORK="${BACKUP_DATABASE_DOCKER_NETWORK:-${COMPOSE_PROJECT_NAME:-botparty}_internal}"
BACKUP_OBJECT_DOCKER_NETWORK="${BACKUP_OBJECT_DOCKER_NETWORK:-${COMPOSE_PROJECT_NAME:-botparty}_frontend}"
POSTGRES_BACKUP_IMAGE="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
MINIO_CLIENT_IMAGE="minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGING="$(mktemp -d)"
ARCHIVE="${OUTPUT_DIR}/botparty-release-${TIMESTAMP}.tar.gz.enc"
RAW_ARCHIVE="${STAGING}/botparty-release-${TIMESTAMP}.tar.gz"
BACKUP_METRICS_DIR="${BACKUP_METRICS_DIR:-${PROJECT_ROOT}/data/metrics}"
BACKUP_SUCCEEDED=0

write_backup_metrics() {
  local exit_code="$1"
  local metrics_tmp
  local tls_certificate_file="${TLS_CERTIFICATE_FILE:-${PROJECT_ROOT}/docker/nginx/ssl/fullchain.pem}"
  local tls_configured=0
  local tls_expiry=0
  local tls_enddate
  if [[ -r "${tls_certificate_file}" ]]; then
    tls_configured=1
    if tls_enddate="$(openssl x509 -in "${tls_certificate_file}" -noout -enddate 2>/dev/null)"; then
      tls_expiry="$(date -d "${tls_enddate#notAfter=}" +%s 2>/dev/null || printf 0)"
    fi
  fi
  if ! mkdir -p "${BACKUP_METRICS_DIR}"; then
    echo "Warning: backup metrics directory is unavailable: ${BACKUP_METRICS_DIR}" >&2
    return
  fi
  chmod 755 "${BACKUP_METRICS_DIR}"
  metrics_tmp="${BACKUP_METRICS_DIR}/.backup-last-run.prom.$$"
  if ! {
    printf '# HELP botparty_backup_last_run_success Whether the latest backup attempt completed successfully.\n'
    printf '# TYPE botparty_backup_last_run_success gauge\n'
    printf 'botparty_backup_last_run_success %s\n' "${BACKUP_SUCCEEDED}"
    printf '# HELP botparty_backup_last_run_unixtime_seconds Unix timestamp of the latest backup attempt.\n'
    printf '# TYPE botparty_backup_last_run_unixtime_seconds gauge\n'
    printf 'botparty_backup_last_run_unixtime_seconds %s\n' "$(date +%s)"
    printf '# HELP botparty_tls_certificate_configured Whether a TLS certificate file is configured.\n'
    printf '# TYPE botparty_tls_certificate_configured gauge\n'
    printf 'botparty_tls_certificate_configured %s\n' "${tls_configured}"
    printf '# HELP botparty_tls_certificate_expiry_unixtime_seconds Parsed TLS certificate expiration, or zero when invalid.\n'
    printf '# TYPE botparty_tls_certificate_expiry_unixtime_seconds gauge\n'
    printf 'botparty_tls_certificate_expiry_unixtime_seconds %s\n' "${tls_expiry}"
  } >"${metrics_tmp}"; then
    echo "Warning: failed to write backup run metrics after exit code ${exit_code}." >&2
    rm -f "${metrics_tmp}"
    return
  fi
  chmod 644 "${metrics_tmp}"
  mv "${metrics_tmp}" "${BACKUP_METRICS_DIR}/backup-last-run.prom"
}

cleanup() {
  local exit_code=$?
  rm -rf "${STAGING}"
  write_backup_metrics "${exit_code}"
  trap - EXIT
  exit "${exit_code}"
}
trap cleanup EXIT
mkdir -p "${OUTPUT_DIR}" "${STAGING}/objects"
chmod 700 "${OUTPUT_DIR}" "${STAGING}"
printf '%s' "${PG_DUMP_DATABASE_URL}" > "${STAGING}/database-url"
chmod 600 "${STAGING}/database-url"

run_pg_dump() {
  docker run --rm --network "${BACKUP_DATABASE_DOCKER_NETWORK}" \
    --entrypoint /bin/sh \
    -v "${STAGING}:/backup" \
    "${POSTGRES_BACKUP_IMAGE}" \
    -c 'pg_dump --format=custom --no-owner --no-privileges --file=/backup/database.dump "$(cat /backup/database-url)"'
}

echo "Creating PostgreSQL backup"
run_pg_dump

echo "Copying object storage buckets"
for bucket in ${BACKUP_S3_BUCKETS}; do
  mkdir -p "${STAGING}/objects/${bucket}"
  docker run --rm --network "${BACKUP_OBJECT_DOCKER_NETWORK}" --entrypoint /bin/sh \
    --user "$(id -u):$(id -g)" --security-opt no-new-privileges:true --cap-drop ALL \
    --env HOME=/tmp --tmpfs /tmp:rw,noexec,nosuid,size=32m \
    -v "${STAGING}:/backup" \
    -v "${BACKUP_S3_SECRET_KEY_FILE}:/run/secrets/backup_s3_secret:ro" \
    "${MINIO_CLIENT_IMAGE}" -c \
    'secret="$(cat /run/secrets/backup_s3_secret)" && mc alias set source "$1" "$2" "$secret" >/dev/null && mc mirror --overwrite "source/$3" "/backup/objects/$3"' \
    sh "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${bucket}"
done

(
  cd "${STAGING}"
  find database.dump objects -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

BACKUP_APP_VERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "${PROJECT_ROOT}/package.json" | head -1)"
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  -e BACKUP_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -e BACKUP_GIT_COMMIT="$(git -C "${PROJECT_ROOT}" rev-parse HEAD 2>/dev/null || printf unknown)" \
  -e BACKUP_APP_VERSION="${BACKUP_APP_VERSION}" -e BACKUP_BUCKETS="${BACKUP_S3_BUCKETS}" \
  -v "${SCRIPT_DIR}:/scripts:ro" -v "${STAGING}:/backup" \
  "${NODE_BACKUP_IMAGE}" node /scripts/write-backup-manifest.mjs /backup/manifest.json

tar -C "${STAGING}" -czf "${RAW_ARCHIVE}" manifest.json SHA256SUMS database.dump objects
docker run --rm --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL --network none \
  -v "${PROJECT_ROOT}/scripts:/scripts:ro" \
  -v "${STAGING}:/backup" \
  -v "${BACKUP_ENCRYPTION_KEY_FILE}:/run/secrets/backup_encryption_key:ro" \
  "${NODE_BACKUP_IMAGE}" node /scripts/backup-crypto.mjs encrypt \
  "/backup/$(basename "${RAW_ARCHIVE}")" "/backup/$(basename "${ARCHIVE}")" \
  /run/secrets/backup_encryption_key
mv "${STAGING}/$(basename "${ARCHIVE}")" "${ARCHIVE}"
chmod 600 "${ARCHIVE}"
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
find "${OUTPUT_DIR}" -name 'botparty-release-*.tar.gz.enc*' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
SUCCESS_METRIC_TMP="${BACKUP_METRICS_DIR}/.backup-last-success.prom.$$"
mkdir -p "${BACKUP_METRICS_DIR}"
{
  printf '# HELP botparty_backup_last_success_unixtime_seconds Unix timestamp of the latest successful backup.\n'
  printf '# TYPE botparty_backup_last_success_unixtime_seconds gauge\n'
  printf 'botparty_backup_last_success_unixtime_seconds %s\n' "$(date +%s)"
  printf '# HELP botparty_backup_last_size_bytes Size of the latest encrypted backup archive.\n'
  printf '# TYPE botparty_backup_last_size_bytes gauge\n'
  printf 'botparty_backup_last_size_bytes %s\n' "$(wc -c <"${ARCHIVE}")"
  if [[ -n "${BACKUP_MAX_AGE_SECONDS:-}" ]]; then
    printf '# HELP botparty_backup_max_age_seconds Operator-approved maximum backup age.\n'
    printf '# TYPE botparty_backup_max_age_seconds gauge\n'
    printf 'botparty_backup_max_age_seconds %s\n' "${BACKUP_MAX_AGE_SECONDS}"
  fi
} >"${SUCCESS_METRIC_TMP}"
chmod 644 "${SUCCESS_METRIC_TMP}"
mv "${SUCCESS_METRIC_TMP}" "${BACKUP_METRICS_DIR}/backup-last-success.prom"
BACKUP_SUCCEEDED=1
echo "Backup written: ${ARCHIVE}"
