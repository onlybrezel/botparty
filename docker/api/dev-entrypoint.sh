#!/bin/sh
set -eu

. /usr/local/lib/botparty-load-file-secrets.sh

if [ -z "${DATABASE_URL:-}" ]; then
  echo 'DATABASE_URL or DATABASE_URL_FILE is required.' >&2
  exit 1
fi

pnpm --filter @botparty/prisma db:migrate:prod
pnpm --filter @botparty/prisma db:seed

exec "$@"
