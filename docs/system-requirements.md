# System Requirements and Performance Sizing

Last updated: August 9, 2026

## Benchmark reference

| Component        | Reference system                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| CPU              | AMD EPYC 7502P, 1 socket, 32 physical cores, 64 hardware threads, SMT 2                          |
| NUMA             | 1 node                                                                                           |
| RAM              | 134,912,626,688 bytes (125.6 GiB), 4 GiB swap                                                    |
| Operating system | Ubuntu 24.04.4 LTS, Linux 6.8.0-134-generic, x86-64                                              |
| Runtime          | Node.js 24.19.0, pnpm 9.15.4                                                                     |
| Containers       | Docker Engine 29.7.2, Docker Compose 5.4.0, cgroup v2                                            |
| Data services    | PostgreSQL 16 Alpine, Redis 7 Alpine                                                             |
| Commit           | `8761fa523b773ccd6df02b97b2f6679c5187b941`, including the changes recorded in this benchmark run |

Machine-readable hardware data is stored in `data/performance-matrix/host-reference.json`. Every run used separate Docker networks and volumes. The host gate accepted measurements only when host idle time was at least 75% and the one-minute load average was below 16. CPU, memory, throttling, restarts, OOM events, event-loop lag, and garbage collection were sampled once per second from cgroup v2 and Prometheus runtime metrics.

These measurements remain a historical PostgreSQL 16 baseline. The current deployment stack uses PostgreSQL 18, so PostgreSQL 18 capacity decisions require a new isolated matrix run.

## Workload model

The mixed API workload uses this distribution:

- 55% public discovery and statistics reads
- 15% authenticated user reads
- 12% notification pagination and unread-count reads
- 8% wallet reads
- 5% profile writes
- 5% analytics writes

Profiles use between 4 and 320 concurrent clients with small, medium, or large datasets. The large fixture contains 15,027 robots, 150,055 sessions, 300,000 notifications, 600,000 audit records, and 600,000 analytics records. `scripts/performance-load.mjs` also provides login, write-only, file I/O, WebSocket, and public-read scenarios.

## Before-and-after matrix

| Profile                       |  vCPU / threads | API memory |   Before RPS |  After RPS |      After p95 / p99 | Peak memory | Recommended use                          |
| ----------------------------- | --------------: | ---------: | -----------: | ---------: | -------------------: | ----------: | ---------------------------------------- |
| Ultra-Low / Edge              |  0.5 / 1 worker |    384 MiB | Start failed |      99.90 |   101.10 / 197.90 ms |     192 MiB | Private edge instance, small fleet       |
| Minimal / Small VPS           |    1 / 1 worker |      1 GiB |       158.13 |     287.18 |    96.50 / 173.35 ms |     232 MiB | Small VPS or hobby community             |
| Standard / Recommended        |   4 / 4 workers |      4 GiB |       347.40 |     943.56 |    91.90 / 152.30 ms |     465 MiB | Normal production with redundancy        |
| High-Performance / Production |   8 / 8 workers |     16 GiB |       591.54 |   2,485.58 |    94.57 / 166.10 ms |     568 MiB | Sustained high API load                  |
| Enterprise / Heavy Scale      | 16 / 16 workers |     32 GiB |       564.22 |   2,759.87 |    79.15 / 110.89 ms |     587 MiB | Large single host or orchestrator        |
| Hyperscale / Bare Metal       | 32 / 32 workers |     64 GiB |     1,012.09 | 1,988.63\* | 277.59 / 379.11 ms\* |     583 MiB | Bare metal with a separate database tier |

\* The optimized hyperscale run overlapped with unrelated load on the same host by explicit approval (`measurementQuality.accepted=false`). It recorded no errors, restarts, or OOM kills, but it is not directly comparable with the isolated results.

Compared with the baseline, successful throughput increased by 320% in the isolated High-Performance profile and by 389% in the Enterprise profile. Scaling from 8 to 16 API vCPUs produced only another 11%. The current single-host topology therefore does not scale linearly to 32 or 64 threads. From profile 5 onward, throughput is limited by the shared PostgreSQL write path, competing updates to the same user rows, and the 2-vCPU load generator. Further scaling requires an external PostgreSQL cluster, multiple load generators, and writes partitioned by key. More API workers alone are not sufficient.

Peak memory is the `memory.peak` value of the largest API container across warm-up and measurement. It is not the sum of all API replicas. RPS and p95/p99 include successful HTTP responses only.

### Runtime observations after optimization

| Profile          | Average / peak API CPU | Event-loop p99 / max | Observed GC cycles | Throttled CPU periods | API restarts / OOM |
| ---------------- | ---------------------: | -------------------: | -----------------: | --------------------: | -----------------: |
| Ultra-Low        |                3% / 5% |    88.60 / 203.29 ms |                  0 |             163 / 260 |              0 / 0 |
| Minimal          |                1% / 1% |    72.61 / 105.58 ms |                  0 |             153 / 194 |              0 / 0 |
| Standard         |            133% / 389% |    54.53 / 112.85 ms |                 17 |             339 / 771 |              0 / 0 |
| High-Performance |            271% / 775% |    47.32 / 132.12 ms |                0\* |           630 / 1,541 |              0 / 0 |
| Enterprise       |            335% / 946% |    13.13 / 127.66 ms |                 92 |           118 / 2,909 |              0 / 0 |
| Hyperscale\*     |            291% / 796% |    20.35 / 167.64 ms |                 89 |            97 / 6,472 |              0 / 0 |

