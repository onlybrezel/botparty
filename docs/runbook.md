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

## Disk Full

**Symptoms:** Logs stop, uploads fail, DB writes fail.

**Steps:**
1. Check disk: `df -h /`
2. Check recordings volume: `du -sh data/livekit-recordings/`
3. If you still use local recording fallback storage, remove old recordings: `find data/livekit-recordings/ -mtime +7 -delete`
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

Example cron entry:

```bash
0 */6 * * * cd /srv/botparty && ./scripts/backup-db.sh >> /var/log/botparty-backup.log 2>&1
```

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
