#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "${PROJECT_ROOT}")}"
OLD_VOLUME="${POSTGRES_16_VOLUME:-${PROJECT_NAME}_postgres_data}"
NEW_VOLUME="${POSTGRES_18_VOLUME:-${PROJECT_NAME}_postgres18_data}"
DB_NAME="${POSTGRES_DB:-botparty}"
DB_USER="${POSTGRES_USER:-botparty}"
SECRET_DIR="${BOTPARTY_SECRET_DIR:-${PROJECT_ROOT}/docker/secrets}"
PASSWORD_FILE="${POSTGRES_PASSWORD_FILE_HOST:-${SECRET_DIR}/db_password}"
POSTGRES_16_IMAGE="${POSTGRES_16_IMAGE:-postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777}"
POSTGRES_18_IMAGE="${POSTGRES_18_IMAGE:-postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15}"
RUN_ID="postgres-upgrade-$(date -u +%Y%m%dT%H%M%SZ)-$$"
SOURCE_CONTAINER="${RUN_ID}-source"
TARGET_CONTAINER="${RUN_ID}-target"
NETWORK="${RUN_ID}"
WORK="$(mktemp -d)"
UPGRADE_SUCCEEDED=0

cleanup() {
  local container
  for container in "${SOURCE_CONTAINER}" "${TARGET_CONTAINER}"; do
    docker rm -f "${container}" >/dev/null 2>&1 || true
  done
  docker network rm "${NETWORK}" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
  if [[ "${UPGRADE_SUCCEEDED}" -ne 1 ]]; then
    printf 'Upgrade failed. The PostgreSQL 16 source volume was not removed: %s\n' "${OLD_VOLUME}" >&2
  fi
}
trap cleanup EXIT

wait_for_database() {
  local container="$1"
  local expected_major="$2"
  local attempt
  for attempt in $(seq 1 90); do
    if docker exec "${container}" /bin/sh -ec \
      'test "$(head -n 1 "$PGDATA/postmaster.pid" 2>/dev/null)" = 1' >/dev/null 2>&1 \
      && docker exec "${container}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
      local actual_major
      actual_major="$(docker exec "${container}" psql -XAt -U "${DB_USER}" -d "${DB_NAME}" -c "SHOW server_version_num" | cut -c1-2)"
      if [[ "${actual_major}" != "${expected_major}" ]]; then
        printf 'Expected PostgreSQL %s, got server_version_num major %s.\n' "${expected_major}" "${actual_major}" >&2
        return 1
      fi
      return 0
    fi
    sleep 1
  done
  docker logs "${container}" >&2 || true
  printf 'PostgreSQL %s did not become ready.\n' "${expected_major}" >&2
  return 1
}

write_row_manifest() {
  local container="$1"
  local output="$2"
  docker exec -i "${container}" psql -X -qAt -U "${DB_USER}" -d "${DB_NAME}" >"${output}" <<'SQL'
SELECT format(
  'SELECT %L || E''\\t'' || count(*) FROM %I.%I;',
  schemaname || '.' || relname,
  schemaname,
  relname
)
FROM pg_stat_user_tables
ORDER BY schemaname, relname
\gexec
SQL
  LC_ALL=C sort -o "${output}" "${output}"
}

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required for the PostgreSQL upgrade.' >&2
  exit 1
fi
if [[ ! -s "${PASSWORD_FILE}" ]]; then
  printf 'PostgreSQL password file is missing or empty: %s\n' "${PASSWORD_FILE}" >&2
  exit 1
fi
if ! docker volume inspect "${OLD_VOLUME}" >/dev/null 2>&1; then
  printf 'PostgreSQL 16 source volume does not exist: %s\n' "${OLD_VOLUME}" >&2
  exit 1
fi
if docker volume inspect "${NEW_VOLUME}" >/dev/null 2>&1; then
  printf 'PostgreSQL 18 target volume already exists: %s\n' "${NEW_VOLUME}" >&2
  echo 'Refusing to overwrite it. Inspect or remove the failed target explicitly before retrying.' >&2
  exit 1
fi

if [[ "${POSTGRES_UPGRADE_SKIP_COMPOSE_DOWN:-false}" != "true" ]]; then
  echo 'Stopping the Compose stack for a consistent offline upgrade'
  docker compose --project-directory "${PROJECT_ROOT}" down --remove-orphans
