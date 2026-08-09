#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "usage: $0 <botparty-release-*.tar.gz.enc>" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/load-dotenv.sh
. "${SCRIPT_DIR}/load-dotenv.sh"
load_dotenv_file "${PROJECT_ROOT}/.env"
ARCHIVE="$(realpath "$1")"
: "${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"
if [[ ! -r "${BACKUP_ENCRYPTION_KEY_FILE}" ]]; then
  echo "Backup encryption key is not readable: ${BACKUP_ENCRYPTION_KEY_FILE}" >&2
  exit 1
fi
BACKUP_ENCRYPTION_KEY_FILE="$(realpath "${BACKUP_ENCRYPTION_KEY_FILE}")"
RTO_SECONDS="${RESTORE_RTO_SECONDS:-}"
RPO_SECONDS="${RESTORE_RPO_SECONDS:-}"
SECRET_DIR="${RESTORE_SECRET_DIR:-${PROJECT_ROOT}/docker/secrets}"
RUN_ID="restore-drill-$(date -u +%Y%m%dT%H%M%SZ)-$$"
PG_CONTAINER="botparty-${RUN_ID}-pg"
SEAWEED_CONTAINER="botparty-${RUN_ID}-seaweedfs"
REDIS_CONTAINER="botparty-${RUN_ID}-redis"
LIVEKIT_CONTAINER="botparty-${RUN_ID}-livekit"
MAIL_CONTAINER="botparty-${RUN_ID}-mail"
API_CONTAINER="botparty-${RUN_ID}-api"
NETWORK="botparty-${RUN_ID}"
WORK="$(mktemp -d)"
STARTED="$(date +%s)"
REPORT_DIR="${PROJECT_ROOT}/data/restore-drills"
POSTGRES_RESTORE_IMAGE="postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"
SEAWEEDFS_RESTORE_IMAGE="chrislusf/seaweedfs:4.40@sha256:52194fba4fecd0083c842158b3a902ba6e04a63619b2b0efcd08007bdb6a4602"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.27.50@sha256:48c3d4212e2f5b0e24bdc6af7708f9412ce65425a79575e0f78b8f8c0dcd70ab}"
NODE_BACKUP_IMAGE="node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2"
REDIS_RESTORE_IMAGE="redis:7-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99"
LIVEKIT_RESTORE_IMAGE="livekit/livekit-server:v1.8@sha256:621fd87bd64a0c83e1f2418ee0323eb920d00acdd73e5f79b303c64f6cc532af"
MAIL_RESTORE_IMAGE="axllent/mailpit:v1.27.8@sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707"
RESTORE_API_IMAGE="${RESTORE_API_IMAGE:-${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_NAMESPACE:-onlybrezel}/botparty-api:${APP_VERSION:-0.1.3}}"
RESTORE_TEST_EMAIL="${RESTORE_TEST_EMAIL:-admin@botparty.test}"
RESTORE_TEST_PASSWORD_FILE="${RESTORE_TEST_PASSWORD_FILE:-${SECRET_DIR}/seed_admin_password}"

cleanup() {
  for container in "${API_CONTAINER}" "${MAIL_CONTAINER}" "${LIVEKIT_CONTAINER}" "${REDIS_CONTAINER}" "${PG_CONTAINER}" "${SEAWEED_CONTAINER}"; do
    if docker inspect "${container}" >/dev/null 2>&1; then
      if ! docker rm -f "${container}" >/dev/null 2>&1; then
        echo "Warning: restore-drill container ${container} could not be removed automatically." >&2
      fi
    fi
  done
  if docker network inspect "${NETWORK}" >/dev/null 2>&1; then
    if ! docker network rm "${NETWORK}" >/dev/null 2>&1; then
      echo "Warning: restore-drill network ${NETWORK} could not be removed automatically." >&2
    fi
  fi
  rm -rf "${WORK}"
}
trap cleanup EXIT

mkdir -p "${REPORT_DIR}"
chmod 700 "${REPORT_DIR}"
if [[ -f "${ARCHIVE}.sha256" ]]; then
  (cd "$(dirname "${ARCHIVE}")" && sha256sum -c "$(basename "${ARCHIVE}.sha256")")
fi
docker run --rm --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL --network none \
  -v "${PROJECT_ROOT}/scripts:/scripts:ro" \
  -v "${WORK}:/restore" \
  -v "${ARCHIVE}:/restore/source.enc:ro" \
  -v "${BACKUP_ENCRYPTION_KEY_FILE}:/run/secrets/backup_encryption_key:ro" \
  "${NODE_BACKUP_IMAGE}" node /scripts/backup-crypto.mjs decrypt \
  /restore/source.enc /restore/archive.tar.gz /run/secrets/backup_encryption_key
