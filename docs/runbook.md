# BotParty Production Runbook

Quick reference for common production incident scenarios.

---

## DB Corruption / Postgres Down

**Symptoms:** API health endpoint returns `{ "postgres": "error" }`, 500s on all data endpoints.

**Steps:**
1. Check container status: `docker compose ps postgres`
2. Check logs: `docker compose logs --tail=50 postgres`
3. Attempt restart: `docker compose restart postgres`
4. If startup fails, check volume integrity:
   ```bash
   docker compose down postgres
   docker run --rm -v botparty_postgres_data:/var/lib/postgresql/data postgres:16-alpine pg_resetwal -n /var/lib/postgresql/data
   ```
5. Restore from latest backup:
   ```bash
   # List backups
   ls -lt data/backups/
   # Restore
   PGPASSWORD=<DB_PASSWORD> psql -h 127.0.0.1 -p 5433 -U botparty botparty < <(zcat data/backups/botparty-<TIMESTAMP>.sql.gz)
   ```
6. If corruption is severe, create new volume and restore from backup.

---

## LiveKit Server Down

**Symptoms:** Video streams are blank, robots fail to publish. Health endpoint shows `{ "livekit": "error" }`.

**Steps:**
1. Check container: `docker compose ps livekit && docker compose logs --tail=30 livekit`
2. Restart: `docker compose restart livekit`
3. If the livekit binary crashes: check `/data/livekit-recordings/` for disk space issues (`df -h`)
4. Robot clients will auto-reconnect on LiveKit restart (5 attempts per session).
5. Force a room reset: use the admin panel → room management → end all active sessions.

---

## Redis OOM / Redis Down

**Symptoms:** Queue operations hang, presence doesn't update, health endpoint shows `{ "redis": "error" }`.

**Steps:**
1. Check memory: `docker compose exec redis redis-cli info memory | grep used_memory_human`
2. Check max memory config in [docker/redis/redis.conf](docker/redis/redis.conf)
3. If OOM: clear volatile keys with SCAN + UNLINK because `FLUSHDB`, `FLUSHALL`, and `KEYS` are disabled in production:
   ```bash
   docker compose exec redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan | xargs -r -n 200 redis-cli -a "$REDIS_PASSWORD" --no-auth-warning unlink'
   ```
4. Restart: `docker compose restart redis`
5. Note: Redis is ephemeral — queues and presence will reset. Active robot sessions need to rejoin.

---

## API Container Crash Loop

**Symptoms:** `docker compose ps api` shows restart loop, web returns 502.

**Steps:**
1. Check logs: `docker compose logs --tail=50 api`
2. Look for startup errors (JWT secret, DB connection, Redis connection).
3. Verify env vars: `docker compose exec api env | grep -E 'JWT|DATABASE|REDIS'`
4. Quick restart: `docker compose restart api`
5. Rebuild if code was updated: `APP_VERSION=$(date +%Y%m%d) docker compose up -d --build api`

---

## Public Launch Configuration

Before exposing a BotParty instance publicly, confirm these envs are explicitly set:

1. `REQUIRE_EMAIL_VERIFICATION=true` unless you intentionally want open signups without email confirmation.
2. `METRICS_AUTH_REQUIRED=true` together with strong `METRICS_USERNAME` / `METRICS_PASSWORD`.
3. `MAX_ROBOTS_PER_OWNER`, `MAX_WEBHOOKS_PER_ROBOT`, `MAX_EXTERNAL_CAMERAS_PER_ROBOT`, and `MAX_ACTIVE_QUEUE_ENTRIES_PER_USER` sized for your infrastructure.
4. `NEXT_PUBLIC_LEGAL_OPERATOR_NAME`, `NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL`, and `NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS` so `/imprint`, `/terms`, and `/privacy` render real operator details.
5. `WEBHOOK_SECRET_ENCRYPTION_KEY` set to a unique high-entropy secret before enabling outbound webhooks.
6. `RECORDING_RETENTION_DAYS` set to a retention window that matches your privacy policy and moderation workflow.

---

## Disk Full

**Symptoms:** Logs stop, uploads fail, DB writes fail.

