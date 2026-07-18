#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "usage: $0 <botparty-release-*.tar.gz>" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARCHIVE="$(realpath "$1")"
RTO_SECONDS="${RESTORE_RTO_SECONDS:-3600}"
RPO_SECONDS="${RESTORE_RPO_SECONDS:-21600}"
SECRET_DIR="${RESTORE_SECRET_DIR:-${PROJECT_ROOT}/docker/secrets}"
RUN_ID="restore-drill-$(date -u +%Y%m%dT%H%M%SZ)-$$"
PG_CONTAINER="botparty-${RUN_ID}-pg"
MINIO_CONTAINER="botparty-${RUN_ID}-minio"
WORK="$(mktemp -d)"
STARTED="$(date +%s)"
REPORT_DIR="${PROJECT_ROOT}/data/restore-drills"

cleanup() {
  docker rm -f "${PG_CONTAINER}" "${MINIO_CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

mkdir -p "${REPORT_DIR}"
chmod 700 "${REPORT_DIR}"
if [[ -f "${ARCHIVE}.sha256" ]]; then
  (cd "$(dirname "${ARCHIVE}")" && sha256sum -c "$(basename "${ARCHIVE}.sha256")")
fi
tar -C "${WORK}" -xzf "${ARCHIVE}"
(cd "${WORK}" && sha256sum -c SHA256SUMS)

CREATED_EPOCH="$(node -e 'console.log(Math.floor(Date.parse(require(process.argv[1]).createdAt) / 1000))' "${WORK}/manifest.json")"
while IFS= read -r secret_file; do
  if [[ -z "${secret_file}" || ! -s "${SECRET_DIR}/${secret_file}" ]]; then
    echo "Required restore secret is missing or empty: ${secret_file}" >&2
    exit 1
  fi
done < <(node -e 'for (const name of require(process.argv[1]).requiredSecretFiles ?? []) console.log(name)' "${WORK}/manifest.json")
NOW="$(date +%s)"
if (( NOW - CREATED_EPOCH > RPO_SECONDS )); then
  echo "Backup is older than the ${RPO_SECONDS}s RPO" >&2
  exit 1
fi

docker run -d --name "${PG_CONTAINER}" -e POSTGRES_PASSWORD=drill_password -e POSTGRES_DB=botparty_restore -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
docker run -d --name "${MINIO_CONTAINER}" -e MINIO_ROOT_USER=drill_access -e MINIO_ROOT_PASSWORD=drill_secret_123 -p 127.0.0.1::9000 minio/minio:latest server /data >/dev/null
PG_PORT="$(docker port "${PG_CONTAINER}" 5432/tcp | sed 's/.*://')"
MINIO_PORT="$(docker port "${MINIO_CONTAINER}" 9000/tcp | sed 's/.*://')"

PG_READY_STREAK=0
for _ in $(seq 1 60); do
  if docker exec "${PG_CONTAINER}" psql -U postgres -d botparty_restore -Atqc 'SELECT 1' >/dev/null 2>&1; then
    PG_READY_STREAK="$((PG_READY_STREAK + 1))"
    [[ "${PG_READY_STREAK}" -ge 3 ]] && break
  else
    PG_READY_STREAK=0
  fi
  sleep 1
done
if [[ "${PG_READY_STREAK}" -lt 3 ]]; then
  docker logs "${PG_CONTAINER}" >&2
  echo "PostgreSQL did not become ready for the restore drill" >&2
  exit 1
fi

docker cp "${WORK}/database.dump" "${PG_CONTAINER}:/tmp/database.dump"
docker exec "${PG_CONTAINER}" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d botparty_restore /tmp/database.dump
RESTORE_DATABASE_URL="postgresql://postgres:drill_password@127.0.0.1:${PG_PORT}/botparty_restore?schema=public"
DATABASE_URL="${RESTORE_DATABASE_URL}" pnpm --dir "${PROJECT_ROOT}" --filter @botparty/prisma db:migrate:prod
DATABASE_URL="${RESTORE_DATABASE_URL}" pnpm --dir "${PROJECT_ROOT}" --filter @botparty/prisma exec prisma migrate diff \
  --from-url "${RESTORE_DATABASE_URL}" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
docker exec "${PG_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d botparty_restore -c \
  'SELECT COUNT(*) AS migration_count FROM _prisma_migrations WHERE finished_at IS NOT NULL; SELECT COUNT(*) AS user_count FROM users;' >/dev/null

MINIO_READY=false
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1; then
    MINIO_READY=true
    break
  fi
  sleep 1
done
if [[ "${MINIO_READY}" != true ]]; then
  docker logs "${MINIO_CONTAINER}" >&2
  echo "MinIO did not become ready for the restore drill" >&2
  exit 1
fi
for bucket_dir in "${WORK}"/objects/*; do
  [[ -d "${bucket_dir}" ]] || continue
  bucket="$(basename "${bucket_dir}")"
  mkdir -p "${WORK}/restored/${bucket}"
  docker run --rm --network host --entrypoint /bin/sh -v "${WORK}:/backup" minio/mc:latest -c \
    'mc alias set target "$1" drill_access drill_secret_123 >/dev/null && mc mb --ignore-existing "target/$2" >/dev/null && mc mirror --overwrite "/backup/objects/$2" "target/$2"' \
    sh "http://127.0.0.1:${MINIO_PORT}" "${bucket}"
  docker run --rm --network host --entrypoint /bin/sh -v "${WORK}:/backup" minio/mc:latest -c \
    'mc alias set target "$1" drill_access drill_secret_123 >/dev/null && mc mirror --overwrite "target/$2" "/backup/restored/$2"' \
    sh "http://127.0.0.1:${MINIO_PORT}" "${bucket}"
  diff -qr "${WORK}/objects/${bucket}" "${WORK}/restored/${bucket}"
done

FINISHED="$(date +%s)"
ELAPSED="$((FINISHED - STARTED))"
if (( ELAPSED > RTO_SECONDS )); then
  echo "Restore took ${ELAPSED}s and exceeded the ${RTO_SECONDS}s RTO" >&2
  exit 1
fi

RESTORE_REPORT_PATH="${REPORT_DIR}/${RUN_ID}.json" \
RESTORE_ARCHIVE="$(basename "${ARCHIVE}")" \
RESTORE_ELAPSED="${ELAPSED}" \
RESTORE_RPO="${RPO_SECONDS}" \
RESTORE_RTO="${RTO_SECONDS}" \
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.env.RESTORE_REPORT_PATH, `${JSON.stringify({
    status: "passed",
    archive: process.env.RESTORE_ARCHIVE,
    completedAt: new Date().toISOString(),
    elapsedSeconds: Number(process.env.RESTORE_ELAPSED),
    rpoSeconds: Number(process.env.RESTORE_RPO),
    rtoSeconds: Number(process.env.RESTORE_RTO),
    checks: ["archive_checksum", "file_checksums", "postgres_restore", "migration_deploy", "schema_drift", "database_smoke", "object_restore"]
  }, null, 2)}\n`, { mode: 0o600 });
'
echo "Restore drill passed in ${ELAPSED}s: ${REPORT_DIR}/${RUN_ID}.json"
