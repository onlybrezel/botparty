# Performance Runbook

Last updated: July 18, 2026

## Prerequisites

- Linux with Docker Engine and the Compose plugin
- A shell opened at the repository root
- No production URLs or secrets
- Docker access through the local group, for example: `sg docker -c '<command>'`

The test scripts accept only localhost, the Docker service names `api` and `nginx`, or private IP addresses. Performance seeds refuse any database not named `botparty_performance`.

## Quick reproducible check

```bash
sg docker -c './scripts/run-performance-smoke.sh'
```

This command creates a unique Compose project, temporary test secrets, fresh volumes, and the small dataset. It builds the API, runs migrations and the seed, applies mixed load for 20 seconds, and removes the environment through a trap. Results are written to `data/performance-smoke/result.json`.

Useful, deliberately loose CI parameters:

```bash
PERFORMANCE_SMOKE_DURATION_SECONDS=60 \
PERFORMANCE_SMOKE_CONCURRENCY=20 \
PERFORMANCE_SMOKE_MAX_P95_MS=1000 \
PERFORMANCE_SMOKE_MIN_RPS=20 \
sg docker -c './scripts/run-performance-smoke.sh'
```

## Full environment

Create `.env` and file-based secrets as described in [`development.md`](development.md), then run:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml --profile performance config --quiet'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml up --build -d postgres redis seaweedfs object-storage-init livekit-config livekit livekit-ingress mail-test'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml run --rm migrate'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml up -d --scale api=2 api web nginx'
```

Seed from an API container:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml exec -T -e PERFORMANCE_FIXTURE_ALLOW_WRITES=true -e PERFORMANCE_DATASET=medium api sh -c ". /load-file-secrets.sh; node /performance/seed-performance.mjs"'
```

`PERFORMANCE_DATASET` accepts `small`, `medium`, or `large`. The seed is repeatable but replaces queue entries for the synthetic primary robot. Use it only in the isolated performance project.

## Running load

Example mixed workload:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml --profile performance run --rm \
  -e PERFORMANCE_SCENARIO=mixed \
  -e PERFORMANCE_DURATION_SECONDS=30 \
  -e PERFORMANCE_CONCURRENCY=20 \
  load-generator'
```

Other scenarios are `stats`, `public-read`, `write`, `login`, `file`, and `websocket`. Keep the dataset, target, duration, concurrency, resource limits, and warm-up state unchanged when comparing results.

Optional regression gates:

```text
PERFORMANCE_MAX_SUCCESSFUL_P95_MS=500
PERFORMANCE_MAX_ERROR_RATE=0
PERFORMANCE_MIN_SUCCESS_RPS=100
```

## Monitoring metrics

```bash
sg docker -c 'docker stats --no-stream'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml ps'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml logs --since=5m api nginx postgres redis'
```

PostgreSQL:

```sql
SELECT calls, mean_exec_time, total_exec_time, rows, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state;
```

Run `EXPLAIN (ANALYZE, BUFFERS)` with synthetic parameters for a specific slow query. Keep an index only when both the unchanged load test and the query plan show a benefit.

## Diagnosing overload

1. Separate status codes: `429` is a proxy or rate limit, `503` is admission control or a dependency, and `500` is an error.
2. Check API CPU, event-loop p99, heap, and active requests.
3. Check database CPU, active connections, pool wait errors, top queries, and lock waits.
4. Check Redis availability, queue depth, and oldest job age.
5. Review instance distribution in the load report. Strongly skewed responses indicate a load-balancer or readiness problem.
6. After load ends, measure active requests, queue age, heap, and p95 again. A restart does not count as recovery.

## Scaling

Scale the API when it saturates before PostgreSQL and Redis:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml up -d --scale api=2 --no-deps api'
```

Before adding more than two API instances, verify the pool budget: `API count × connection_limit + workers/schedulers/migrations/reserve < max_connections`. The tested profile uses 2 × 10 connections with a database maximum of 80.

Increase worker concurrency only when queue age grows and the database, storage, and external services have spare capacity. Configure a read replica only for explicitly stale-tolerant reads; it is not a failover mechanism.

## Controlled chaos tests

Run these commands only in a clearly named performance project:

```bash
sg docker -c 'docker compose -p <project> -f docker-compose.yml -f docker-compose.performance.yml stop api'
sg docker -c 'docker compose -p <project> -f docker-compose.yml -f docker-compose.performance.yml start api'
```

Use the same bounded stop/start procedure for PostgreSQL or Redis only during a limited load test. Check the container and volume names first. Expected results are temporary `503` responses, no `500` responses, no duplicate writes, and automatic readiness recovery.

## Integrity checks after stress tests

- Compare table counts before and after the run with the number of successful writes.
- Check for orphaned foreign keys in sessions, notifications, analytics, chat, and queue data.
- Check for duplicate `(robotId, position)` pairs and multiple active sessions per robot.
- Repeat an upload and download smoke test for the object written during the run.
- Check container restarts and OOM counters.

## Safe recovery and cleanup

Stop the load generator, wait for queue age to return to normal, and confirm readiness for every instance before scaling. Do not delete jobs from a stuck queue; identify the cause and confirm idempotency first.

```bash
sg docker -c 'docker compose -p <project> -f docker-compose.yml -f docker-compose.performance.yml --profile performance down -v --remove-orphans'
```

`-v` deletes all test data. Use this command only with the isolated performance project name.
