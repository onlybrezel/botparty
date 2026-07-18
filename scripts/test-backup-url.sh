#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
input='postgresql://user:password@database:5432/app?schema=public&connection_limit=10&pool_timeout=30&sslmode=require&connect_timeout=5'
NODE_IMAGE='node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2'
actual="$(docker run --rm --network none --security-opt no-new-privileges:true --cap-drop ALL \
  -e DATABASE_URL="${input}" -v "${ROOT_DIR}/scripts:/scripts:ro" \
  "${NODE_IMAGE}" node /scripts/sanitize-postgres-url.mjs)"
expected='postgresql://user:password@database:5432/app?sslmode=require&connect_timeout=5'

if [[ "${actual}" != "${expected}" ]]; then
  echo "Unexpected pg_dump URL: ${actual}" >&2
  exit 1
fi

echo 'Backup PostgreSQL URL compatibility test passed.'
