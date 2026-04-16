#!/usr/bin/env bash
# backup-db.sh — dump the BotParty Postgres database to a time-stamped .sql.gz
# Usage: ./scripts/backup-db.sh [output-dir]
#
# Reads DB_PASSWORD from the environment or .env file.
# The dump is written to OUTPUT_DIR/botparty-<ISO8601>.sql.gz (default: ./data/backups)

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

OUTPUT_DIR="${1:-${PROJECT_ROOT}/data/backups}"
mkdir -p "${OUTPUT_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTFILE="${OUTPUT_DIR}/botparty-${TIMESTAMP}.sql.gz"

echo "Backing up ${DB_NAME} → ${OUTFILE}"

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --no-password \
  --format=plain \
  "${DB_NAME}" \
  | gzip -9 > "${OUTFILE}"

echo "Backup complete: ${OUTFILE} ($(du -sh "${OUTFILE}" | cut -f1))"

# Prune backups older than 30 days
find "${OUTPUT_DIR}" -name "botparty-*.sql.gz" -mtime +30 -delete
echo "Old backups pruned (>30 days)"
