# Performance Test Plan

Last updated: July 18, 2026

## Purpose and safety boundaries

This plan measures the capacity of the complete Docker request path and verifies controlled overload behavior. All data is synthetic and every target is inside a private Docker network. Mail is sent only to Mailpit, files are stored only in the local SeaweedFS test service, and the load tool rejects public targets.

Stop a run on data corruption, uncontrolled `500` responses, an OOM kill, repeated container restarts, sustained timeouts, or failure to recover after load ends. Only `2xx` and `3xx` responses count as successful. The report records `429` and `503` responses separately as controlled overload.

## Test system

Recorded host:

- Intel Core i9-9900K, 8 cores and 16 threads, 62 GiB RAM
- Linux 6.8.0-136-generic, Docker Engine 29.6.2, cgroup v2
- Local Docker bridge network without injected latency

Reproducible profile from `docker-compose.yml` and `docker-compose.performance.yml`:

| Service        | Image or runtime                       | Limit               |
| -------------- | -------------------------------------- | ------------------- |
| Nginx          | Reverse proxy and load balancer        | 0.5 CPU, 256 MiB    |
| API            | Node.js 24.18.0, NestJS and Fastify    | 1 CPU, 768 MiB each |
| PostgreSQL     | PostgreSQL 16.14, `max_connections=80` | 2 CPU, 2 GiB        |
| Redis          | Rate limits, queues, and Pub/Sub       | 0.5 CPU, 256 MiB    |
| Web            | Next.js                                | 1 CPU, 768 MiB      |
| Load generator | Node.js 24 Alpine                      | 2 CPU, 1 GiB        |
| Mailpit        | Local SMTP sink                        | 0.25 CPU, 128 MiB   |

PostgreSQL uses `shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=4GB`, `pg_stat_statements`, and `track_io_timing`. Each API instance has a Prisma pool capped at 10 connections, a 3-second pool timeout, and a 5-second connection timeout. Two API instances therefore reserve at most 20 of the 80 database connections.

## Request path

`Load generator → Nginx → Fastify admission control → CSRF/Auth → role check → service → Prisma pool → PostgreSQL`

Authentication limits and queues also use Redis. Uploads pass through the API into shared SeaweedFS storage. The liveness endpoint remains available without PostgreSQL or Redis; readiness checks all required dependencies.

## Reproducible datasets

`scripts/seed-performance.mjs` creates deterministic UUIDs and writes data in batches. The seed requires `PERFORMANCE_FIXTURE_ALLOW_WRITES=true` and refuses any database not named `botparty_performance`.

| Profile | Users | Robots | Sessions | Notifications |   Audit | Analytics |    Chat | Queue |
| ------- | ----: | -----: | -------: | ------------: | ------: | --------: | ------: | ----: |
| Small   |   100 |    500 |    5,000 |        10,000 |  20,000 |    20,000 |  10,000 |   100 |
| Medium  | 1,000 |  5,000 |   50,000 |       100,000 | 200,000 |   200,000 | 100,000 | 1,000 |
| Large   | 2,500 | 15,000 |  150,000 |       300,000 | 600,000 |   600,000 | 300,000 | 1,000 |

The existing administrator and two baseline robots are added to each dataset. Long descriptions, tags, varied states, history, and 1,000 queue positions cover sorting, filters, relations, and boundary data. Fixture timestamps are relative to the run so retention jobs do not remove the test history early.

## Workload profiles

`scripts/performance-load.mjs` provides these closed-loop workloads:

- `stats`: public aggregate statistics.
- `public-read`: evenly distributed lists by popularity and age, search, featured robots, overview, and statistics.
- `mixed`: 55% public reads, 15% `/users/me`, 12% notifications, 8% wallet reads, 5% profile writes, and 5% analytics writes.
- `write`: repeated authenticated profile changes designed to tolerate idempotent retries.
- `login`: the complete CSRF and Argon2 login flow.
- `file`: 20% real JPEG uploads and 80% downloads through shared storage.
- `websocket`: connection setup, room join, and clean disconnect.

The tests use real authentication. Simulated client IP addresses from `198.18.0.0/15` separate per-user limits. Nginx tests from one source IP intentionally measure the proxy limit as well.

## Test stages

| Test              | Duration and load                               | Purpose                                    |
| ----------------- | ----------------------------------------------- | ------------------------------------------ |
| Performance smoke | 20 seconds, 10 clients, small dataset           | Broad CI regression check                  |
| Baseline          | 20–30 seconds, 20 clients                       | Reproducible before-and-after comparison   |
| Load steps        | 20–30 seconds, 20/30/50 clients                 | Locate the p95 and throughput knee         |
| Stress or spike   | 20 seconds, immediate 100 clients               | Admission control and controlled rejection |
| Soak              | 300 seconds, 20 clients                         | Heap, handles, GC, and latency trend       |
| Recovery          | 20 seconds, 20 clients immediately after stress | Automatic return to normal                 |
| Two APIs          | Two parallel generators with 30 clients each    | Horizontal scaling and database limit      |
| Chaos             | Load during an API, database, or Redis outage   | Error format, data integrity, and recovery |

The small CI smoke test requires p95 at or below 1,000 ms, a zero error rate, and at least 20 successful requests per second. Capacity figures come from recorded benchmark runs, not from this deliberately loose gate.

## Measurements

- Throughput, status codes, error rate, p50/p90/p95/p99/maximum, and response bytes
- API instance distribution, CPU, RSS and heap, event-loop lag, container restarts, and OOM events
- PostgreSQL CPU, connections, `pg_stat_statements`, query plans, and index use
- Redis CPU and memory, queue depth, and oldest job age
- Data integrity: counts, orphaned foreign keys, duplicate queue positions, and active sessions

## Commands

The full procedure is in [`performance-runbook.md`](performance-runbook.md). Run the automated smoke test with:

```bash
sg docker -c './scripts/run-performance-smoke.sh'
```