**Steps:**
1. Check disk: `df -h /`
2. Check recordings volume: `du -sh data/livekit-recordings/`
3. After migrating any legacy recordings into object storage, you can remove old local leftovers: `find data/livekit-recordings/ -mtime +7 -delete`
4. Remove old backups: `find data/backups/ -mtime +30 -delete`
5. Prune Docker: `docker system prune -f`

---

## Backup Strategy

Production backups are required for PostgreSQL and recommended for Redis snapshots.

1. PostgreSQL logical backup every 6 hours using [scripts/backup-db.sh](scripts/backup-db.sh)
2. Store backups under `data/backups/` with timestamped filenames
3. Keep at least 30 days of backups
4. Verify backup restore weekly on a staging database
5. Keep one off-host copy (object storage or remote volume)
6. Mirror the MinIO buckets (`botparty-recordings`, `botparty-thumbnails`) to separate storage or enable bucket replication, otherwise DB-only restores will not recover media assets
7. Keep MinIO lifecycle retention (`RECORDING_RETENTION_DAYS`) aligned with the backup retention you promise to users

Example cron entry:

```bash
0 */6 * * * cd /srv/botparty && ./scripts/backup-db.sh >> /var/log/botparty-backup.log 2>&1
```

---

## OpenAPI Export

The API serves Swagger/OpenAPI at `/api/docs` when `SWAGGER_DOCS=true` and the optional basic-auth credentials are configured.

For release packaging or local regeneration, export the checked-in spec directly from the built API bundle:

```bash
pnpm openapi:export
```

CI also uploads `docs/openapi.json` as an artifact and fails if the committed spec drifts from generated output.

---

## Centralized Logs (optional Loki profile)

BotParty ships an optional compose profile for centralized Docker log collection with Loki + Promtail.

Start it with:

```bash
docker compose --profile observability-logs up -d loki promtail
```

What it does:

1. `promtail` tails Docker container JSON logs from `/var/lib/docker/containers`.
2. `loki` stores the aggregated stream on the internal compose network.
3. You can point Grafana or another Loki-compatible viewer at `http://loki:3100`.

Operational notes:

1. This profile expects a Docker host with readable `/var/lib/docker/containers` and `/var/run/docker.sock`.
2. Keep it disabled on hosts where these mounts are not permitted.
3. Application logs remain structured Pino output, so no code changes are required to enable collection.

---

## Near Zero-Downtime Deployment

Use sequential service rollout to avoid full platform interruption.

1. Use the integrated rolling update command:
   ```bash
   APP_VERSION=<new-tag> ./ops.sh update-zero
   ```
2. What it does automatically:
   - Runs `git pull --ff-only`
   - Runs `docker compose pull api web nginx` and `docker compose build api web nginx`
   - Announces update over websocket with a longer update retry window (`WS_SHUTDOWN_RETRY_AFTER_UPDATE_MS`, default 25s) and waits for drain
   - Rolls services in order: api -> web -> nginx
   - Waits for API health gate via Docker container health before continuing
   - Waits short stabilization windows after API and Web rollout (`OPS_POST_API_STABILIZE_SEC`, `OPS_POST_WEB_STABILIZE_SEC`)
   - If API health fails, automatically rolls back API to the previously running image and aborts before web/nginx update

Optional override:

```bash
OPS_API_HEALTHCHECK_URL=http://127.0.0.1:4000/api/v1/health/live APP_VERSION=<new-tag> ./ops.sh update-zero
```

Use this only when the API port is actually published to the host.
3. Manual fallback (if scripted rollout cannot be used):
   ```bash
   APP_VERSION=<new-tag> docker compose pull api web nginx
   APP_VERSION=<new-tag> docker compose build api web nginx
   APP_VERSION=<new-tag> docker compose up -d --no-deps api
   curl -fsS http://127.0.0.1:4000/api/v1/health/live
   APP_VERSION=<new-tag> docker compose up -d --no-deps web
   APP_VERSION=<new-tag> docker compose up -d --no-deps nginx
   ```
4. Keep old images until rollback window closes.

For schema changes, run `pnpm db:migrate:prod` before replacing API containers.

---

## Horizontal Scaling Model

BotParty can run multiple API instances behind a load balancer, but websocket control rooms are not fully stateless yet.

