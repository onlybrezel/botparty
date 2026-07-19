#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
. "${ROOT_DIR}/scripts/load-dotenv.sh"

APP_SERVICES=(api web nginx)
PLATFORM_SERVICES=(livekit cadvisor)
DATA_SERVICES=(postgres redis)
FULL_SERVICES=("${DATA_SERVICES[@]}" "${PLATFORM_SERVICES[@]}" "${APP_SERVICES[@]}")
IMAGE_SERVICES=(postgres redis livekit cadvisor nginx)

ANNOUNCE_CHANNEL="ws:system:shutdown"
DEFAULT_RETRY_AFTER_MS="${WS_SHUTDOWN_RETRY_AFTER_MS:-12000}"
DEFAULT_UPDATE_RETRY_AFTER_MS="${WS_SHUTDOWN_RETRY_AFTER_UPDATE_MS:-25000}"
DEFAULT_DRAIN_SEC="${OPS_DRAIN_SEC:-6}"
MAINTENANCE_RETRY_AFTER_MS="${OPS_MAINTENANCE_RETRY_AFTER_MS:-30000}"
MAINTENANCE_DRAIN_SEC="${OPS_MAINTENANCE_DRAIN_SEC:-8}"
DEFAULT_HEALTHCHECK_TIMEOUT_SEC="${OPS_HEALTHCHECK_TIMEOUT_SEC:-90}"
DEFAULT_POST_API_STABILIZE_SEC="${OPS_POST_API_STABILIZE_SEC:-4}"
DEFAULT_POST_WEB_STABILIZE_SEC="${OPS_POST_WEB_STABILIZE_SEC:-2}"
DEFAULT_ROUTING_SETTLE_SEC="${OPS_ROUTING_SETTLE_SEC:-2}"
DEFAULT_INTER_REPLICA_DRAIN_SEC="${OPS_INTER_REPLICA_DRAIN_SEC:-5}"
DEFAULT_NGINX_HANDOFF_SEC="${OPS_NGINX_HANDOFF_SEC:-11}"
DEFAULT_API_REPLICAS="${OPS_API_REPLICAS:-2}"
DEFAULT_WEB_REPLICAS="${OPS_WEB_REPLICAS:-2}"
DEFAULT_CONTAINER_STOP_TIMEOUT_SEC="${OPS_CONTAINER_STOP_TIMEOUT_SEC:-30}"

info() { printf '  -> %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

load_env() {
  load_dotenv_file .env
}

run_production_preflight() {
  load_env
  if [[ "${PUBLIC_DEPLOYMENT:-true}" == "true" ]]; then
    info "Validating public production release gates"
    ./scripts/production-preflight.sh .env
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
  local redis_password="${REDIS_PASSWORD:-}"
  local redis_password_file="${REDIS_PASSWORD_FILE:-${BOTPARTY_SECRET_DIR:-./docker/secrets}/redis_password}"
  if [[ -z "$redis_password" && -r "$redis_password_file" ]]; then
    redis_password="$(<"$redis_password_file")"
  fi
  if [[ -z "$redis_password" ]]; then
    warn "Redis password is unavailable; skipping realtime shutdown announcement."
    return 0
  fi
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

wait_for_stabilization() {
  local label="$1"
  local seconds="$2"
  if [[ "$seconds" -le 0 ]]; then
    return 0
  fi
  info "Stabilizing after ${label}: waiting ${seconds}s"
  sleep "$seconds"
}

wait_for_service_healthy() {
  local service="$1"
  local timeout_sec="$2"
  local started_at
  local container_id
  local container_ids
  local status

  started_at="$(date +%s)"
  info "Waiting for docker health: ${service} (timeout ${timeout_sec}s)"

  while true; do
    if ! container_ids="$(docker compose ps -q "$service" 2>/dev/null)"; then
      container_ids=""
    fi
    if [[ -z "$container_ids" ]]; then
      if (( "$(date +%s)" - started_at >= timeout_sec )); then
        warn "Timed out waiting for container id: ${service}"
        return 1
      fi
      sleep 1
      continue
    fi

    local all_healthy=true
    while IFS= read -r container_id; do
      [[ -n "$container_id" ]] || continue
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || echo unknown)"
      case "$status" in
        healthy|running)
          ;;
        unhealthy|exited|dead)
          warn "Service '${service}' reported unhealthy state: ${status}"
          return 1
          ;;
        *)
          all_healthy=false
          ;;
      esac
    done <<< "$container_ids"
    if [[ "$all_healthy" == true ]]; then
      return 0
    fi

    if (( "$(date +%s)" - started_at >= timeout_sec )); then
      warn "Timed out waiting for service '${service}' to become healthy (last state: ${status})"
      return 1
    fi

    sleep 2
  done
}

