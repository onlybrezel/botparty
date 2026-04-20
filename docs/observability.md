# Observability

BotParty now exposes a single Prometheus-friendly path that combines API runtime gauges, websocket state, queue depth, and aggregated robot telemetry.

When tracing is enabled, the API also emits Prisma database query spans through the same OpenTelemetry pipeline.

## Metrics Endpoints

- API: `/health/metrics`
- Streamer: `/metrics`

The API endpoint includes these robot telemetry aggregates sourced from Redis keys written by robot clients:

- `botparty_robot_telemetry_fresh_robots`
- `botparty_robot_telemetry_control_connected_robots`
- `botparty_robot_telemetry_livekit_connected_robots`
- `botparty_robot_telemetry_avg_cpu_percent`
- `botparty_robot_telemetry_avg_memory_percent`
- `botparty_robot_telemetry_avg_temperature_c`

It also exports dependency reachability gauges for dashboard and alert wiring:

- `botparty_dependency_database_up`
- `botparty_dependency_redis_up`

## Prometheus Scrape Example

```yaml
scrape_configs:
  - job_name: botparty-api
    metrics_path: /health/metrics
    static_configs:
      - targets:
          - api:3001

  - job_name: botparty-streamer
    metrics_path: /metrics
    static_configs:
      - targets:
          - streamer-host:8090
```

If you run multiple streamer instances, add them to the same `botparty-streamer` job or split them per environment.

## Grafana Import

Import [grafana/botparty-observability-overview.json](grafana/botparty-observability-overview.json) into Grafana and select a Prometheus datasource.

The dashboard uses two text variables:

- `api_job` defaults to `botparty-api`
- `streamer_job` defaults to `botparty-streamer`

Update them after import if your Prometheus job labels differ.

## Prisma Query Tracing

Set `OTEL_ENABLED=true` and point `OTEL_EXPORTER_OTLP_ENDPOINT` at your collector. The API tracing bootstrap now includes `@prisma/instrumentation`, so Prisma queries show up as spans without extra application code.

## What The Dashboard Covers

- API target health and dependency reachability
- WebSocket load, queue depth, and active turns
- Fleet-level robot telemetry freshness and resource usage
- Streamer publish rate, reconnects, queue depth, and keyframe lag