tar -C "${WORK}" -xzf "${WORK}/archive.tar.gz"
(cd "${WORK}" && sha256sum -c SHA256SUMS)

CREATED_EPOCH="$(docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL -v "${WORK}:/restore:ro" \
  "${NODE_BACKUP_IMAGE}" node -e \
  'console.log(Math.floor(Date.parse(require(process.argv[1]).createdAt) / 1000))' \
  /restore/manifest.json)"
while IFS= read -r secret_file; do
  if [[ -z "${secret_file}" || ! -s "${SECRET_DIR}/${secret_file}" ]]; then
    echo "Required restore secret is missing or empty: ${secret_file}" >&2
    exit 1
  fi
done < <(docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL -v "${WORK}:/restore:ro" \
  "${NODE_BACKUP_IMAGE}" node -e \
  'for (const name of require(process.argv[1]).requiredSecretFiles ?? []) console.log(name)' \
  /restore/manifest.json)
NOW="$(date +%s)"
if [[ -n "${RPO_SECONDS}" ]] && (( NOW - CREATED_EPOCH > RPO_SECONDS )); then
  echo "Backup is older than the ${RPO_SECONDS}s RPO" >&2
  exit 1
fi
if [[ ! -r "${RESTORE_TEST_PASSWORD_FILE}" || ! -s "${RESTORE_TEST_PASSWORD_FILE}" ]]; then
  echo "Restore smoke-test password is missing or empty: ${RESTORE_TEST_PASSWORD_FILE}" >&2
  exit 1
fi

docker network create "${NETWORK}" >/dev/null

docker run -d --name "${PG_CONTAINER}" --network "${NETWORK}" --network-alias postgres -e POSTGRES_PASSWORD=drill_password -e POSTGRES_DB=botparty_restore "${POSTGRES_RESTORE_IMAGE}" >/dev/null
docker run -d --name "${SEAWEED_CONTAINER}" --network "${NETWORK}" --network-alias seaweedfs \
  -e AWS_ACCESS_KEY_ID=drill_access \
  -e AWS_SECRET_ACCESS_KEY=drill_secret_123 \
  -e S3_BUCKET=botparty-thumbnails \
  -p 127.0.0.1::8333 \
  "${SEAWEEDFS_RESTORE_IMAGE}" mini -dir=/data -ip=seaweedfs -master.telemetry=false -webdav=false -admin.ui=false >/dev/null
SEAWEED_PORT="$(docker port "${SEAWEED_CONTAINER}" 8333/tcp | sed 's/.*://')"

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
RESTORE_DATABASE_URL_INTERNAL='postgresql://postgres:drill_password@postgres:5432/botparty_restore?schema=public&connect_timeout=5&pool_timeout=5'
docker run --rm --network "${NETWORK}" --user 1001:1001 \
  --read-only --security-opt no-new-privileges:true --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m -e DATABASE_URL="${RESTORE_DATABASE_URL_INTERNAL}" \
  --entrypoint /bin/sh "${RESTORE_API_IMAGE}" -ec \
  './node_modules/.bin/prisma migrate deploy --schema packages/prisma/prisma/schema.prisma && ./node_modules/.bin/prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel packages/prisma/prisma/schema.prisma --exit-code'
docker exec "${PG_CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d botparty_restore -c \
  'SELECT COUNT(*) AS migration_count FROM _prisma_migrations WHERE finished_at IS NOT NULL; SELECT COUNT(*) AS user_count FROM users;' >/dev/null

SEAWEED_READY=false
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${SEAWEED_PORT}/status" >/dev/null 2>&1 \
    || curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${SEAWEED_PORT}/" | grep -Eq '^(200|403)$'; then
    SEAWEED_READY=true
    break
  fi
  sleep 1
done
if [[ "${SEAWEED_READY}" != true ]]; then
  docker logs "${SEAWEED_CONTAINER}" >&2
  echo "SeaweedFS did not become ready for the restore drill" >&2
  exit 1
