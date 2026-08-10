#!/bin/sh
set -eu

# shellcheck source=docker/api/load-file-secrets.sh
. /load-file-secrets.sh

if [ -z "${DATABASE_URL:-}" ]; then
  echo 'DATABASE_URL or DATABASE_URL_FILE is required.' >&2
  exit 1
fi

SCHEMA='packages/prisma/prisma/schema.prisma'
MIGRATIONS_DIR='packages/prisma/prisma/migrations'

run_as_app() {
  if command -v su-exec >/dev/null 2>&1; then
    su-exec botparty:botparty "$@"
  else
    "$@"
  fi
}

if [ ! -d "${MIGRATIONS_DIR}" ] || [ "$(find "${MIGRATIONS_DIR}" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 0 ]; then
  echo "No Prisma migrations found in ${MIGRATIONS_DIR}." >&2
  exit 1
fi

echo 'Preparing migration baseline state...'
run_as_app node scripts/prepare-prisma-baseline.mjs

echo 'Applying Prisma migrations...'
run_as_app ./node_modules/.bin/prisma migrate deploy --config=packages/prisma/prisma.config.ts --schema="${SCHEMA}"

echo 'Migrating encrypted webhook secrets...'
run_as_app node scripts/migrate-webhook-secrets.mjs

echo 'Applying the idempotent initial seed...'
run_as_app ./node_modules/.bin/tsx packages/prisma/seed.ts

echo 'Database migration completed.'
