# BotParty Production Runbook

Quick reference for common production incident scenarios.

---

## DB Corruption / Postgres Down

**Symptoms:** readiness returns `503` and reports discovery, auth, or control as unavailable; data endpoints fail.

**Steps:**
1. Check container status: `docker compose ps postgres`
2. Check logs: `docker compose logs --tail=50 postgres`
3. Attempt restart: `docker compose restart postgres`
4. Do not run `pg_resetwal` against the production volume. Preserve the failed volume for diagnosis.
5. Select the newest release archive that is inside the six-hour RPO and run `./scripts/restore-drill.sh data/backups/botparty-release-<TIMESTAMP>.tar.gz` first. This validates checksums, PostgreSQL, migrations, schema drift, and object storage in an isolated environment.
6. For a production replacement, provision new PostgreSQL and object-storage volumes, restore the verified archive with the same `pg_restore` and object mirror procedure, then switch the API connection only after the readiness probe passes.

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
5. Redis carries leases, fencing tokens, queue cache, presence, and pub/sub state. Keep AOF enabled and `maxmemory-policy noeviction`; never clear the database as an OOM response. If the instance cannot recover, stop API traffic before restoring Redis or allowing lease reconstruction from PostgreSQL.

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
7. A reachable `SMTP_HOST` and valid sender configuration. Production startup performs an SMTP handshake and fails when delivery is unavailable.

Production Compose reads credentials from `BOTPARTY_SECRET_DIR` (default `docker/secrets`) and mounts them read-only. Run `setup-env.sh` to create mode-0600 files, or provision files with the names used by `docker/api/entrypoint.sh`. `pnpm secrets:smoke` proves that PostgreSQL, Redis, MinIO, and the generated LiveKit configurations start without direct secret environment variables.

The observability profile additionally requires `alertmanager_webhook_url` in the same secret directory. Alertmanager refuses to start with a missing or non-HTTP(S) endpoint so alerts cannot be silently discarded.

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

The release backup contains a PostgreSQL custom-format dump, the recording and thumbnail buckets, a version manifest, and per-file checksums.

1. Run `./scripts/backup-release.sh` at least every six hours. `backup-db.sh` is a compatibility wrapper for the same command.
2. Keep encrypted, immutable off-host copies for 30 days by default.
3. Treat six hours as the RPO and one hour as the RTO unless the deployment sets stricter values.
4. The monthly and release-triggered `restore-drill.yml` workflow restores into fresh isolated services and publishes a machine-readable report.
5. Alert if the latest successful archive is older than six hours or the scheduled restore drill fails.

Example cron entry:

```bash
0 */6 * * * cd /srv/botparty && ./scripts/backup-release.sh >> /var/log/botparty-backup.log 2>&1
```

---

## OpenAPI Export

The API serves Swagger/OpenAPI at `/docs` when `SWAGGER_DOCS=true`. Production startup requires `SWAGGER_DOCS_USERNAME` and `SWAGGER_DOCS_PASSWORD` whenever the route is enabled.

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

BotParty can run multiple API instances behind a load balancer.

**Guaranteed across instances today:**
1. Robot claim exclusivity is coordinated through Redis lock keys.
2. Room broadcasts, queue snapshots, presence fan-out, and shutdown notices replicate through Redis pub/sub.
3. Active turns use Redis leases with monotonically increasing fencing tokens and reconstructible deadlines.
4. Control cooldowns use shared Redis state.
5. A reconnecting robot can land on a different instance without duplicating the control channel.

**Operational guidance:**
1. Drain websocket traffic before rotating replicas to avoid unnecessary reconnects.
2. Monitor lease acquisition failures and Redis persistence health.
3. Keep Redis on persistent storage with AOF and `noeviction`; it is part of the control-plane consistency model.

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

## Emergency: Stop Robot Control Traffic

Use the moderation console to end affected sessions. If the console is unavailable, stop the API service with `docker compose stop api`; this closes command sockets without deleting lease or queue data. Keep robot-local emergency-stop hardware available independently of the platform.

---

## Observability