wait_for_container_ids_healthy() {
  local label="$1"
  local timeout_sec="$2"
  shift 2
  local container_ids=("$@")
  local started_at
  local container_id
  local status="unknown"
  started_at="$(date +%s)"

  info "Waiting for new ${label} containers (${#container_ids[@]})"
  while true; do
    local all_healthy=true
    for container_id in "${container_ids[@]}"; do
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || echo missing)"
      case "$status" in
        healthy|running)
          ;;
        unhealthy|exited|dead|missing)
          warn "New ${label} container ${container_id:0:12} reported ${status}"
          return 1
          ;;
        *)
          all_healthy=false
          ;;
      esac
    done
    if [[ "$all_healthy" == true ]]; then
      return 0
    fi
    if (( "$(date +%s)" - started_at >= timeout_sec )); then
      warn "Timed out waiting for new ${label} containers (last state: ${status})"
      return 1
    fi
    sleep 2
  done
}

capture_probe_output() {
  # Admission probes legitimately return non-zero while a new replica or DNS
  # record is not ready. Preserve their diagnostic output and let the bounded
  # caller decide when that condition becomes a rollout failure.
  set +e
  PROBE_OUTPUT="$("$@" 2>&1)"
  set -e
}

read_header_through_nginx() {
  local url="$1"
  local header_name="$2"
  local output
  capture_probe_output docker compose exec -T nginx wget -T 2 -qS -O /dev/null "$url"
  output="$PROBE_OUTPUT"
  awk -v wanted="${header_name}:" '
    tolower($1) == tolower(wanted) { gsub("\r", "", $2); print $2; exit }
  ' <<<"${output}"
}

read_status_through_nginx() {
  local url="$1"
  local output
  capture_probe_output docker compose exec -T nginx wget -T 2 -qS -O /dev/null "$url"
  output="$PROBE_OUTPUT"
  awk '/^  HTTP\// { status=$2 } END { print status }' <<<"${output}"
}