fi
for bucket_dir in "${WORK}"/objects/*; do
  [[ -d "${bucket_dir}" ]] || continue
  bucket="$(basename "${bucket_dir}")"
  mkdir -p "${WORK}/restored/${bucket}"
  docker run --rm --network host --entrypoint /bin/sh \
    --user "$(id -u):$(id -g)" --security-opt no-new-privileges:true --cap-drop ALL \
    --env HOME=/tmp --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -e AWS_ACCESS_KEY_ID=drill_access -e AWS_SECRET_ACCESS_KEY=drill_secret_123 -e AWS_DEFAULT_REGION=us-east-1 \
    -v "${WORK}:/backup" "${AWS_CLI_IMAGE}" -c \
    'endpoint="$1"; bucket="$2"; aws --endpoint-url "$endpoint" s3 mb "s3://$bucket" 2>/dev/null || true; aws --endpoint-url "$endpoint" s3 sync "/backup/objects/$bucket" "s3://$bucket"' \
    sh "http://127.0.0.1:${SEAWEED_PORT}" "${bucket}"
  docker run --rm --network host --entrypoint /bin/sh \
    --user "$(id -u):$(id -g)" --security-opt no-new-privileges:true --cap-drop ALL \
    --env HOME=/tmp --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -e AWS_ACCESS_KEY_ID=drill_access -e AWS_SECRET_ACCESS_KEY=drill_secret_123 -e AWS_DEFAULT_REGION=us-east-1 \
    -v "${WORK}:/backup" "${AWS_CLI_IMAGE}" -c \
    'aws --endpoint-url "$1" s3 sync "s3://$2" "/backup/restored/$2"' \
    sh "http://127.0.0.1:${SEAWEED_PORT}" "${bucket}"
  diff -qr "${WORK}/objects/${bucket}" "${WORK}/restored/${bucket}"
done

# Verify that the restored state is usable through the actual production API,
# not only through database and object-storage command-line clients.
API_SECRETS="${WORK}/api-secrets"
mkdir -p "${API_SECRETS}"
chmod 755 "${API_SECRETS}"
for secret_path in "${SECRET_DIR}"/*; do
  [[ -f "${secret_path}" ]] || continue
  install -m 644 "${secret_path}" "${API_SECRETS}/$(basename "${secret_path}")"
done
install -m 644 /dev/null "${API_SECRETS}/api_database_url"
printf '%s\n' 'postgresql://postgres:drill_password@postgres:5432/botparty_restore?schema=public&connection_limit=10&pool_timeout=5&connect_timeout=5&sslmode=disable' >"${API_SECRETS}/api_database_url"
printf '%s\n' 'restore-drill-redis-password' >"${API_SECRETS}/redis_password"
printf '%s\n' 'drill_secret_123' >"${API_SECRETS}/object_storage_secret_access_key"
[[ -f "${API_SECRETS}/smtp_password" ]] || install -m 644 /dev/null "${API_SECRETS}/smtp_password"

LIVEKIT_CONFIG="${WORK}/livekit.yaml"
LIVEKIT_SECRET="$(tr -d '\r\n' <"${API_SECRETS}/livekit_api_secret")"
cat >"${LIVEKIT_CONFIG}" <<EOF
port: 7880
rtc:
  use_external_ip: false
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
redis:
  address: redis:6379
  password: restore-drill-redis-password
keys:
  restore-drill-key: ${LIVEKIT_SECRET}
logging:
  level: warn
EOF
chmod 644 "${LIVEKIT_CONFIG}"

docker run -d --name "${REDIS_CONTAINER}" --network "${NETWORK}" --network-alias redis \
  --read-only --security-opt no-new-privileges:true --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m --tmpfs /data:rw,noexec,nosuid,size=64m \
  -v "${API_SECRETS}/redis_password:/run/secrets/redis_password:ro" \
  --entrypoint /bin/sh "${REDIS_RESTORE_IMAGE}" -ec \
  'exec redis-server --save "" --appendonly no --requirepass "$(cat /run/secrets/redis_password)"' >/dev/null
docker run -d --name "${MAIL_CONTAINER}" --network "${NETWORK}" --network-alias mail \
  --read-only --security-opt no-new-privileges:true --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  "${MAIL_RESTORE_IMAGE}" >/dev/null
docker run -d --name "${LIVEKIT_CONTAINER}" --network "${NETWORK}" --network-alias livekit \
  --read-only --security-opt no-new-privileges:true --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  -v "${LIVEKIT_CONFIG}:/run/livekit.yaml:ro" \
  "${LIVEKIT_RESTORE_IMAGE}" --config /run/livekit.yaml >/dev/null

docker run -d --name "${API_CONTAINER}" --network "${NETWORK}" --network-alias api \
  --read-only --security-opt no-new-privileges:true --cap-drop ALL --cap-add SETUID --cap-add SETGID \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m -p 127.0.0.1::4000 \
  -v "${API_SECRETS}:/run/secrets:ro" \
  -e NODE_ENV=production -e PORT=4000 \
  -e DATABASE_URL_FILE=/run/secrets/api_database_url \
  -e DATABASE_WRITE_URL_FILE=/run/secrets/api_database_url \
  -e DATABASE_READ_URL_FILE=/run/secrets/api_database_url \
  -e REDIS_HOST=redis -e REDIS_PORT=6379 -e REDIS_PASSWORD_FILE=/run/secrets/redis_password \
  -e JWT_SECRET_FILE=/run/secrets/jwt_secret \
  -e JWT_REFRESH_SECRET_FILE=/run/secrets/jwt_refresh_secret \
  -e ROBOT_JWT_SECRET_FILE=/run/secrets/robot_jwt_secret \
  -e WEBHOOK_SECRET_ENCRYPTION_KEY_FILE=/run/secrets/webhook_secret_encryption_key \
  -e PAYOUT_DESTINATION_ENCRYPTION_KEY_FILE=/run/secrets/payout_destination_encryption_key \
  -e LIVEKIT_API_KEY=restore-drill-key -e LIVEKIT_API_SECRET_FILE=/run/secrets/livekit_api_secret \
  -e LIVEKIT_URL=ws://livekit:7880 -e LIVEKIT_PUBLIC_URL=wss://restore.invalid/rtc \
  -e LIVEKIT_RECORDINGS_S3_ENDPOINT=http://seaweedfs:8333 \
  -e LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID=drill_access \
  -e LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/object_storage_secret_access_key \
  -e LIVEKIT_RECORDINGS_S3_BUCKET=botparty-recordings \
  -e LIVEKIT_RECORDINGS_S3_REGION=us-east-1 -e LIVEKIT_RECORDINGS_S3_FORCE_PATH_STYLE=true \
  -e THUMBNAIL_S3_ENDPOINT=http://seaweedfs:8333 \
  -e THUMBNAIL_S3_ACCESS_KEY_ID=drill_access \
  -e THUMBNAIL_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/object_storage_secret_access_key \
  -e THUMBNAIL_S3_BUCKET=botparty-thumbnails \
  -e THUMBNAIL_S3_REGION=us-east-1 -e THUMBNAIL_S3_FORCE_PATH_STYLE=true \
  -e SMTP_HOST=mail -e SMTP_PORT=1025 -e SMTP_SECURE=false \
  -e SMTP_PASSWORD_FILE=/run/secrets/smtp_password -e 'SMTP_FROM=BotParty Restore <restore@botparty.invalid>' \
  -e APP_URL=https://restore.invalid -e PUBLIC_WEB_URL=https://restore.invalid \
  -e CORS_ORIGIN=https://restore.invalid -e AUTH_COOKIE_SECURE=false \
  -e METRICS_AUTH_REQUIRED=false \
  -e FEATURE_BILLING_ENABLED=false -e FEATURE_DONATIONS_ENABLED=false \
  -e FEATURE_PAYOUTS_ENABLED=false -e FEATURE_PAID_CONTROLS_ENABLED=false \
  -e FEATURE_SUBSCRIPTIONS_ENABLED=false \
  "${RESTORE_API_IMAGE}" >/dev/null
API_PORT="$(docker port "${API_CONTAINER}" 4000/tcp | sed 's/.*://')"
API_READY=false
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/v1/health/ready" >"${WORK}/readiness.json" 2>/dev/null; then
    API_READY=true
    break
  fi
  if ! api_running="$(docker inspect -f '{{.State.Running}}' "${API_CONTAINER}" 2>/dev/null)"; then
    break
  fi
  if [[ "${api_running}" != true ]]; then
    break
  fi
  sleep 1
done
if [[ "${API_READY}" != true ]]; then
  for failed_container in "${REDIS_CONTAINER}" "${LIVEKIT_CONTAINER}" "${API_CONTAINER}"; do
    if ! docker logs "${failed_container}" >&2; then
      echo "Warning: diagnostics for ${failed_container} could not be read." >&2
    fi
  done
  echo "Restored application did not become ready" >&2
  exit 1
fi

RESTORE_TEST_PASSWORD="$(tr -d '\r\n' <"${RESTORE_TEST_PASSWORD_FILE}")"
RESTORE_TEST_USER_ID="$(printf '%s\n' \
  "SELECT id FROM users WHERE email = :'email' AND role = 'ADMIN' LIMIT 1;" | \
  docker exec -i "${PG_CONTAINER}" psql -U postgres -d botparty_restore \
    -v email="${RESTORE_TEST_EMAIL}" -Atq)"
if [[ -z "${RESTORE_TEST_USER_ID}" ]]; then
  echo "Restore fixture has no administrator for ${RESTORE_TEST_EMAIL}" >&2
  exit 1
fi
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  -e RESTORE_TEST_EMAIL="${RESTORE_TEST_EMAIL}" -e RESTORE_TEST_PASSWORD="${RESTORE_TEST_PASSWORD}" \
  -v "${WORK}:/restore" "${NODE_BACKUP_IMAGE}" node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      email: process.env.RESTORE_TEST_EMAIL,
      password: process.env.RESTORE_TEST_PASSWORD,
    }), { mode: 0o600 });
  ' /restore/login.json
curl -fsS -H 'content-type: application/json' --data-binary "@${WORK}/login.json" \
  "http://127.0.0.1:${API_PORT}/api/v1/auth/login" >"${WORK}/login-response.json"
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  -e RESTORE_TEST_USER_ID="${RESTORE_TEST_USER_ID}" -v "${WORK}:/restore" \
  "${NODE_BACKUP_IMAGE}" node -e '
  const fs = require("fs");
  const response = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!response.accessToken || response.user?.id !== process.env.RESTORE_TEST_USER_ID || response.user?.role !== "ADMIN") {
    throw new Error("restored login response is invalid");
  }
  fs.writeFileSync(process.argv[2], `header = "Authorization: Bearer ${response.accessToken}"\n`, { mode: 0o600 });
' /restore/login-response.json /restore/curl-auth.conf
curl -fsS --config "${WORK}/curl-auth.conf" \
  "http://127.0.0.1:${API_PORT}/api/v1/moderation/admin/overview" >"${WORK}/moderation-overview.json"
docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL -v "${WORK}:/restore:ro" \
  "${NODE_BACKUP_IMAGE}" node -e '
  const overview = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(overview.robots) || overview.robots.length === 0) {
    throw new Error("restored robot data is unavailable through the API");
  }
' /restore/moderation-overview.json

RECORDING_ROW="$(docker exec "${PG_CONTAINER}" psql -U postgres -d botparty_restore -AtF $'\t' -c \
  'SELECT id, "objectKey" FROM recordings ORDER BY "startedAt" DESC LIMIT 1')"
RECORDING_ID="${RECORDING_ROW%%$'\t'*}"
RECORDING_KEY="${RECORDING_ROW#*$'\t'}"
if [[ -z "${RECORDING_ID}" || -z "${RECORDING_KEY}" || "${RECORDING_ROW}" == "${RECORDING_ID}" ]]; then
  echo "Restore fixture has no recording row" >&2
  exit 1
fi
curl -fsS --config "${WORK}/curl-auth.conf" \
  "http://127.0.0.1:${API_PORT}/api/v1/moderation/admin/recordings/${RECORDING_ID}" \
  -o "${WORK}/api-recording.bin"
cmp "${WORK}/objects/botparty-recordings/${RECORDING_KEY}" "${WORK}/api-recording.bin"

FINISHED="$(date +%s)"
ELAPSED="$((FINISHED - STARTED))"
if [[ -n "${RTO_SECONDS}" ]] && (( ELAPSED > RTO_SECONDS )); then
  echo "Restore took ${ELAPSED}s and exceeded the ${RTO_SECONDS}s RTO" >&2
  exit 1
fi

docker run --rm --network none --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  -e RESTORE_ARCHIVE="$(basename "${ARCHIVE}")" -e RESTORE_ELAPSED="${ELAPSED}" \
  -e RESTORE_RPO="${RPO_SECONDS}" -e RESTORE_RTO="${RTO_SECONDS}" \
  -v "${REPORT_DIR}:/reports" "${NODE_BACKUP_IMAGE}" node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], `${JSON.stringify({
    status: "passed",
    archive: process.env.RESTORE_ARCHIVE,
    completedAt: new Date().toISOString(),
    elapsedSeconds: Number(process.env.RESTORE_ELAPSED),
    rpoSeconds: process.env.RESTORE_RPO ? Number(process.env.RESTORE_RPO) : null,
    rtoSeconds: process.env.RESTORE_RTO ? Number(process.env.RESTORE_RTO) : null,
    checks: ["archive_checksum", "encryption_authentication", "file_checksums", "postgres_restore", "migration_deploy", "schema_drift", "database_smoke", "object_restore", "application_readiness", "restored_login", "authenticated_data_query", "recording_download"]
  }, null, 2)}\n`, { mode: 0o600 });
' "/reports/${RUN_ID}.json"
echo "Restore drill passed in ${ELAPSED}s: ${REPORT_DIR}/${RUN_ID}.json"