A Docker CPU value of 100% represents one fully occupied logical processor. In a clustered container, the Prometheus request reaches one worker at a time. Event-loop and garbage-collection values are therefore observations from individual workers, not guaranteed totals across the cluster. Switching workers between samples can produce a negative delta, which is recorded as zero. cgroup CPU, throttling, memory, and OOM state cover the complete container.

## Sizing guide

### Ultra-Low / Edge

- API: 0.5 vCPU, 384 MiB RAM, 1 worker, 192 MiB V8 old space
- PostgreSQL: 0.5 vCPU, 512 MiB; Redis: 0.25 vCPU, 128 MiB
- Pool: 3 connections; at most 8 concurrent API requests
- Suitable for a private edge installation with a small fleet and low concurrency. Provide 2 vCPUs temporarily for builds, migrations, and seeds.

### Minimal / Small VPS

- API: 1 vCPU, 1 GiB RAM, 1 worker, 512 MiB V8 old space
- PostgreSQL: 1 vCPU, 1 GiB; Redis: 192 MiB
- Pool: 6 connections; at most 24 concurrent API requests
- Suitable for small public instances and hobby communities.

### Standard / Recommended

- API: 2 containers with 2 vCPUs and 2 GiB RAM each; 4 workers total
- PostgreSQL: 2 vCPUs, 4 GiB; Redis: 512 MiB
- Pool: 8 connections per worker; at most 48 concurrent requests per container
- Recommended production baseline with redundancy.

### High-Performance / Production

- API: 4 containers with 2 vCPUs and 4 GiB RAM each; 8 workers total
- PostgreSQL: 4 vCPUs, 8 GiB; Redis: 1 vCPU, 512 MiB
- Pool: 10 connections per worker
- Intended for sustained high load and rolling deployments.

### Enterprise / Heavy Scale

- API: 8 containers with 2 vCPUs and 4 GiB RAM each; 16 workers total
- PostgreSQL: 8 vCPUs, 16 GiB; Redis: 2 vCPUs, 1 GiB
- Pool: 12 connections per worker
- Intended for a large single host or an orchestrator with a separate database tier.

### Hyperscale / Bare Metal

- API: 16 containers with 2 vCPUs and 4 GiB RAM each; 32 workers total
- PostgreSQL: 16 vCPUs, 32 GiB; Redis and gateway: 4 vCPUs each
- Measured stack limit: 56 vCPUs and 100 GiB, leaving capacity for load generation, the kernel, file cache, and system reserve
- Pool budget: 384 API connections with `max_connections=420`
- Running 64 API workers requires an external database or a host with more than 64 threads. On the reference host, 32 API workers with local PostgreSQL is the balanced limit.

## Technical configuration

### CPU and processes

- `scripts/api-cluster.mjs` detects cgroup v2 CPU quotas and starts up to 64 Node.js workers. `API_WORKERS` overrides automatic detection.
- One worker runs per assigned vCPU. Docker Compose replicas place workers in separate cgroups, and Nginx distributes requests through its DNS upstream.
- `UV_THREADPOOL_SIZE` ranges from 2 to 8 by profile. The workload is dominated by network and database I/O, so creating more threads by default does not improve it.
- Without an explicit `NODE_OPTIONS`, the cluster calculates a heap limit from cgroup memory. It divides 65% of the container limit between workers and clamps each worker to 128–2,048 MiB.

### Database

- Prisma pools range from 3 to 12 connections per worker by profile. `workers × connection_limit` stays below PostgreSQL `max_connections` with capacity reserved for migrations and administration.
- Composite indexes cover discovery sorting by creation time, session count, featured state, and viewer count.
- Notification pagination uses a deterministic index on `(userId, createdAt DESC, id DESC)`. The list and unread-count queries run in parallel.
- Public API projections fetch only the fields returned by the endpoint.

### Cache and memory

- Public robot lists use a five-second cache per worker, single-flight protection against cache stampedes, and a fixed maximum of 64 entries.
- Writes invalidate the local discovery cache immediately. Other replicas converge within five seconds.
- Large file endpoints keep streaming or bounded payloads, and every profile has a fixed V8 heap limit.
- The Ultra-Low profile uses longer Redis connection timeouts so severe CPU throttling does not cause a startup loop.

### HTTP and operating-system limits

- Nginx uses automatic worker processes, 8,192 connections per worker, upstream keep-alive, and disabled access logging during benchmarks.
- Fastify listens with a backlog of 2,048. Keep-alive is 65 seconds, `headersTimeout` is 66 seconds, and `requestTimeout` is 30 seconds.
- The API file-descriptor limit is 65,536.
- `MAX_CONCURRENT_REQUESTS` and `MAX_CONCURRENT_LOGIN_REQUESTS` shed load before it reaches the heap, password hashing, or database pool.

## Reproducing the matrix

```bash
# Baseline or optimized run; optionally restrict profiles with a comma-separated list
PERFORMANCE_MATRIX_PHASE=optimized \
PERFORMANCE_MATRIX_PROFILES=ultra-low,minimal,standard,high-performance,enterprise,hyperscale \
./scripts/run-performance-matrix.sh

# Verification
pnpm test
pnpm typecheck
```

Raw results are written to `data/performance-matrix/<phase>/<profile>/`. Runs are comparable only when `measurementQuality.accepted=true` and there are no API restarts or OOM kills.

## Measurement limits

- The reference host has 32 physical cores and 64 SMT threads. SMT does not provide the performance of 64 physical cores.
- The API, PostgreSQL, Redis, gateway, and load generator share one host. The matrix measures the complete single-host system, not an isolated HTTP process.
- Linear scaling ends when the database, shared write rows, or load generator becomes the bottleneck. These figures are capacity measurements, not guarantees for other datasets or access patterns.