wait_for_legacy_web_admission() {
  local timeout_sec="$1"
  shift
  local container_ids=("$@")
  local expected_ips=()
  local container_id ip status dns_output

  for container_id in "${container_ids[@]}"; do
    for ip in $(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$container_id"); do
      status="$(read_status_through_nginx "http://${ip}:3000/")"
      if [[ "$status" == 200 ]]; then
        expected_ips+=("$ip")
        break
      fi
    done
  done
  if [[ "${#expected_ips[@]}" -ne "${#container_ids[@]}" ]]; then
    warn "Could not reach every legacy Web replica directly from nginx"
    return 1
  fi

  local started_at all_present
  started_at="$(date +%s)"
  info "Using the legacy Web admission check for an image without x-web-instance-id"
  while true; do
    capture_probe_output docker compose exec -T nginx nslookup web 127.0.0.11
    dns_output="$PROBE_OUTPUT"
    all_present=true
    for ip in "${expected_ips[@]}"; do
      if [[ "$dns_output" != *"Address: ${ip}"* ]]; then
        all_present=false
      fi
    done
    status="$(read_status_through_nginx 'http://127.0.0.1/')"
    if [[ "$all_present" == true && "$status" == 200 ]]; then
      return 0
    fi
    if (( "$(date +%s)" - started_at >= timeout_sec )); then
      warn "Timed out waiting for legacy Web replicas in Docker DNS and nginx"
      return 1
    fi
    sleep 0.1
  done
}

wait_for_nginx_admission() {
  local service="$1"
  local port="$2"
  local path="$3"
  local header_name="$4"
  local timeout_sec="$5"
  shift 5
  local container_ids=("$@")
  local expected=()
  local container_id ip marker

  if ! compose_running_service nginx; then
    return 0
  fi

  for container_id in "${container_ids[@]}"; do
    marker=""
    for ip in $(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$container_id"); do
      marker="$(read_header_through_nginx "http://${ip}:${port}${path}" "$header_name")"
      [[ -n "$marker" ]] && break
    done
    if [[ -z "$marker" ]]; then
      if [[ "$service" == web ]]; then
        wait_for_legacy_web_admission "$timeout_sec" "${container_ids[@]}"
        return
      fi
      warn "Could not read ${header_name} directly from new ${service} container ${container_id:0:12}"
      return 1
    fi
    expected+=("$marker")
  done

  local started_at
  declare -A admitted=()
  started_at="$(date +%s)"
  info "Waiting until nginx has admitted every new ${service} replica"
  while true; do
    marker="$(read_header_through_nginx "http://127.0.0.1${path}" "$header_name")"
    for container_id in "${expected[@]}"; do
      if [[ "$marker" == "$container_id" ]]; then
        admitted["$container_id"]=1
      fi
    done
    if [[ "${#admitted[@]}" -eq "${#expected[@]}" ]]; then
      return 0
    fi
    if (( "$(date +%s)" - started_at >= timeout_sec )); then
      warn "Timed out waiting for nginx to route to all new ${service} replicas"
      return 1
    fi
    sleep 0.1
  done
}

write_nginx_upstream() {
  local service="$1"
  local content="$2"
  printf '%s\n' "$content" | docker compose exec -T nginx sh -eu -c '
    target="/tmp/nginx-upstreams/$1.conf"
    temporary="${target}.tmp"
    cat > "$temporary"
    test -s "$temporary"
    mv "$temporary" "$target"
  ' sh "$service"
}

pin_nginx_upstream() {
  local service="$1"
  local port="$2"
  shift 2
  local container_ids=("$@")
  local nginx_id
  local container_id
  local network
  local ip
  local line
  local lines=""
  local shared_ip

  nginx_id="$(docker compose ps -q nginx)"
  [[ -n "$nginx_id" ]] || return 1

  for container_id in "${container_ids[@]}"; do
    shared_ip=""
    for network in $(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$nginx_id"); do
      ip="$(docker inspect --format "{{with index .NetworkSettings.Networks \"${network}\"}}{{.IPAddress}}{{end}}" "$container_id")"
      if [[ -n "$ip" ]]; then
        shared_ip="$ip"
        break
      fi
    done
    if [[ -z "$shared_ip" ]]; then
      warn "Could not determine a network shared by nginx and ${container_id:0:12}"
      return 1
    fi
    printf -v line 'server %s:%s max_fails=1 fail_timeout=5s;' "$shared_ip" "$port"
    lines+="${line}"$'\n'
  done

  write_nginx_upstream "$service" "${lines%$'\n'}"
  docker compose exec -T nginx nginx -t
}

restore_nginx_dynamic_upstream() {
  local service="$1"
  local port="$2"
  write_nginx_upstream "$service" "server ${service}:${port} resolve;"
  docker compose exec -T nginx nginx -t
}

restore_nginx_after_failed_rollout() {
  local service="$1"
  local port="$2"
  if ! restore_nginx_dynamic_upstream "$service" "$port"; then
    warn "Could not restore the dynamic nginx ${service} upstream; keeping all replicas for manual recovery"
    return 1
  fi
  if ! reload_nginx; then
    warn "Could not reload the restored nginx ${service} upstream; keeping all replicas for manual recovery"
    return 1
  fi
}

rolling_replace_service() {
  local service="$1"
  local desired_replicas="$2"
  local timeout_sec="$3"
  local old_ids=()
  local all_ids=()
  local new_ids=()
  local old_count
  local surge_count
  local container_id
  local service_port
  local nginx_pinned=false
  declare -A old_id_set=()

  mapfile -t old_ids < <(docker compose ps -q "$service")
  old_count="${#old_ids[@]}"
  surge_count=$((old_count + desired_replicas))
  for container_id in "${old_ids[@]}"; do
    old_id_set["$container_id"]=1
  done

  case "$service" in
    api) service_port=4000 ;;
    web) service_port=3000 ;;
    *) die "No rollout port is configured for service: ${service}" ;;
  esac

  # Docker DNS publishes newly created Compose replicas before their
  # healthchecks pass. Retire every dynamic-DNS nginx worker before adding the
  # surge so an unready replica can never receive production traffic.
  if compose_running_service nginx && [[ "$old_count" -gt 0 ]]; then
    info "Pinning nginx ${service} traffic to the current healthy replicas before surge"
    if ! pin_nginx_upstream "$service" "$service_port" "${old_ids[@]}" || ! reload_nginx; then
      warn "Could not isolate the current ${service} replicas before surge"
      if ! restore_nginx_after_failed_rollout "$service" "$service_port"; then
        warn "Could not restore dynamic nginx routing after the pre-surge gate failed"
      fi
      return 1
    fi
    nginx_pinned=true
    wait_for_stabilization "nginx pre-surge handoff" "$DEFAULT_NGINX_HANDOFF_SEC"
  fi

  info "Starting ${desired_replicas} new ${service} replica(s) before draining ${old_count} old replica(s)"
  docker compose up -d --no-deps --no-recreate --scale "${service}=${surge_count}" "$service"
  mapfile -t all_ids < <(docker compose ps -q "$service")
  for container_id in "${all_ids[@]}"; do
    if [[ -z "${old_id_set[$container_id]:-}" ]]; then
      new_ids+=("$container_id")
    fi
  done

  if [[ "${#new_ids[@]}" -ne "$desired_replicas" ]]; then
    warn "Expected ${desired_replicas} new ${service} replicas, found ${#new_ids[@]}"
    if [[ "${#new_ids[@]}" -gt 0 ]]; then
      docker rm -f "${new_ids[@]}" >/dev/null
    fi
    if [[ "$nginx_pinned" == true ]]; then
      restore_nginx_after_failed_rollout "$service" "$service_port" ||
        warn "Could not restore dynamic nginx routing after rejecting the incomplete surge"
    fi
    return 1
  fi

  if ! wait_for_container_ids_healthy "$service" "$timeout_sec" "${new_ids[@]}"; then
    warn "Recent logs from the rejected ${service} replicas follow"
    for container_id in "${new_ids[@]}"; do
      docker logs --tail 80 "$container_id" >&2 || warn "Could not read logs from ${container_id:0:12}"
    done
    warn "${service} health gate failed; removing only the new replicas"
    docker rm -f "${new_ids[@]}" >/dev/null
    if [[ "$nginx_pinned" == true ]]; then
      restore_nginx_after_failed_rollout "$service" "$service_port" ||
        warn "Could not restore dynamic nginx routing after the health-gate rejection"
    fi
    return 1
  fi

  if compose_running_service nginx; then
    info "Pinning nginx ${service} traffic to the new healthy replicas"
    if ! pin_nginx_upstream "$service" "$service_port" "${new_ids[@]}"; then
      warn "Could not prepare the nginx drain configuration"
      if [[ "$old_count" -eq 0 ]] || ! pin_nginx_upstream "$service" "$service_port" "${old_ids[@]}" || ! reload_nginx; then
        warn "Could not confirm routing to the previous ${service} replicas; keeping all replicas"
        return 1
      fi
      docker rm -f "${new_ids[@]}" >/dev/null
      restore_nginx_after_failed_rollout "$service" "$service_port" ||
        warn "Could not restore dynamic nginx routing after rejecting the surge"
      return 1
    fi
    if ! reload_nginx; then
      warn "Could not activate the nginx drain configuration"
      if [[ "$old_count" -eq 0 ]] || ! pin_nginx_upstream "$service" "$service_port" "${old_ids[@]}" || ! reload_nginx; then
        warn "Could not confirm routing to the previous ${service} replicas; keeping all replicas"
        return 1
      fi
      docker rm -f "${new_ids[@]}" >/dev/null
      restore_nginx_after_failed_rollout "$service" "$service_port" ||
        warn "Could not restore dynamic nginx routing after rejecting the surge"
      return 1
    fi
    nginx_pinned=true
    wait_for_stabilization "nginx worker handoff" "$DEFAULT_NGINX_HANDOFF_SEC"
  fi

  case "$service" in
    api)
      if ! wait_for_nginx_admission api 4000 /api/v1/health/live x-instance-id "$timeout_sec" "${new_ids[@]}"; then
        warn "Nginx admission gate failed; returning traffic to the previous API replicas"
        if [[ "$old_count" -eq 0 ]] || ! pin_nginx_upstream "$service" "$service_port" "${old_ids[@]}" || ! reload_nginx; then
          warn "Could not confirm routing to the previous API replicas; keeping all replicas"
          return 1
        fi
        wait_for_stabilization "nginx rejected API handoff" "$DEFAULT_NGINX_HANDOFF_SEC"
        docker rm -f "${new_ids[@]}" >/dev/null
        restore_nginx_after_failed_rollout "$service" "$service_port" ||
          warn "Could not restore dynamic nginx API routing after admission rejection"
        return 1
      fi
      ;;
    web)
      if ! wait_for_nginx_admission web 3000 /web-health/live x-web-instance-id "$timeout_sec" "${new_ids[@]}"; then
        warn "Nginx admission gate failed; returning traffic to the previous Web replicas"
        if [[ "$old_count" -eq 0 ]] || ! pin_nginx_upstream "$service" "$service_port" "${old_ids[@]}" || ! reload_nginx; then
          warn "Could not confirm routing to the previous Web replicas; keeping all replicas"
          return 1
        fi
        wait_for_stabilization "nginx rejected Web handoff" "$DEFAULT_NGINX_HANDOFF_SEC"
        docker rm -f "${new_ids[@]}" >/dev/null
        restore_nginx_after_failed_rollout "$service" "$service_port" ||
          warn "Could not restore dynamic nginx Web routing after admission rejection"
        return 1
      fi
      ;;
  esac

  # Requests that selected the previous DNS answer before admission keep their
  # original peer set for that request. Give those requests a short grace
  # window before signalling an old process; longer in-flight work is then
  # protected by Docker's graceful stop timeout.
  wait_for_stabilization "${service} routing" "$DEFAULT_ROUTING_SETTLE_SEC"

  if [[ "${#old_ids[@]}" -gt 0 ]]; then
    info "New ${service} replicas are admitted; gracefully draining old replicas"
    # Drain one replica at a time so the resolver's bounded cache can never
    # contain only stopped peers. Nginx resolves Docker DNS dynamically; a
    # reload here would strand existing keep-alive clients on an old worker.
    local old_index=0
    for container_id in "${old_ids[@]}"; do
      docker stop --timeout "$DEFAULT_CONTAINER_STOP_TIMEOUT_SEC" "$container_id" >/dev/null
      docker rm "$container_id" >/dev/null
      old_index=$((old_index + 1))
      if compose_running_service nginx && [[ "$old_index" -lt "${#old_ids[@]}" ]]; then
        # Preserve another old replica until requests already assigned to the
        # removed peer have observed its close and retried. This also exceeds
        # the configured one-second Docker-DNS resolver TTL.
        wait_for_stabilization "${service} replica drain" "$DEFAULT_INTER_REPLICA_DRAIN_SEC"
      fi
    done
  fi
  wait_for_service_healthy "$service" "$timeout_sec"

  if [[ "$nginx_pinned" == true ]]; then
    info "Restoring dynamic Docker-DNS discovery for ${service}"
    restore_nginx_dynamic_upstream "$service" "$service_port"
    reload_nginx
  fi
}

