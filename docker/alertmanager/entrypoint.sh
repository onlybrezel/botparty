#!/bin/sh
set -eu

SOURCE_CONFIG=/etc/alertmanager/alertmanager.yml
RUNTIME_CONFIG=/tmp/alertmanager.yml
WEBHOOK_FILE=${ALERTMANAGER_WEBHOOK_URL_FILE:-/run/secrets/alertmanager_webhook_url}

if [ ! -s "${WEBHOOK_FILE}" ]; then
  echo "Alertmanager webhook URL file is missing or empty: ${WEBHOOK_FILE}" >&2
  exit 1
fi

WEBHOOK_URL=$(tr -d '\r\n' < "${WEBHOOK_FILE}")
case "${WEBHOOK_URL}" in
  http://*|https://*) ;;
  *)
    echo "Alertmanager webhook URL must use http:// or https://" >&2
    exit 1
    ;;
esac

cp "${SOURCE_CONFIG}" "${RUNTIME_CONFIG}"
ESCAPED_URL=$(printf '%s' "${WEBHOOK_URL}" | sed "s/'/''/g")
{
  printf '    webhook_configs:\n'
  printf "      - url: '%s'\n" "${ESCAPED_URL}"
  printf '        send_resolved: true\n'
} >> "${RUNTIME_CONFIG}"

if [ "${1:-}" = "--check" ]; then
  exec /bin/amtool check-config "${RUNTIME_CONFIG}"
fi

exec /bin/alertmanager --config.file="${RUNTIME_CONFIG}" "$@"
