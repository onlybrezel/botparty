#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="postgres-upgrade-test-$(date -u +%Y%m%dT%H%M%SZ)-$$"
SOURCE_VOLUME="${RUN_ID}-source"
TARGET_VOLUME="${RUN_ID}-target"
SOURCE_CONTAINER="${RUN_ID}-seed"
VERIFY_CONTAINER="${RUN_ID}-verify"
PASSWORD_FILE="$(mktemp)"
POSTGRES_16_IMAGE="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
POSTGRES_18_IMAGE="postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"

cleanup() {
  docker rm -f "${SOURCE_CONTAINER}" "${VERIFY_CONTAINER}" >/dev/null 2>&1 || true
  if [[ "${KEEP_POSTGRES_UPGRADE_TEST_VOLUMES:-false}" != 'true' ]]; then
    docker volume rm -f "${SOURCE_VOLUME}" "${TARGET_VOLUME}" >/dev/null 2>&1 || true
  else
    printf 'Retained test volumes: %s %s\n' "${SOURCE_VOLUME}" "${TARGET_VOLUME}" >&2
  fi
  rm -f "${PASSWORD_FILE}"
}
trap cleanup EXIT

wait_for_final_server() {
  local container="$1"
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "${container}" /bin/sh -ec \
      'test "$(head -n 1 "$PGDATA/postmaster.pid" 2>/dev/null)" = 1' >/dev/null 2>&1 \
      && docker exec "${container}" pg_isready -U botparty -d botparty >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "${container}" >&2 || true
  echo 'PostgreSQL test container did not become ready.' >&2
  return 1
}

printf '%s' 'postgres-upgrade-test-password' >"${PASSWORD_FILE}"
chmod 600 "${PASSWORD_FILE}"

docker volume create "${SOURCE_VOLUME}" >/dev/null
docker run -d --name "${SOURCE_CONTAINER}" \
  -e POSTGRES_DB=botparty -e POSTGRES_USER=botparty \
  -e POSTGRES_PASSWORD=postgres-upgrade-test-password \
  -v "${SOURCE_VOLUME}:/var/lib/postgresql/data" \
  "${POSTGRES_16_IMAGE}" >/dev/null
wait_for_final_server "${SOURCE_CONTAINER}"
docker exec -i "${SOURCE_CONTAINER}" psql -v ON_ERROR_STOP=1 -U botparty -d botparty <<'SQL' >/dev/null
CREATE TABLE migration_probe (id integer PRIMARY KEY, payload text NOT NULL);
INSERT INTO migration_probe VALUES (1, 'preserved'), (2, 'also preserved');
SQL
if [[ "$(docker exec "${SOURCE_CONTAINER}" psql -XAt -U botparty -d botparty -c 'SELECT count(*) FROM migration_probe')" != '2' ]]; then
  echo 'Failed to seed the PostgreSQL 16 migration probe.' >&2
  exit 1
fi
docker stop --time 30 "${SOURCE_CONTAINER}" >/dev/null
docker rm "${SOURCE_CONTAINER}" >/dev/null

POSTGRES_UPGRADE_SKIP_COMPOSE_DOWN=true \
POSTGRES_16_VOLUME="${SOURCE_VOLUME}" \
POSTGRES_18_VOLUME="${TARGET_VOLUME}" \
POSTGRES_PASSWORD_FILE_HOST="${PASSWORD_FILE}" \
"${SCRIPT_DIR}/upgrade-postgres-16-to-18.sh" >/dev/null

docker run -d --name "${VERIFY_CONTAINER}" \
  -e PGDATA=/var/lib/postgresql/18/docker \
  -v "${TARGET_VOLUME}:/var/lib/postgresql" \
  "${POSTGRES_18_IMAGE}" >/dev/null
wait_for_final_server "${VERIFY_CONTAINER}"
RESULT="$(docker exec "${VERIFY_CONTAINER}" psql -XAt -U botparty -d botparty -c \
  "SELECT current_setting('server_version_num')::int / 10000, current_setting('data_checksums'), count(*), string_agg(payload, ',' ORDER BY id) FROM migration_probe")"
if [[ "${RESULT}" != '18|on|2|preserved,also preserved' ]]; then
  printf 'Unexpected PostgreSQL 18 migration result: %s\n' "${RESULT}" >&2
  exit 1
fi

echo 'PostgreSQL 16 to 18 volume upgrade test passed.'
