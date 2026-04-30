#!/usr/bin/env bash
# restore-db.sh — restore a BotParty Postgres dump produced by backup-db.sh.
# Usage: ./scripts/restore-db.sh <path/to/botparty-<TIMESTAMP>.sql[.gz]>
#
# Stops the API container so no writes happen mid-restore, drops & recreates
# the database, pipes the dump through psql, then restarts the stack.
# Reads DB_PASSWORD from the environment or .env, mirroring backup-db.sh.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <dump.sql[.gz]>" >&2
  exit 64
fi

DUMP="$1"
if [[ ! -f "${DUMP}" ]]; then
  echo "restore-db: dump not found: ${DUMP}" >&2
  exit 66
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "${DB_PASSWORD:-}" && -f "${PROJECT_ROOT}/.env" ]]; then
  # shellcheck source=/dev/null
  set -a; source "${PROJECT_ROOT}/.env"; set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-botparty}"
DB_USER="${DB_USER:-botparty}"
DB_PASSWORD="${DB_PASSWORD:-botparty_secret}"
CONTAINER_NAME="${DB_CONTAINER:-botparty-postgres}"

echo "restore-db: target database ${DB_NAME} on ${DB_HOST}:${DB_PORT} as ${DB_USER}"
echo "restore-db: dump $(basename "${DUMP}")"

if [[ "${BOTPARTY_RESTORE_NONINTERACTIVE:-}" != "1" ]]; then
  read -r -p "This will DROP and recreate ${DB_NAME}. Continue? [y/N] " ack
  case "${ack}" in
    y|Y|yes|YES) ;;
    *) echo "restore-db: aborted." >&2; exit 1 ;;
  esac
fi

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
  if [[ -f "${COMPOSE_FILE}" ]]; then
    echo "restore-db: stopping api/streamer/agents to quiesce writers..."
    docker compose -f "${COMPOSE_FILE}" stop api streamer agents 2>/dev/null || true
  fi

  PSQL=(docker exec -i -e "PGPASSWORD=${DB_PASSWORD}" "${CONTAINER_NAME}" psql -U "${DB_USER}" -h 127.0.0.1)

  echo "restore-db: dropping & recreating ${DB_NAME}"
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

  echo "restore-db: streaming dump into ${DB_NAME}"
  if [[ "${DUMP}" == *.gz ]]; then
    gunzip -c "${DUMP}" | "${PSQL[@]}" -d "${DB_NAME}"
  else
    "${PSQL[@]}" -d "${DB_NAME}" < "${DUMP}"
  fi

  if [[ -f "${COMPOSE_FILE}" ]]; then
    echo "restore-db: restarting api/streamer/agents"
    docker compose -f "${COMPOSE_FILE}" up -d api streamer agents 2>/dev/null || true
  fi
else
  PSQL=(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}")
  PGPASSWORD="${DB_PASSWORD}" "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
  PGPASSWORD="${DB_PASSWORD}" "${PSQL[@]}" -d postgres -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"
  if [[ "${DUMP}" == *.gz ]]; then
    gunzip -c "${DUMP}" | PGPASSWORD="${DB_PASSWORD}" "${PSQL[@]}" -d "${DB_NAME}"
  else
    PGPASSWORD="${DB_PASSWORD}" "${PSQL[@]}" -d "${DB_NAME}" < "${DUMP}"
  fi
fi

echo "restore-db: done. Run \`docker compose logs -f api\` to verify migrations."
