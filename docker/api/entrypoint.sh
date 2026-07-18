#!/bin/sh
# BotParty API Entrypoint
# Applies migrations (production: strict), seeds an empty database, then starts the API.
set -e

echo "════════════════════════════════════════"
echo "  BotParty API  –  startup"
echo "════════════════════════════════════════"

SCHEMA="packages/prisma/prisma/schema.prisma"
APP_USER="botparty"
APP_GROUP="botparty"

. /load-file-secrets.sh

# 1. Apply DB schema changes
echo "🔄 Synchronizing database schema..."
MIGRATIONS_DIR="packages/prisma/prisma/migrations"

if [ -d "$MIGRATIONS_DIR" ] && [ "$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)" -gt 0 ]; then
  # Existing installations that already ran the historical migrations only
  # receive the one known baseline marker. Empty databases execute the baseline
  # normally. Schema-only databases without migration history remain fail-closed.
  node scripts/prepare-prisma-baseline.mjs
  echo "📦 Applying Prisma migrations (migrate deploy)..."
  if ! ./node_modules/.bin/prisma migrate deploy --schema="$SCHEMA"; then
    echo "❌ migrate deploy failed."
    if [ "${NODE_ENV}" = "production" ]; then
      echo "   Refusing to fall back to 'db push' in production."
      echo "   Resolve the failed migration manually before redeploying."
      exit 1
    fi
    echo "⚠️  (dev/non-production) Falling back to 'prisma db push' for convenience."
    ./node_modules/.bin/prisma db push \
      --schema="$SCHEMA" \
      --skip-generate \
      --accept-data-loss
  fi
else
  if [ "${NODE_ENV}" = "production" ]; then
    echo "❌ No Prisma migrations found in $MIGRATIONS_DIR — refusing to start in production."
    echo "   Run 'pnpm prisma migrate dev' locally and commit the migration."
    exit 1
  fi
  echo "⚠️  No Prisma migrations found, falling back to db push (dev only)."
  ./node_modules/.bin/prisma db push \
    --schema="$SCHEMA" \
    --skip-generate \
    --accept-data-loss
fi
echo "✅ Schema up to date"

# Convert the historical plaintext/XOR webhook format before workers can read it.
node scripts/migrate-webhook-secrets.mjs

# 2. Seed demo data only when the database is completely empty
echo "🌱 Checking whether initial seed is needed..."
./node_modules/.bin/tsx packages/prisma/seed.ts \
  2>&1 | sed 's/^/  /'

echo "════════════════════════════════════════"
echo "  Starting NestJS API..."
echo "════════════════════════════════════════"

exec su-exec "${APP_USER}:${APP_GROUP}" node apps/api/dist/main.js