reload_nginx() {
  if compose_running_service nginx; then
    docker compose exec -T nginx nginx -t
    docker compose exec -T nginx nginx -s reload
  else
    docker compose up -d --no-deps nginx
    wait_for_service_healthy nginx "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC"
  fi
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
  docker compose rm -sf "${services[@]}" >/dev/null 2>&1
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

  if [[ "$reason" == "update" ]]; then
    run_production_preflight
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

  load_env

  if [[ "$pull_git" == "yes" ]]; then
    info "Pulling latest changes"
    git pull --ff-only
  fi

  run_production_preflight

  if [[ "${OPS_BACKUP_BEFORE_UPDATE:-true}" == true ]]; then
    info "Creating the pre-release database and object-storage archive"
    ./scripts/backup-release.sh
  fi

  info "Refreshing update artifacts"
  if [[ "$pull_git" == "yes" ]]; then
    info "Pulling versioned release images"
    docker compose pull api web nginx
  else
    pull_services_best_effort nginx
    docker compose build api web nginx
  fi

  info "Reconciling object-storage buckets and access policies"
  docker compose run --rm --no-deps minio-init

  info "Applying schema migrations once with the release image"
  docker compose run --rm --no-deps migrate

  info "Build/preflight successful; announcing update window"
  publish_shutdown_notice update "$DEFAULT_UPDATE_RETRY_AFTER_MS" "$(message_for_reason update)" app
  wait_for_drain "$DEFAULT_DRAIN_SEC"

  info "Rolling update: api"
  if ! rolling_replace_service api "$DEFAULT_API_REPLICAS" "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC"; then
    die "API update failed health gate; old API replicas remain active. Rollout aborted before web/nginx update."
  fi
  wait_for_stabilization api "$DEFAULT_POST_API_STABILIZE_SEC"

  info "Rolling update: web"
  if ! rolling_replace_service web "$DEFAULT_WEB_REPLICAS" "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC"; then
    die "Web update failed health gate; old web replicas remain active."
  fi
  wait_for_stabilization web "$DEFAULT_POST_WEB_STABILIZE_SEC"

  # Each service drain already validates and reloads nginx, including any
  # release configuration changes. Avoid a redundant second worker rotation.
}