- Prometheus scrape endpoints:
   - API: `/api/v1/health/metrics`
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
   - For Docker/Kubernetes secret mounts, `WEBHOOK_SECRET_ENCRYPTION_KEY_FILE` can point to the mounted file path.
   - `STRIPE_*`/`PAYPAL_*` only set if billing is enabled — once set, the boot
     guard will require the respective webhook secret.
4. **Migrations**
   - Create a versioned database-and-object archive (`./scripts/backup-release.sh`).
   - Bring the API container up; entrypoint runs `prisma migrate deploy`.
   - Confirm `_prisma_migrations` table contains every committed migration.
   - In production the entrypoint refuses to fall back to `prisma db push`.
5. **Smoke tests**
   - `curl -fsS https://<host>/api/v1/health/ready` returns `200`.
   - `curl -I https://<host>/` returns identical CSP across HTML and API
     responses (no `unsafe-eval`).
   - Headless smoke: `pnpm --filter @botparty/web exec playwright test`.
6. **Monitoring**
   - Prometheus is scraping `/api/v1/health/metrics` with the configured basic-auth credentials.
   - Loki / Promtail (if enabled) sees container logs.
   - The configured OpenTelemetry collector receives a trace carrying the release version.
7. **Backups**
   - The archive job runs at least every six hours.
   - The latest scheduled `Backup Restore Drill` workflow completed inside the configured RTO.
8. **Rollback plan**
    - Keep the previous image tag pinned in `docker-compose.yml`.
    - Restore script ready (see Backup/Restore below).
    - Operator on call has access to MinIO bucket and Postgres dumps.

### Release images and tags

BotParty publishes release images from Git tags.

1. Create and push a SemVer tag such as `v0.1.4`.
2. GitHub Actions workflow `.github/workflows/release.yml` builds `ghcr.io/<owner>/botparty-api:<tag>` and `ghcr.io/<owner>/botparty-web:<tag>`.
3. The same workflow also pushes the rolling tags `<major>.<minor>`, `<version>`, and `latest`.
4. Images are signed with keyless Cosign using GitHub OIDC. Verify with:

   ```bash
   cosign verify ghcr.io/<owner>/botparty-api:v0.1.4 \
     --certificate-identity-regexp 'https://github.com/.+/.+/.github/workflows/release.yml@.+' \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```

5. Compose defaults to GHCR image references via `IMAGE_REGISTRY`, `IMAGE_NAMESPACE`, and `APP_VERSION`. Local `docker compose up --build` still works and simply retags the locally built image under the same name.

---

## Backup & Restore

### Backup

`./scripts/backup-release.sh` produces `data/backups/botparty-release-<TIMESTAMP>.tar.gz` and a sidecar SHA-256 checksum. The archive includes a PostgreSQL custom-format dump, object-storage buckets, a release manifest, and file checksums. Archives older than `BACKUP_RETENTION_DAYS` are pruned; the default is 30 days.

Schedule via host cron, e.g.:

```cron
0 */6 * * *  cd /opt/botparty && ./scripts/backup-release.sh >> /var/log/botparty-backup.log 2>&1
```

Copy completed archives to encrypted immutable off-host storage. The backup command requires explicit database and S3-compatible object-storage credentials and never falls back to development values.

### Restore

Use `./scripts/restore-drill.sh <path/to/botparty-release-*.tar.gz>`. `restore-db.sh` is a compatibility wrapper for this isolated drill. The drill:

1. verifies archive and file checksums;
2. validates that every required secret file exists without exposing its value;
3. rejects archives older than `RESTORE_RPO_SECONDS`;
4. restores PostgreSQL and objects into fresh isolated containers;
5. deploys migrations, checks schema drift, and performs database and object smoke tests;
6. fails if elapsed time exceeds `RESTORE_RTO_SECONDS`;
7. writes a JSON report under `data/restore-drills/`.

Production recovery uses the verified dump and object tree to populate new volumes before traffic is switched. Never overwrite the failed source volumes during diagnosis.

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
   ./scripts/backup-release.sh
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
