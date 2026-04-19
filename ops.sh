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
DEFAULT_API_HEALTHCHECK_URL="${OPS_API_HEALTHCHECK_URL:-}"
DEFAULT_HEALTHCHECK_TIMEOUT_SEC="${OPS_HEALTHCHECK_TIMEOUT_SEC:-90}"

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
  local scope="${4:-app}"

  if ! compose_running_service redis; then
    warn "Redis is not running; skipping realtime shutdown announcement."
    return 0
  fi

  load_env
  local redis_password="${REDIS_PASSWORD:-botparty_redis_secret}"
  local payload
  payload=$(
    printf '{"event":"server:shutdown","data":{"message":"%s","reason":"%s","scope":"%s","retryAfterMs":%s,"ts":%s}}' \
      "$message" \
      "$reason" \
      "$scope" \
      "$retry_after_ms" \
      "$(date +%s)000"
  )

  info "Announcing ${reason} to connected clients"
  docker compose exec -T -e REDISCLI_AUTH="$redis_password" redis \
    redis-cli PUBLISH "$ANNOUNCE_CHANNEL" "$payload" >/dev/null
}

wait_for_drain() {
  local seconds="$1"
  if [[ "$seconds" -le 0 ]]; then
    return 0
  fi
  info "Waiting ${seconds}s for clients to drain"
  sleep "$seconds"
}

wait_for_http() {
  local url="$1"
  local timeout_sec="$2"
  local started_at
  started_at="$(date +%s)"

  info "Waiting for health check: ${url} (timeout ${timeout_sec}s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    if (( "$(date +%s)" - started_at >= timeout_sec )); then
      warn "Health check timed out: ${url}"
      return 1
    fi

    sleep 2
  done
}

wait_for_service_healthy() {
  local service="$1"
  local timeout_sec="$2"
  local started_at
  local container_id
  local status

  started_at="$(date +%s)"
  info "Waiting for docker health: ${service} (timeout ${timeout_sec}s)"

  while true; do
    container_id="$(docker compose ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$container_id" ]]; then
      if (( "$(date +%s)" - started_at >= timeout_sec )); then
        warn "Timed out waiting for container id: ${service}"
        return 1
      fi
      sleep 1
      continue
    fi

    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || echo unknown)"
    case "$status" in
      healthy|running)
        return 0
        ;;
      unhealthy|exited|dead)
        warn "Service '${service}' reported unhealthy state: ${status}"
        return 1
        ;;
    esac

    if (( "$(date +%s)" - started_at >= timeout_sec )); then
      warn "Timed out waiting for service '${service}' to become healthy (last state: ${status})"
      return 1
    fi

    sleep 2
  done
}

wait_for_api_ready() {
  local timeout_sec="$1"
  if [[ -n "$DEFAULT_API_HEALTHCHECK_URL" ]]; then
    wait_for_http "$DEFAULT_API_HEALTHCHECK_URL" "$timeout_sec"
  else
    wait_for_service_healthy api "$timeout_sec"
  fi
}

get_running_service_image_id() {
  local service="$1"
  local container_id
  container_id="$(docker compose ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    return 0
  fi

  docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true
}

get_compose_service_image_name() {
  local service="$1"
  docker compose config --images "$service" 2>/dev/null | head -n1 || true
}

rollback_api_update() {
  local previous_image_id="$1"
  local compose_image_name="$2"
  local timeout_sec="$3"

  if [[ -z "$previous_image_id" || -z "$compose_image_name" ]]; then
    warn "Rollback snapshot is incomplete (image id or compose image name missing)"
    return 1
  fi

  if ! docker image inspect "$previous_image_id" >/dev/null 2>&1; then
    warn "Rollback image no longer exists locally: ${previous_image_id}"
    return 1
  fi

  warn "API health gate failed; rolling back to previous image"
  docker image tag "$previous_image_id" "$compose_image_name"
  docker compose up -d --no-deps api

  if ! wait_for_service_healthy api "$timeout_sec"; then
    warn "Rollback API container failed health gate"
    return 1
  fi

  info "Rollback completed: api restored to previous image"
  return 0
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
    pull_services_best_effort "${pulled[@]}"
  fi
}

