#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
. "$ROOT_DIR/scripts/load-dotenv.sh"

ENV_FILE=${1:-.env}
if [ ! -f "$ENV_FILE" ]; then
  echo "Production preflight failed: environment file '$ENV_FILE' does not exist." >&2
  exit 1
fi

load_dotenv_file "$ENV_FILE"
node scripts/verify-production-readiness.mjs
docker compose --env-file "$ENV_FILE" config --quiet

echo "Docker Compose production configuration is valid."
