#!/bin/sh

load_file_secret() {
  name="$1"
  file_name="${name}_FILE"
  eval "current=\${${name}:-}"
  eval "file=\${${file_name}:-}"
  if [ -z "${current}" ] && [ -n "${file}" ] && [ -r "${file}" ]; then
    value="$(sed -e 's/\r$//' "${file}")"
    export "${name}=${value}"
  fi
}

for secret_name in DATABASE_URL DATABASE_WRITE_URL DATABASE_READ_URL REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET ROBOT_JWT_SECRET \
  WEBHOOK_SECRET_ENCRYPTION_KEY PAYOUT_DESTINATION_ENCRYPTION_KEY SMTP_PASSWORD \
  LIVEKIT_API_SECRET METRICS_PASSWORD SEED_ADMIN_PASSWORD SEED_DEMO_USER_PASSWORD \
  LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY THUMBNAIL_S3_SECRET_ACCESS_KEY \
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET PAYPAL_CLIENT_SECRET PAYPAL_WEBHOOK_ID; do
  load_file_secret "${secret_name}"
  # The value is now in the process environment. Removing the indirection keeps
  # application startup logs quiet and prevents child processes from trying to
  # read the same file a second time under a non-root UID.
  unset "${secret_name}_FILE"
done

if [ -n "${DATABASE_WRITE_URL:-}" ]; then
  export DATABASE_URL="${DATABASE_WRITE_URL}"
fi
