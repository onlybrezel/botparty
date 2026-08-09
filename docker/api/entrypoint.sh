#!/bin/sh
# BotParty API Entrypoint. Database changes are owned by the one-shot migrate
# service so horizontally scaled API instances can start independently.
set -eu

echo "════════════════════════════════════════"
echo "  BotParty API  –  startup"
echo "════════════════════════════════════════"

APP_USER="botparty"
APP_GROUP="botparty"

# shellcheck source=docker/api/load-file-secrets.sh
. /load-file-secrets.sh

echo "════════════════════════════════════════"
echo "  Starting NestJS API..."
echo "════════════════════════════════════════"

exec su-exec "${APP_USER}:${APP_GROUP}" node scripts/api-cluster.mjs