fi

if [[ -n "$(docker ps -q --filter "volume=${OLD_VOLUME}")" ]]; then
  printf 'A running container still uses source volume %s.\n' "${OLD_VOLUME}" >&2
  exit 1
fi

SOURCE_MAJOR="$(docker run --rm -v "${OLD_VOLUME}:/source:ro" --entrypoint /bin/sh "${POSTGRES_16_IMAGE}" -ec 'cat /source/PG_VERSION')"
if [[ "${SOURCE_MAJOR}" != '16' ]]; then
  printf 'Source volume %s contains PostgreSQL %s, expected 16.\n' "${OLD_VOLUME}" "${SOURCE_MAJOR}" >&2
  exit 1
fi

docker network create "${NETWORK}" >/dev/null
docker run -d --name "${SOURCE_CONTAINER}" --network "${NETWORK}" \
  -v "${OLD_VOLUME}:/var/lib/postgresql/data" \
  "${POSTGRES_16_IMAGE}" >/dev/null
wait_for_database "${SOURCE_CONTAINER}" 16

echo 'Creating a consistent PostgreSQL 16 custom-format dump'
docker exec "${SOURCE_CONTAINER}" pg_dump \
  --format=custom --no-owner --no-privileges \
  -U "${DB_USER}" -d "${DB_NAME}" -f /tmp/database.dump
docker cp "${SOURCE_CONTAINER}:/tmp/database.dump" "${WORK}/database.dump"
write_row_manifest "${SOURCE_CONTAINER}" "${WORK}/source-rows.tsv"
docker stop --time 60 "${SOURCE_CONTAINER}" >/dev/null
docker rm "${SOURCE_CONTAINER}" >/dev/null

docker volume create \
  --label botparty.postgres-major=18 \
  --label botparty.upgraded-from="${OLD_VOLUME}" \
  "${NEW_VOLUME}" >/dev/null

docker run -d --name "${TARGET_CONTAINER}" --network "${NETWORK}" \
  -e POSTGRES_DB="${DB_NAME}" -e POSTGRES_USER="${DB_USER}" \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/db_password \
  -e PGDATA=/var/lib/postgresql/18/docker \
  -e POSTGRES_INITDB_ARGS=--data-checksums \
  -v "${NEW_VOLUME}:/var/lib/postgresql" \
  -v "${PASSWORD_FILE}:/run/secrets/db_password:ro" \
  "${POSTGRES_18_IMAGE}" >/dev/null
wait_for_database "${TARGET_CONTAINER}" 18

docker cp "${WORK}/database.dump" "${TARGET_CONTAINER}:/tmp/database.dump"
echo 'Restoring into the new PostgreSQL 18 cluster'
docker exec "${TARGET_CONTAINER}" pg_restore \
  --exit-on-error --clean --if-exists --no-owner --no-privileges \
  -U "${DB_USER}" -d "${DB_NAME}" /tmp/database.dump
docker exec "${TARGET_CONTAINER}" vacuumdb --analyze-in-stages -U "${DB_USER}" -d "${DB_NAME}"
write_row_manifest "${TARGET_CONTAINER}" "${WORK}/target-rows.tsv"

if ! diff -u "${WORK}/source-rows.tsv" "${WORK}/target-rows.tsv"; then
  echo 'Source and target row counts differ. The target volume remains available for diagnosis.' >&2
  exit 1
fi
if [[ "$(docker exec "${TARGET_CONTAINER}" psql -XAt -U "${DB_USER}" -d "${DB_NAME}" -c 'SHOW data_checksums')" != 'on' ]]; then
  echo 'The PostgreSQL 18 target was initialized without data checksums.' >&2
  exit 1
fi

docker stop --time 60 "${TARGET_CONTAINER}" >/dev/null
docker rm "${TARGET_CONTAINER}" >/dev/null
UPGRADE_SUCCEEDED=1

cat <<EOF
PostgreSQL upgrade completed successfully.
Source volume (retained): ${OLD_VOLUME}
Target volume:           ${NEW_VOLUME}
Database:                ${DB_NAME}
Row-count verification:  passed
Data checksums:           on

Start the migrated release with: docker compose up -d
Remove ${OLD_VOLUME} only after the application and a restore drill have been verified.
EOF
