#!/bin/sh
set -eu

# shellcheck source=docker/api/load-file-secrets.sh
. /usr/local/lib/botparty-load-file-secrets.sh

if [ -z "${DATABASE_URL:-}" ]; then
  echo 'DATABASE_URL or DATABASE_URL_FILE is required.' >&2
  exit 1
fi

exec "$@"