**Guaranteed across instances today:**
1. Robot claim exclusivity is coordinated through Redis lock keys.
2. Room broadcasts, queue snapshots, presence fan-out, and shutdown notices replicate through Redis pub/sub.
3. A reconnecting robot can land on a different instance without duplicating the control channel.

**Current limitations:**
1. Active turn timers remain in the gateway process memory (`activeTurns` / `turnTimeouts`).
2. Per-user control cooldowns remain instance-local (`controlCooldowns`).
3. A single robot room spread across multiple API instances can see edge-case drift during turn handoff or cooldown enforcement.

**Operational guidance:**
1. Prefer sticky websocket routing for `/ws` by room shard, cookie, or at minimum client IP.
2. Keep a robot socket and the majority of viewers for that robot on the same API instance when possible.
3. Drain websocket traffic before rotating replicas; do not use pure round-robin websocket routing for hot rooms until turn state is externalized.

---

## Prisma Pool Tuning

The production defaults now include `connection_limit=10` and `pool_timeout=30` in generated and compose-provided `DATABASE_URL` values.

**Tuning rule of thumb:**
1. Size `connection_limit` per API replica, not for the whole cluster.
2. Keep `replica_count * connection_limit` below PostgreSQL `max_connections` with room left for admin tooling and migrations.
3. If you inject `DATABASE_URL` through secrets, preserve the same query parameters explicitly.

Example:

```bash
DATABASE_URL=postgresql://botparty:***@postgres:5432/botparty?schema=public&connection_limit=10&pool_timeout=30&sslmode=disable
```

---

## Rollback Procedure

BotParty uses image tags via `APP_VERSION`. To roll back:

```bash
# Re-deploy previous version (replace YYYYMMDD with previous date)
APP_VERSION=20240101 docker compose up -d api web
```

If a build is broken, the previous image is still on disk:
```bash
docker images | grep botparty
# Then update docker-compose.yml to pin the old tag temporarily
```

---

## Emergency: Stop All Active Robot Sessions

```bash
# Via admin panel: Moderation → Active Sessions → End All
# Or via redis-cli scan:
docker compose exec redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "robot:session:*" | xargs -r redis-cli -a "$REDIS_PASSWORD" --no-auth-warning del'
docker compose restart api
```

---

## Observability

- Prometheus scrape endpoints:
   - API: `/health/metrics`
   - Streamer: `/metrics`
- Grafana dashboard template: `docs/grafana/botparty-observability-overview.json`
- Setup notes and metric inventory: `docs/observability.md`

---

## Contact & Escalation

- Check application logs first: `docker compose logs -f --since=1h`
- For persistent issues: check nginx error log in the nginx container
- LiveKit cloud dashboard (if using managed LiveKit): https://cloud.livekit.io

---

## HSTS Strategy

The TLS template ships with `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

We deliberately do **not** enable `preload` by default because:

- `preload` is irrevocable on the order of months once the domain is on the
  Chrome preload list.
- Self-hosters may operate on a sub-domain whose parent does not yet serve
  HTTPS on every host.
- We support a 1-year `max-age` which already protects realistic users.

To opt in (e.g. on a stable, fully-HTTPS apex domain):

1. Confirm every sub-domain (incl. `www`, `api`, `livekit`, `egress`, ...) is
   reachable over HTTPS.
2. Edit `docker/nginx/nginx.ssl.conf.template` and append `; preload` to the
   `Strict-Transport-Security` header.
3. Submit the apex domain on https://hstspreload.org/.
4. Document the activation date and ETA for delisting in this runbook.

Until then, leave the default in place.

---

## Production Release Checklist

A linear checklist for cutting a production deploy. Do not skip steps.

1. **DNS**
   - `A`/`AAAA` for app (`botparty.example.com`), API (`api.…`), LiveKit
     (`livekit.…`), Egress (`egress.…`), MinIO public (`media.…`).
   - TTL ≤ 300s during cut-over.
2. **TLS**
   - Run `./scripts/setup-env.sh` (or generate certs out-of-band) to populate
     `docker/nginx/nginx.ssl.conf` from the template.
   - Verify Let's Encrypt staging first, then production.
3. **Secrets**
   - All values from `.env.example` set; no `devkey`, no `change_me_*`.
   - `WEBHOOK_SECRET_ENCRYPTION_KEY` set (≥ 32 chars).
   - `STRIPE_*`/`PAYPAL_*` only set if billing is enabled — once set, the boot
     guard will require the respective webhook secret.
4. **Migrations**
   - Take a Postgres snapshot (`./scripts/backup-db.sh`).
   - Bring the API container up; entrypoint runs `prisma migrate deploy`.
   - Confirm `_prisma_migrations` table contains every committed migration.
   - In production the entrypoint refuses to fall back to `prisma db push`.
5. **Smoke tests**
   - `curl -fsS https://<host>/api/v1/health` returns `200`.
   - `curl -I https://<host>/` returns identical CSP across HTML and API
     responses (no `unsafe-eval`).
   - Headless smoke: `pnpm --filter @botparty/web exec playwright test`.
