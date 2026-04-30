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

# 1. Apply DB schema changes
echo "🔄 Synchronizing database schema..."
MIGRATIONS_DIR="packages/prisma/prisma/migrations"

if [ -d "$MIGRATIONS_DIR" ] && [ "$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)" -gt 0 ]; then
  echo "📦 Applying Prisma migrations (migrate deploy)..."
  DEPLOY_LOG="$(mktemp)"
  set +e
  ./node_modules/.bin/prisma migrate deploy --schema="$SCHEMA" >"$DEPLOY_LOG" 2>&1
  DEPLOY_EXIT=$?
  set -e
  cat "$DEPLOY_LOG"

  # Auto-baseline: existing production database created via `prisma db push`
  # has a populated schema but no `_prisma_migrations` history. Prisma fails
  # with P3005 in that case. Detect it, mark every committed migration as
  # already applied, and retry `migrate deploy`.
  if [ "$DEPLOY_EXIT" -ne 0 ] && grep -q "P3005" "$DEPLOY_LOG"; then
    echo "ℹ️  Detected P3005 (schema present, no migration history)."
    echo "🧷 Baselining: marking existing migrations as applied..."
    BASELINE_OK=1
    for dir in "$MIGRATIONS_DIR"/*/; do
      name="$(basename "$dir")"
      echo "   • $name"
      if ! ./node_modules/.bin/prisma migrate resolve \
            --schema="$SCHEMA" \
            --applied "$name"; then
        echo "❌ Failed to baseline migration: $name"
        BASELINE_OK=0
        break
      fi
    done
    if [ "$BASELINE_OK" -eq 1 ]; then
      echo "🔁 Re-running migrate deploy after baseline..."
      if ./node_modules/.bin/prisma migrate deploy --schema="$SCHEMA"; then
        DEPLOY_EXIT=0
      fi
    fi
  fi
  rm -f "$DEPLOY_LOG"

  if [ "$DEPLOY_EXIT" -ne 0 ]; then
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

# 2. Seed demo data only when the database is completely empty
echo "🌱 Checking whether initial seed is needed..."
./node_modules/.bin/tsx packages/prisma/seed.ts \
  2>&1 | sed 's/^/  /'

echo "════════════════════════════════════════"
echo "  Starting NestJS API..."
echo "════════════════════════════════════════"

exec su-exec "${APP_USER}:${APP_GROUP}" node apps/api/dist/main.js
