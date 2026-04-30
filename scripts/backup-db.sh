#!/usr/bin/env bash
# backup-db.sh — dump the BotParty Postgres database to a time-stamped .sql.gz
# Usage: ./scripts/backup-db.sh [output-dir]
#
# Reads DB_PASSWORD from the environment or .env file.
# The dump is written to OUTPUT_DIR/botparty-<ISO-8601>.sql.gz (default: ./data/backups)
# Uses docker exec when the postgres container is available, falls back to host pg_dump.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load .env if it exists and the var isn't already set
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

OUTPUT_DIR="${1:-${PROJECT_ROOT}/data/backups}"
mkdir -p "${OUTPUT_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTFILE="${OUTPUT_DIR}/botparty-${TIMESTAMP}.sql.gz"

echo "Backing up ${DB_NAME} → ${OUTFILE}"

if docker container inspect "${CONTAINER_NAME}" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  echo "Using docker exec on ${CONTAINER_NAME}"
  docker exec "${CONTAINER_NAME}" pg_dump \
    --username="${DB_USER}" \
    --format=plain \
    "${DB_NAME}" \
    | gzip -9 > "${OUTFILE}"
else
  echo "Using host pg_dump (${DB_HOST}:${DB_PORT})"
  PGPASSWORD="${DB_PASSWORD}" pg_dump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --username="${DB_USER}" \
    --no-password \
    --format=plain \
    "${DB_NAME}" \
    | gzip -9 > "${OUTFILE}"
fi

echo "Backup complete: ${OUTFILE} ($(du -sh "${OUTFILE}" | cut -f1))"

# Prune backups older than 30 days
find "${OUTPUT_DIR}" -name "botparty-*.sql.gz" -mtime +30 -delete
echo "Old backups pruned (>30 days)"