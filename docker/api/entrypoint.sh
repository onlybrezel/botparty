#!/bin/sh
# BotParty API Entrypoint
# Runs schema push, seeds only for a fully empty database, then starts the API.
set -e

echo "════════════════════════════════════════"
echo "  BotParty API  –  startup"
echo "════════════════════════════════════════"

SCHEMA="packages/prisma/prisma/schema.prisma"

# 1. Apply DB schema changes
echo "🔄 Synchronizing database schema..."
MIGRATIONS_DIR="packages/prisma/prisma/migrations"

if [ -d "$MIGRATIONS_DIR" ] && [ "$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)" -gt 0 ]; then
  echo "📦 Applying Prisma migrations (migrate deploy)..."
  MIGRATE_LOG="$(mktemp)"
  if ! ./node_modules/.bin/prisma migrate deploy \
    --schema="$SCHEMA" \
    >"$MIGRATE_LOG" 2>&1; then
    sed 's/^/  /' "$MIGRATE_LOG"
    rm -f "$MIGRATE_LOG"
    echo "⚠️  migrate deploy failed (likely legacy non-baselined DB). Falling back to db push"
    if [ "${NODE_ENV}" = "production" ]; then
      ./node_modules/.bin/prisma db push \
        --schema="$SCHEMA" \
        --skip-generate \
        2>&1 | sed 's/^/  /'
    else
      ./node_modules/.bin/prisma db push \
        --schema="$SCHEMA" \
        --skip-generate \
        --accept-data-loss \
        2>&1 | sed 's/^/  /'
    fi
  else
    sed 's/^/  /' "$MIGRATE_LOG"
    rm -f "$MIGRATE_LOG"
  fi
else
  echo "⚠️  No Prisma migrations found, falling back to db push"
  if [ "${NODE_ENV}" = "production" ]; then
    ./node_modules/.bin/prisma db push \
      --schema="$SCHEMA" \
      --skip-generate \
      2>&1 | sed 's/^/  /'
  else
    ./node_modules/.bin/prisma db push \
      --schema="$SCHEMA" \
      --skip-generate \
      --accept-data-loss \
      2>&1 | sed 's/^/  /'
  fi
fi
echo "✅ Schema up to date"

# 2. Seed demo data only when the database is completely empty
echo "🌱 Checking whether initial seed is needed..."
./node_modules/.bin/tsx packages/prisma/seed.ts \
  2>&1 | sed 's/^/  /'

echo "════════════════════════════════════════"
echo "  Starting NestJS API..."
echo "════════════════════════════════════════"

exec node apps/api/dist/main.js

