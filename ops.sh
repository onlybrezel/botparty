#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_SERVICES=(api web nginx)
PLATFORM_SERVICES=(livekit cadvisor)
DATA_SERVICES=(postgres redis)
FULL_SERVICES=("${DATA_SERVICES[@]}" "${PLATFORM_SERVICES[@]}" "${APP_SERVICES[@]}")
IMAGE_SERVICES=(postgres redis livekit cadvisor nginx)

ANNOUNCE_CHANNEL="ws:system:shutdown"
DEFAULT_RETRY_AFTER_MS="${WS_SHUTDOWN_RETRY_AFTER_MS:-12000}"
DEFAULT_DRAIN_SEC="${OPS_DRAIN_SEC:-6}"
MAINTENANCE_RETRY_AFTER_MS="${OPS_MAINTENANCE_RETRY_AFTER_MS:-30000}"
MAINTENANCE_DRAIN_SEC="${OPS_MAINTENANCE_DRAIN_SEC:-8}"

info() { printf '  -> %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

load_env() {
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    set -a && source .env && set +a
  fi
}

service_list_for_scope() {
  local scope="$1"
  case "$scope" in
    app)
      printf '%s\n' "${APP_SERVICES[@]}"
      ;;
    full)
      printf '%s\n' "${FULL_SERVICES[@]}"
      ;;
    *)
      die "Unknown scope: $scope"
      ;;
  esac
}

compose_running_service() {
  local service="$1"
  docker compose ps --status running --services 2>/dev/null | grep -qx "$service"
}

message_for_reason() {
  local reason="$1"
  case "$reason" in
    maintenance)
      printf '%s' "Server maintenance in progress. Please try again shortly."
      ;;
    update|deploy)
      printf '%s' "Server update in progress. Reconnecting soon..."
      ;;
    restart)
      printf '%s' "Realtime restart in progress. Reconnecting soon..."
      ;;
    *)
      printf '%s' "Server event in progress (${reason}). Reconnecting soon..."
      ;;
  esac
}

publish_shutdown_notice() {
  local reason="$1"
  local retry_after_ms="$2"
  local message="$3"

  if ! compose_running_service redis; then
    warn "Redis is not running; skipping realtime shutdown announcement."
    return 0
  fi

  load_env
  local redis_password="${REDIS_PASSWORD:-botparty_redis_secret}"
  local payload
  payload=$(
    printf '{"event":"server:shutdown","data":{"message":"%s","reason":"%s","retryAfterMs":%s,"ts":%s}}' \
      "$message" \
      "$reason" \
      "$retry_after_ms" \
      "$(date +%s)000"
  )

  info "Announcing ${reason} to connected clients"
  docker compose exec -T redis redis-cli -a "$redis_password" PUBLISH "$ANNOUNCE_CHANNEL" "$payload" >/dev/null
}

wait_for_drain() {
  local seconds="$1"
  if [[ "$seconds" -le 0 ]]; then
    return 0
  fi
  info "Waiting ${seconds}s for clients to drain"
  sleep "$seconds"
}

compose_up_scope() {
  local scope="$1"
  mapfile -t services < <(service_list_for_scope "$scope")
  docker compose up -d "${services[@]}"
}

compose_up_scope_build() {
  local scope="$1"
  mapfile -t services < <(service_list_for_scope "$scope")
  docker compose up -d --build "${services[@]}"
}

compose_stop_scope() {
  local scope="$1"
  mapfile -t services < <(service_list_for_scope "$scope")
  docker compose stop "${services[@]}"
}

compose_remove_scope() {
  local scope="$1"
  mapfile -t services < <(service_list_for_scope "$scope")
  docker compose rm -sf "${services[@]}" >/dev/null 2>&1 || true
}

compose_pull_scope_images() {
  local scope="$1"
  local service
  local pulled=()
  while IFS= read -r service; do
    for image_service in "${IMAGE_SERVICES[@]}"; do
      if [[ "$service" == "$image_service" ]]; then
        pulled+=("$service")
        break
      fi
    done
  done < <(service_list_for_scope "$scope")

  if [[ "${#pulled[@]}" -gt 0 ]]; then
    info "Pulling image-based services: ${pulled[*]}"
    docker compose pull "${pulled[@]}"
  fi
}