run_zero_downtime_rollback() {
  load_env
  : "${APP_VERSION:?Set APP_VERSION to the previously verified release tag}"

  run_production_preflight

  pull_services_best_effort api web

  publish_shutdown_notice rollback "$DEFAULT_UPDATE_RETRY_AFTER_MS" "$(message_for_reason update)" app
  wait_for_drain "$DEFAULT_DRAIN_SEC"

  info "Rolling back api"
  rolling_replace_service api "$DEFAULT_API_REPLICAS" "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC" ||
    die "API rollback failed health gate; current API replicas remain active."
  wait_for_stabilization api "$DEFAULT_POST_API_STABILIZE_SEC"

  info "Rolling back web"
  rolling_replace_service web "$DEFAULT_WEB_REPLICAS" "$DEFAULT_HEALTHCHECK_TIMEOUT_SEC" ||
    die "Web rollback failed health gate; current web replicas remain active."
  wait_for_stabilization web "$DEFAULT_POST_WEB_STABILIZE_SEC"

  # Each service drain already restored Docker DNS and reloaded nginx.
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
  ./ops.sh update-local
  APP_VERSION=<previous-tag> ./ops.sh rollback
  ./ops.sh update-full
  ./ops.sh maintenance-on
  ./ops.sh maintenance-on-full
  ./ops.sh resume
  ./ops.sh resume-full
  ./ops.sh announce <reason> [retry_after_ms] [scope]
  ./ops.sh status
  ./ops.sh preflight

Commands:
  start              Start app services only: api web nginx.
  full-start         Start the full stack: postgres redis livekit cadvisor api web nginx.
  stop               Stop app services only.
  full-stop          Stop the full stack.
  restart            Announce restart, wait briefly, recreate app services without git pull/build.
  restart-full       Same as restart, but include livekit/cadvisor/postgres/redis.
  update             Health-gated rollout: backup, build, migrate once, then two API/Web replicas and nginx.
  update-zero        Alias for update.
  update-local       Same rollout without a git pull; intended for a locally prepared release checkout.
  rollback           Health-gated API/Web rollback to an existing APP_VERSION image; never reverses schema migrations.
  update-full        Update code, pull image services, then recreate the full stack.
  maintenance-on     Announce maintenance and stop app services, leaving data + livekit running.
  maintenance-on-full
                     Announce maintenance and stop the full stack.
  resume             Start app services again after maintenance.
  resume-full        Start the full stack again after maintenance/full-stop.
  announce           Only send the realtime shutdown notice to web + robot clients.
                     scope can be app or full (default: app).
  status             Show docker compose service status.
  preflight          Validate public URLs, review evidence, secrets, TLS files, and Compose configuration.
EOF
}

cmd="${1:-}"

case "$cmd" in
  start)
    run_production_preflight
    compose_up_scope app
    ;;
  full-start)
    run_production_preflight
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
  update-local)
    run_zero_downtime_update no
    ;;
  rollback)
    run_zero_downtime_rollback
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
    run_production_preflight
    compose_up_scope app
    ;;
  resume-full|maintenance-off-full)
    info "Starting full stack"
    run_production_preflight
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
  preflight)
    run_production_preflight
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    die "Unknown command: $cmd"
    ;;
esac
