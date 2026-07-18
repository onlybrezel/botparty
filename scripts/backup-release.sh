#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${1:-${PROJECT_ROOT}/data/backups}"
: "${DATABASE_URL:?DATABASE_URL is required; no backup credential fallback is allowed}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY is required}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY is required}"

# Prisma accepts a `schema` URL parameter that PostgreSQL client tools do not.
# Keep all PostgreSQL parameters intact and remove only Prisma's extension.
PG_DUMP_DATABASE_URL="$(DATABASE_URL="${DATABASE_URL}" node -e '
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("schema");
  process.stdout.write(url.toString());
')"

BACKUP_S3_BUCKETS="${BACKUP_S3_BUCKETS:-botparty-thumbnails botparty-recordings}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGING="$(mktemp -d)"
ARCHIVE="${OUTPUT_DIR}/botparty-release-${TIMESTAMP}.tar.gz"
trap 'rm -rf "${STAGING}"' EXIT
mkdir -p "${OUTPUT_DIR}" "${STAGING}/objects"
chmod 700 "${OUTPUT_DIR}" "${STAGING}"

run_pg_dump() {
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --format=custom --no-owner --no-privileges --file="${STAGING}/database.dump" "${PG_DUMP_DATABASE_URL}"
    return
  fi
  docker run --rm --network host \
    -v "${STAGING}:/backup" \
    postgres:16-alpine \
    pg_dump --format=custom --no-owner --no-privileges --file=/backup/database.dump "${PG_DUMP_DATABASE_URL}"
}

run_mc() {
  if command -v mc >/dev/null 2>&1; then
    mc "$@"
    return
  fi
  docker run --rm --network host -v "${STAGING}:/backup" minio/mc:latest "$@"
}

echo "Creating PostgreSQL backup"
run_pg_dump

echo "Copying object storage buckets"
run_mc alias set source "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}" >/dev/null
for bucket in ${BACKUP_S3_BUCKETS}; do
  mkdir -p "${STAGING}/objects/${bucket}"
  if command -v mc >/dev/null 2>&1; then
    mc mirror --overwrite "source/${bucket}" "${STAGING}/objects/${bucket}"
  else
    docker run --rm --network host --entrypoint /bin/sh -v "${STAGING}:/backup" minio/mc:latest -c \
      'mc alias set source "$1" "$2" "$3" >/dev/null && mc mirror --overwrite "source/$4" "/backup/objects/$4"' \
      sh "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}" "${bucket}"
  fi
done

(
  cd "${STAGING}"
  find database.dump objects -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

BACKUP_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
BACKUP_GIT_COMMIT="$(git -C "${PROJECT_ROOT}" rev-parse HEAD 2>/dev/null || printf unknown)" \
BACKUP_APP_VERSION="$(node -p "require('${PROJECT_ROOT}/package.json').version")" \
BACKUP_BUCKETS="${BACKUP_S3_BUCKETS}" \
node -e '
  const fs = require("fs");
  const manifest = {
    formatVersion: 1,
    createdAt: process.env.BACKUP_CREATED_AT,
    appVersion: process.env.BACKUP_APP_VERSION,
    gitCommit: process.env.BACKUP_GIT_COMMIT,
    postgresMajor: 16,
    buckets: process.env.BACKUP_BUCKETS.split(/\s+/).filter(Boolean),
    requiredSecretFiles: [
      "api_database_url", "jwt_secret", "jwt_refresh_secret", "robot_jwt_secret",
      "webhook_secret_encryption_key", "payout_destination_encryption_key",
      "livekit_api_secret", "redis_password", "smtp_password",
      "alertmanager_webhook_url"
    ],
    restoreCommand: "./scripts/restore-drill.sh <archive>"
  };
  fs.writeFileSync(process.argv[1], `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
' "${STAGING}/manifest.json"

tar -C "${STAGING}" -czf "${ARCHIVE}" manifest.json SHA256SUMS database.dump objects
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
find "${OUTPUT_DIR}" -name 'botparty-release-*.tar.gz*' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
echo "Backup written: ${ARCHIVE}"
