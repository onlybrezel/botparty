#!/usr/bin/env bash
set -euo pipefail

PROJECT="botparty-secret-smoke-$$"
SECRET_DIR="$(mktemp -d)"
export BOTPARTY_SECRET_DIR="${SECRET_DIR}"
export LIVEKIT_API_KEY="botparty-secret-smoke"

cleanup() {
  docker compose -p "${PROJECT}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${SECRET_DIR}"
}
trap cleanup EXIT

write_secret() {
  printf '%s' "$2" > "${SECRET_DIR}/$1"
  chmod 600 "${SECRET_DIR}/$1"
}

write_secret db_password 'secret-smoke-database-password'
write_secret api_database_url 'postgresql://botparty:secret-smoke-database-password@postgres:5432/botparty?schema=public'
write_secret redis_password 'secret-smoke-redis-password'
write_secret minio_root_password 'secret-smoke-minio-password'
write_secret livekit_api_secret 'secret-smoke-livekit-secret-at-least-32-characters'
write_secret jwt_secret 'secret-smoke-jwt-secret-at-least-32-characters'
write_secret jwt_refresh_secret 'secret-smoke-refresh-secret-at-least-32-characters'
write_secret robot_jwt_secret 'secret-smoke-robot-secret-at-least-32-characters'
write_secret webhook_secret_encryption_key 'secret-smoke-webhook-key-at-least-32-characters'
write_secret payout_destination_encryption_key 'secret-smoke-payout-key-at-least-32-characters'
write_secret metrics_password 'secret-smoke-metrics-password'
write_secret smtp_password 'secret-smoke-smtp-password'
write_secret alertmanager_webhook_url 'http://127.0.0.1:9099/alerts'
write_secret seed_admin_password ''
write_secret seed_demo_user_password ''

rendered="$(docker compose -p "${PROJECT}" config)"
for forbidden in POSTGRES_PASSWORD: REDIS_PASSWORD: MINIO_ROOT_PASSWORD: LIVEKIT_API_SECRET: JWT_SECRET: JWT_REFRESH_SECRET: ROBOT_JWT_SECRET:; do
  if grep -Eq "^[[:space:]]+${forbidden}" <<<"${rendered}"; then
    echo "Direct secret environment found in rendered Compose: ${forbidden}" >&2
    exit 1
  fi
done

docker compose -p "${PROJECT}" up -d postgres redis minio livekit-config
for _ in $(seq 1 60); do
  postgres_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${PROJECT}-postgres-1" 2>/dev/null || true)"
  redis_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${PROJECT}-redis-1" 2>/dev/null || true)"
  minio_state="$(docker inspect -f '{{.State.Status}}' "${PROJECT}-minio-1" 2>/dev/null || true)"
  config_exit="$(docker inspect -f '{{.State.ExitCode}}' "${PROJECT}-livekit-config-1" 2>/dev/null || true)"
  if [[ "${postgres_state}" == healthy && "${redis_state}" == healthy && "${minio_state}" == running && "${config_exit}" == 0 ]]; then
    echo 'File-backed Compose secret smoke passed.'
    exit 0
  fi
  sleep 1
done

docker compose -p "${PROJECT}" ps
docker compose -p "${PROJECT}" logs --no-color postgres redis minio livekit-config
exit 1