run_restart() {
  local scope="$1"
  local reason="$2"
  local retry_after_ms="$3"
  local drain_sec="$4"
  local build_mode="$5"
  local pull_git="$6"

  publish_shutdown_notice "$reason" "$retry_after_ms" "$(message_for_reason "$reason")"
  wait_for_drain "$drain_sec"

  if [[ "$pull_git" == "yes" ]]; then
    info "Pulling latest changes"
    git pull --ff-only
  fi

  if [[ "$scope" == "full" ]]; then
    compose_pull_scope_images "$scope"
  fi

  info "Recreating ${scope} services"
  compose_remove_scope "$scope"

  if [[ "$build_mode" == "build" ]]; then
    compose_up_scope_build "$scope"
  else
    compose_up_scope "$scope"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  ./ops.sh start
  ./ops.sh full-start
  ./ops.sh stop
  ./ops.sh full-stop
  ./ops.sh restart
  ./ops.sh restart-full
  ./ops.sh update
  ./ops.sh update-full
  ./ops.sh maintenance-on
  ./ops.sh maintenance-on-full
  ./ops.sh resume
  ./ops.sh resume-full
  ./ops.sh announce <reason> [retry_after_ms]
  ./ops.sh status

Commands:
  start              Start app services only: api web nginx.
  full-start         Start the full stack: postgres redis livekit cadvisor api web nginx.
  stop               Stop app services only.
  full-stop          Stop the full stack.
  restart            Announce restart, wait briefly, recreate app services without git pull/build.
  restart-full       Same as restart, but include livekit/cadvisor/postgres/redis.
  update             Announce update, git pull --ff-only, rebuild app services, then start them.
  update-full        Update code, pull image services, then recreate the full stack.
  maintenance-on     Announce maintenance and stop app services, leaving data + livekit running.
  maintenance-on-full
                     Announce maintenance and stop the full stack.
  resume             Start app services again after maintenance.
  resume-full        Start the full stack again after maintenance/full-stop.
  announce           Only send the realtime shutdown notice to web + robot clients.
  status             Show docker compose service status.
EOF
}

cmd="${1:-}"

case "$cmd" in
  start)
    compose_up_scope app
    ;;
  full-start)
    compose_up_scope full
    ;;
  stop)
    compose_stop_scope app
    ;;
  full-stop)
    compose_stop_scope full
    ;;
  restart)
    run_restart app restart "$DEFAULT_RETRY_AFTER_MS" "$DEFAULT_DRAIN_SEC" no-build no
    ;;
  restart-full)
    run_restart full restart "$DEFAULT_RETRY_AFTER_MS" "$DEFAULT_DRAIN_SEC" no-build no
    ;;
  update)
    run_restart app update "$DEFAULT_RETRY_AFTER_MS" "$DEFAULT_DRAIN_SEC" build yes
    ;;
  update-full)
    run_restart full update "$DEFAULT_RETRY_AFTER_MS" "$DEFAULT_DRAIN_SEC" build yes
    ;;
  maintenance-on)
    publish_shutdown_notice maintenance "$MAINTENANCE_RETRY_AFTER_MS" "$(message_for_reason maintenance)"
    wait_for_drain "$MAINTENANCE_DRAIN_SEC"
    info "Stopping app services for maintenance"
    compose_stop_scope app
    ;;
  maintenance-on-full)
    publish_shutdown_notice maintenance "$MAINTENANCE_RETRY_AFTER_MS" "$(message_for_reason maintenance)"
    wait_for_drain "$MAINTENANCE_DRAIN_SEC"
    info "Stopping full stack for maintenance"
    compose_stop_scope full
    ;;
  resume|maintenance-off)
    info "Starting app services"
    compose_up_scope app
    ;;
  resume-full|maintenance-off-full)
    info "Starting full stack"
    compose_up_scope full
    ;;
  announce)
    reason="${2:-restart}"
    retry_after_ms="${3:-$DEFAULT_RETRY_AFTER_MS}"
    publish_shutdown_notice "$reason" "$retry_after_ms" "$(message_for_reason "$reason")"
    ;;
  status)
    docker compose ps
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    die "Unknown command: $cmd"
    ;;
esac