pull_services_best_effort() {
  local services=("$@")
  local service

  if [[ "${#services[@]}" -eq 0 ]]; then
    return 0
  fi

  info "Pulling images (best effort): ${services[*]}"
  for service in "${services[@]}"; do
    if ! docker compose pull "$service"; then
      warn "Image pull failed for service '${service}'; continuing with local image/build"
    fi
  done
}

run_restart() {
  local scope="$1"
  local reason="$2"
  local retry_after_ms="$3"
  local drain_sec="$4"
  local build_mode="$5"
  local pull_git="$6"

  publish_shutdown_notice "$reason" "$retry_after_ms" "$(message_for_reason "$reason")" "$scope"
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

run_zero_downtime_update() {
  local pull_git="$1"
  local previous_api_image_id
  local compose_api_image_name

  if [[ "$pull_git" == "yes" ]]; then
    info "Pulling latest changes"
    git pull --ff-only
  fi

  info "Refreshing update artifacts (pull + build)"
  pull_services_best_effort api web nginx
  docker compose build api web nginx

  info "Build/preflight successful; announcing update window"
  publish_shutdown_notice update "$DEFAULT_RETRY_AFTER_MS" "$(message_for_reason update)" app
  wait_for_drain "$DEFAULT_DRAIN_SEC"

  previous_api_image_id="$(get_running_service_image_id api)"
  compose_api_image_name="$(get_compose_service_image_name api)"
  if [[ -n "$previous_api_image_id" && -n "$compose_api_image_name" ]]; then
    info "Captured API rollback snapshot"
  else
    warn "Could not fully capture API rollback snapshot; rollback may be unavailable"
  fi

  info "Rolling update: api"
  docker compose up -d --no-deps api
  if ! wait_for_api_ready "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC"; then
    if rollback_api_update "$previous_api_image_id" "$compose_api_image_name" "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC"; then
      die "API update failed health gate; rollback succeeded. Rollout aborted before web/nginx update."
    fi
    die "API update failed health gate and rollback failed. Manual intervention required."
  fi

  info "Rolling update: web"
  docker compose up -d --no-deps web

  info "Rolling update: nginx"
  docker compose up -d --no-deps nginx
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
  ./ops.sh update-zero
  ./ops.sh update-full
  ./ops.sh maintenance-on
  ./ops.sh maintenance-on-full
  ./ops.sh resume
  ./ops.sh resume-full
  ./ops.sh announce <reason> [retry_after_ms] [scope]
  ./ops.sh status

Commands:
  start              Start app services only: api web nginx.
  full-start         Start the full stack: postgres redis livekit cadvisor api web nginx.
  stop               Stop app services only.
  full-stop          Stop the full stack.
  restart            Announce restart, wait briefly, recreate app services without git pull/build.
  restart-full       Same as restart, but include livekit/cadvisor/postgres/redis.
  update             Near zero-downtime app rollout: pull/build, then api -> web -> nginx with API health gate.
  update-zero        Alias for update.
  update-full        Update code, pull image services, then recreate the full stack.
  maintenance-on     Announce maintenance and stop app services, leaving data + livekit running.
  maintenance-on-full
                     Announce maintenance and stop the full stack.
  resume             Start app services again after maintenance.
  resume-full        Start the full stack again after maintenance/full-stop.
  announce           Only send the realtime shutdown notice to web + robot clients.
                     scope can be app or full (default: app).
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
  update|update-zero)
    run_zero_downtime_update yes
    ;;
  update-full)
    run_restart full update "$DEFAULT_RETRY_AFTER_MS" "$DEFAULT_DRAIN_SEC" build yes
    ;;
  maintenance-on)
    publish_shutdown_notice maintenance "$MAINTENANCE_RETRY_AFTER_MS" "$(message_for_reason maintenance)" app
    wait_for_drain "$MAINTENANCE_DRAIN_SEC"
    info "Stopping app services for maintenance"
    compose_stop_scope app
    ;;
  maintenance-on-full)
    publish_shutdown_notice maintenance "$MAINTENANCE_RETRY_AFTER_MS" "$(message_for_reason maintenance)" full
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
    scope="${4:-app}"
    publish_shutdown_notice "$reason" "$retry_after_ms" "$(message_for_reason "$reason")" "$scope"
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
