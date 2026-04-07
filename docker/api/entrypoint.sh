#!/bin/sh
# BotParty API Entrypoint
# Runs schema push, seeds only for a fully empty database, then starts the API.
set -e

echo "════════════════════════════════════════"
echo "  BotParty API  –  startup"
echo "════════════════════════════════════════"

SCHEMA="packages/prisma/prisma/schema.prisma"

# 1. Push schema to database (idempotent, safe for dev/demo)
echo "🔄 Synchronizing database schema..."
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
echo "✅ Schema up to date"

# 2. Seed demo data only when the database is completely empty
echo "🌱 Checking whether initial seed is needed..."
./node_modules/.bin/tsx packages/prisma/seed.ts \
  2>&1 | sed 's/^/  /'

echo "════════════════════════════════════════"
echo "  Starting NestJS API..."
echo "════════════════════════════════════════"

exec node apps/api/dist/main.js