6. **Monitoring**
   - Prometheus is scraping `/health/metrics` (status 200).
   - Loki / Promtail (if enabled) sees container logs.
   - Sentry receives a release event (set `SENTRY_RELEASE`).
7. **Backups**
   - Cron pulls `./scripts/backup-db.sh` once per day; verify a sample restore
     into a staging DB at least once per quarter (see Backup/Restore below).
8. **Rollback plan**
   - Keep the previous image tag pinned in `docker-compose.yml`.
   - Restore script ready (see Backup/Restore below).
   - Operator on call has access to MinIO bucket and Postgres dumps.

---

## Backup & Restore

### Backup

`./scripts/backup-db.sh` produces `data/backups/botparty-<TIMESTAMP>.sql.gz`
and prunes anything older than `BACKUP_RETENTION_DAYS` (default 14).

Schedule via host cron, e.g.:

```cron
15 3 * * *  cd /opt/botparty && ./scripts/backup-db.sh >> /var/log/botparty-backup.log 2>&1
```

Recordings/uploaded media live in MinIO. Mirror the MinIO data directory
(`./data/minio`) with `restic`, `borg`, or `rclone sync` to an off-host
target. We recommend object-lock or append-only credentials on the remote.

### Restore

Use `./scripts/restore-db.sh <path/to/dump.sql.gz>`. The script:

1. Stops the API service so no writes happen during restore.
2. Drops & recreates the `botparty` database.
3. Pipes the gzip dump through `psql`.
4. Brings the API back up which re-applies migrations idempotently.

For MinIO, copy the backup tree back to `./data/minio` while the MinIO
container is stopped. Then restart MinIO and verify `mc ls` lists the
expected buckets.

Test restores quarterly into the dedicated `botparty-staging` database name
to validate dumps are usable.

---

## Production Migration Procedure

1. Land the migration in a feature branch via
   `pnpm --filter @botparty/prisma exec prisma migrate dev --create-only`.
2. Hand-review the generated SQL (`packages/prisma/prisma/migrations/<ts>_*`).
3. Open a PR. CI runs `pnpm openapi:export` and the API/Web test suites.
4. Merge to `main`. Tag a release (`vX.Y.Z`).
5. The `release` GitHub workflow builds and pushes
   `ghcr.io/<org>/botparty-api:<version>` and `…-web:<version>`.
6. On the host:
   ```bash
   ./scripts/backup-db.sh
   docker compose pull
   docker compose up -d
   docker compose logs -f --tail=100 api    # entrypoint runs migrate deploy
   ```
7. Verify `_prisma_migrations` row count equals committed migration count.
8. Run the smoke checklist above.
9. If anything fails, see "Rollback plan" — `docker compose pull` an older
   tag and `docker compose up -d`, then restore the latest pre-migration
   dump.

---

## Logrotation / Log Sink

By default container logs are written to the Docker JSON file driver. The
Compose stack caps this with `logging.options.max-size=20m,max-file=5` so
disk is bounded.

For long-running production hosts, ship logs into Loki:

```bash
docker compose --profile observability up -d loki promtail
```

Promtail reads each container's JSON log file and ships labelled streams
to Loki. Grafana (also under the `observability` profile) renders the
included dashboards from `docs/grafana/`.

For non-Loki environments, install the host's standard syslog → file
forwarder (Vector, Fluent Bit, journald) and point it at
`/var/lib/docker/containers/*/*.log`. The JSON driver caps already prevent
runaway disk usage if the forwarder is offline.
