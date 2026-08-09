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
5. Select the newest archive that satisfies the operator-approved recovery-point objective and run `BACKUP_ENCRYPTION_KEY_FILE=/secure/path/backup_encryption_key ./scripts/restore-drill.sh data/backups/botparty-release-<TIMESTAMP>.tar.gz.enc` first. This validates authenticated decryption, checksums, PostgreSQL, migrations, schema drift, object storage, application login, protected data access, and a recording download in an isolated environment.
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
2. Check max memory config in [docker/redis/redis.conf](../docker/redis/redis.conf)
3. Inspect keyspace and allocator pressure without reading values: `docker compose exec redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning info keyspace; redis-cli -a "$REDIS_PASSWORD" --no-auth-warning memory doctor'`.
4. Redis carries leases, fencing tokens, queue state, presence, and pub/sub coordination. Do not delete keys or flush the database to recover memory. Stop API traffic before changing memory limits or restoring Redis so two replicas cannot reconstruct conflicting leases.
5. After correcting the capacity or host-memory problem, restart Redis with `docker compose restart redis`, confirm AOF loading in the logs, then restore API traffic only after readiness succeeds.

---

## API Container Crash Loop

**Symptoms:** `docker compose ps api` shows restart loop, web returns 502.

**Steps:**

1. Check logs: `docker compose logs --tail=50 api`
2. Look for startup errors (JWT secret, DB connection, Redis connection).
3. Check required configuration presence without printing values: `docker compose exec -T api node -e "for (const key of ['JWT_SECRET','DATABASE_URL','REDIS_HOST']) console.log(key, process.env[key] ? 'set' : 'missing')"`
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

Production Compose reads credentials from `BOTPARTY_SECRET_DIR` (default `docker/secrets`) and mounts them read-only. Run `setup-env.sh` to create mode-0600 files, or provision files with the names used by `docker/api/entrypoint.sh`. `pnpm secrets:smoke` proves that PostgreSQL, Redis, SeaweedFS, and the generated LiveKit configurations start without direct secret environment variables.

The observability profile additionally requires `alertmanager_webhook_url` in the same secret directory. Alertmanager refuses to start with a missing or non-HTTP(S) endpoint so alerts cannot be silently discarded.

---

## PostgreSQL 16 → 18 Major Upgrade

[PostgreSQL major upgrades](https://www.postgresql.org/docs/18/upgrading.html) require dump/restore,
`pg_upgrade`, or logical replication; major versions cannot reuse each other's data directory. The
[PostgreSQL 18 Docker image](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata)
also changed its persistent mount to `/var/lib/postgresql` and uses
`/var/lib/postgresql/18/docker` as `PGDATA`. The Compose stack therefore uses a new
`<project>_postgres18_data` volume instead of the old `<project>_postgres_data` volume.

### Preconditions

1. Confirm the current database is PostgreSQL 16 and healthy:
   `docker compose exec postgres psql -U botparty -d botparty -Atc 'SHOW server_version'`.
2. Create and externally copy a current encrypted release backup with
   `pnpm backup:release`. Complete a restore drill against that archive.
3. Reserve free disk space for the PostgreSQL 16 volume, the custom-format dump, and the new
   PostgreSQL 18 volume at the same time.
4. Announce downtime. The supplied procedure is an offline dump/restore and stops the Compose
   stack to prevent writes during the cutover.
5. Pull the release and make sure `docker/secrets/db_password` (or
   `${BOTPARTY_SECRET_DIR}/db_password`) is readable and non-empty.

### Upgrade

```bash
git pull --ff-only
pnpm db:upgrade:postgres18
docker compose up -d --build
docker compose exec postgres psql -U botparty -d botparty -Atc \
  "SELECT current_setting('server_version'), current_setting('data_checksums')"
docker compose ps
docker compose logs --tail=100 postgres migrate api
```

The upgrade command:

- refuses to run unless the source volume contains PostgreSQL 16;
- refuses to overwrite an existing PostgreSQL 18 target volume;
- creates a consistent custom-format dump with PostgreSQL 16 tooling;
- initializes PostgreSQL 18 with data checksums and restores with PostgreSQL 18 tooling;
- compares exact row counts for every user table before accepting the target;
- runs staged `ANALYZE`; and
- never deletes the PostgreSQL 16 source volume.

For a non-default Compose project name, export the same `COMPOSE_PROJECT_NAME` used by the
deployment. Explicit volume overrides are available as `POSTGRES_16_VOLUME` and
`POSTGRES_18_VOLUME`.

### Rollback

Do not delete the PostgreSQL 16 source volume during the rollback window. If validation fails,
stop the new stack, check out the preceding PostgreSQL-16 release, and start it with the retained
`<project>_postgres_data` volume. Writes made after the PostgreSQL 18 cutover are not present in
that source volume; restore the pre-upgrade backup if the rollback policy requires a different
recovery point. Never point a PostgreSQL 16 image at `postgres18_data` or a PostgreSQL 18 image at
the old `postgres_data` directory.

After application smoke tests, migration drift checks, backup creation, and a PostgreSQL 18
restore drill have all passed, remove the old volume only through the operator's approved retention
procedure.

---

## Disk Full

**Symptoms:** Logs stop, uploads fail, DB writes fail.

**Steps:**

1. Check disk: `df -h /`
2. Check recordings volume: `du -sh data/livekit-recordings/`
3. Identify the largest paths with `du -xhd2 data /var/lib/docker | sort -h | tail -30` and verify whether growth comes from active volumes, logs, or completed archives.
4. Preview expired release archives with `find data/backups/ -name 'botparty-release-*.tar.gz.enc*' -mtime +<approved-days> -print`. Let `backup-release.sh` apply the explicitly configured `BACKUP_RETENTION_DAYS`; do not delete unverified recovery points during an incident.
5. Remove only artifacts whose owning workflow and retention policy are known. Docker images, object-storage data, database volumes, and legacy recordings are not interchangeable cleanup targets.

---

## Backup Strategy

The release backup contains a PostgreSQL custom-format dump, the recording and thumbnail buckets, a version manifest, and per-file checksums.

1. Schedule `./scripts/backup-release.sh` at an interval derived from the operator-approved recovery-point objective. `backup-db.sh` is a compatibility wrapper for the same command.
2. Set `BACKUP_RETENTION_DAYS` to the operator-approved retention period. The script default of 30 days is only a technical fallback, not a legal or recovery-policy decision.
3. Set `RESTORE_RPO_SECONDS` and `RESTORE_RTO_SECONDS` only after the operator has approved measurable objectives. Without these values the drill records age and duration but makes no RPO/RTO claim.
4. The monthly and release-triggered `restore-drill.yml` workflow restores into fresh isolated services and publishes a machine-readable report.
5. Alert when the newest successful archive exceeds the configured schedule plus tolerance, or when the scheduled restore drill fails.

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
   - Pulls the versioned API, Web and Nginx images from the configured registry
   - Announces update over websocket with a longer update retry window (`WS_SHUTDOWN_RETRY_AFTER_UPDATE_MS`, default 25s) and waits for drain
   - Rolls API and then Web; Nginx is validated and reloaded during each traffic handoff but is not replaced
   - Waits for API health gate via Docker container health before continuing
   - Waits short stabilization windows after API and Web rollout (`OPS_POST_API_STABILIZE_SEC`, `OPS_POST_WEB_STABILIZE_SEC`)
   - Starts replacement API/Web replicas beside the old replicas, admits them only after Docker health checks and an Nginx routing proof pass, and keeps the old replicas if either gate fails
   - Sends `SIGTERM` to admitted old replicas and allows up to `OPS_CONTAINER_STOP_TIMEOUT_SEC` (default 30 seconds) for graceful connection draining before removal
   - Validates and reloads the bind-mounted Nginx configuration without replacing the listening container

3. For a release built from the current checkout instead of a registry, use `APP_VERSION=<new-tag> ./ops.sh update-local`.
4. Manual fallback (if scripted rollout cannot be used):
   ```bash
   APP_VERSION=<new-tag> docker compose pull api web nginx
   APP_VERSION=<new-tag> docker compose run --rm --no-deps migrate
   APP_VERSION=<new-tag> docker compose up -d --no-deps --scale api=2 api
   curl -fsS http://127.0.0.1:8080/api/v1/health/ready
   APP_VERSION=<new-tag> docker compose up -d --no-deps --scale web=2 web
   docker compose exec -T nginx nginx -t
   docker compose exec -T nginx nginx -s reload
   ```
5. Keep old images until the rollback window closes.

The Compose topology has one host-port-owning Nginx container. The application rollout therefore reloads it in place; it does not make the reverse proxy highly available. Host-level proxy redundancy requires a second host or an external load balancer with an independent virtual IP.

Rollback to a previously verified image tag:

```bash
APP_VERSION=<previous-tag> ./ops.sh rollback
```

The command surges and health-gates API and Web exactly like an update, then reloads Nginx. It does not reverse database migrations. Release migrations must therefore remain compatible with the previous application version for the documented rollback window; destructive contract migrations require a later, separately approved release.

Schema migrations are executed once by the dedicated `migrate` container before API replacement. API replicas never run migrations during startup.

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

The production defaults include `connection_limit=10`, `pool_timeout=5`, and `connect_timeout=5` in generated `DATABASE_URL` values so connection exhaustion and database outages fail within a bounded interval.

**Tuning rule of thumb:**

1. Size `connection_limit` per API replica, not for the whole cluster.
2. Keep `replica_count * connection_limit` below PostgreSQL `max_connections` with room left for admin tooling and migrations.
3. If you inject `DATABASE_URL` through secrets, preserve the same query parameters explicitly.

Example:

```bash
DATABASE_URL=postgresql://botparty:***@postgres:5432/botparty?schema=public&connection_limit=10&pool_timeout=5&connect_timeout=5&sslmode=disable
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

## TLS Certificate Expiry

`scripts/backup-release.sh` publishes the certificate presence and expiry timestamp beside the backup metrics. Set `TLS_CERTIFICATE_FILE` when the certificate is not stored at `docker/nginx/ssl/fullchain.pem`. Prometheus warns when no certificate is exposed, rejects an unreadable certificate as critical, and warns 14 days before expiry. Renewal remains the responsibility of the configured ACME client or certificate operator; verify the renewed file and reload nginx before closing the alert.

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

1. **Release approval and preflight**
   - Record non-secret ticket or review references in `LEGAL_REVIEW_REFERENCE`, `PRIVACY_REVIEW_REFERENCE`, `BACKUP_RESTORE_REVIEW_REFERENCE` and `ALERTING_REVIEW_REFERENCE`.
   - When enabling billing, payouts or paid controls, also record the provider, payout-operations or physical robot-safety acceptance required by `.env.example`.
   - Run `./ops.sh preflight`. It validates the pinned version, public URLs, TLS mode, review references, host secret files and rendered Compose configuration without printing secret values.
   - Keep subscriptions disabled. Production startup rejects `FEATURE_SUBSCRIPTIONS_ENABLED=true` until the complete recurring lifecycle is release-enabled.
2. **DNS**
   - `A`/`AAAA` for app (`botparty.example.com`), API (`api.…`), LiveKit
     (`livekit.…`), Egress (`egress.…`), SeaweedFS public (`media.…`).
   - TTL ≤ 300s during cut-over.
3. **TLS**
   - Run `./setup-env.sh` (or generate certs out-of-band) to populate
     `docker/nginx/nginx.ssl.conf` from the template.
   - Keep `fullchain.pem` and `privkey.pem` at mode `0640` with group
     `BOTPARTY_SECRET_GID`; the non-root nginx container receives that group.
   - Verify Let's Encrypt staging first, then production.
4. **Secrets**
   - All values from `.env.example` set; no `devkey`, no `change_me_*`.
   - `WEBHOOK_SECRET_ENCRYPTION_KEY` set (≥ 32 chars).
   - For Docker/Kubernetes secret mounts, `WEBHOOK_SECRET_ENCRYPTION_KEY_FILE` can point to the mounted file path.
   - `STRIPE_*`/`PAYPAL_*` only set if billing is enabled — once set, the boot
     guard will require the respective webhook secret.
5. **Migrations**
   - Create a versioned database-and-object archive (`./scripts/backup-release.sh`).
   - Run the one-shot `migrate` service; API replicas never migrate on startup.
   - Confirm `_prisma_migrations` table contains every committed migration.
   - In production the entrypoint refuses to fall back to `prisma db push`.
6. **Smoke tests**
   - `curl -fsS https://<host>/api/v1/health/ready` returns `200`.
   - `curl -I https://<host>/` returns identical CSP across HTML and API
     responses (no `unsafe-eval`).
   - Headless smoke: `pnpm --filter @botparty/web exec playwright test`.
7. **Monitoring**
   - Prometheus is scraping `/api/v1/health/metrics` with the configured basic-auth credentials.
   - Loki / Promtail (if enabled) sees container logs.
   - The configured OpenTelemetry collector receives a trace carrying the release version.
8. **Backups**
   - The archive job runs at the operator-approved backup interval.
   - The latest scheduled `Backup Restore Drill` workflow completed successfully and, if an operator-approved RTO is configured, inside that objective.
9. **Rollback plan**
   - Keep the previous image tag pinned in `docker-compose.yml`.
   - Restore script ready (see Backup/Restore below).
   - Operator on call has access to SeaweedFS bucket and Postgres dumps.

### Release images and tags

BotParty publishes release images only from SemVer tags whose commit is reachable from `main`.

1. Create and push a SemVer tag such as `v0.1.4`.
2. Configure the `production-release` GitHub Environment with required reviewers and restrict it to protected release tags.
3. The release workflow repeats dependency, ENV, architecture, lint, type, API, Web and migration gates before it can enter that environment. Manual reruns must select the existing tag; branch refs are rejected.
4. GitHub Actions builds `ghcr.io/<owner>/botparty-api:<version>` and `ghcr.io/<owner>/botparty-web:<version>`. For tag `v0.1.4`, the immutable image version is `0.1.4`.
5. The same workflow also pushes the rolling tags `<major>.<minor>`, `<version>`, and `latest`.
6. Images are signed with keyless Cosign using GitHub OIDC. Verify with:

   ```bash
   cosign verify ghcr.io/<owner>/botparty-api:0.1.4 \
     --certificate-identity-regexp 'https://github.com/.+/.+/.github/workflows/release.yml@.+' \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```

7. Compose defaults to GHCR image references via `IMAGE_REGISTRY`, `IMAGE_NAMESPACE`, and `APP_VERSION`. Local `docker compose up --build` still works and simply retags the locally built image under the same name.

---

## Backup & Restore

### Backup

`./scripts/backup-release.sh` produces an authenticated AES-256-GCM archive at `data/backups/botparty-release-<TIMESTAMP>.tar.gz.enc` and a sidecar SHA-256 checksum. The encrypted archive contains a PostgreSQL custom-format dump, object-storage buckets, a release manifest, and per-file checksums. Archives older than `BACKUP_RETENTION_DAYS` are pruned. Set that value explicitly from the approved recovery and retention policy; the script's 30-day default is only a technical fallback.

The command requires `DATABASE_WRITE_URL` or `DATABASE_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY_FILE`, and `BACKUP_ENCRYPTION_KEY_FILE`. Keep the encryption key in a separately protected secret store and include its recovery procedure in the disaster-recovery access plan. Losing the key makes the archive unrecoverable.

Schedule via host cron, e.g.:

```cron
0 */6 * * *  cd /opt/botparty && ./scripts/backup-release.sh >> /var/log/botparty-backup.log 2>&1
```

Copy completed archives and checksum sidecars to immutable off-host storage. The backup command requires explicit database and S3-compatible object-storage credentials and never falls back to development values.

### Restore

Use `BACKUP_ENCRYPTION_KEY_FILE=/secure/path/backup_encryption_key ./scripts/restore-drill.sh <path/to/botparty-release-*.tar.gz.enc>`. `restore-db.sh` is a compatibility wrapper for this isolated drill. Set `RESTORE_API_IMAGE` to the release image being recovered, and provide `RESTORE_TEST_EMAIL` plus `RESTORE_TEST_PASSWORD_FILE` for an administrator contained in the backup. The drill:

1. verifies the encrypted archive checksum and authenticated decryption before extraction;
2. validates that every required secret file exists without exposing its value;
3. records archive age and, when `RESTORE_RPO_SECONDS` is configured, rejects older archives;
4. restores PostgreSQL and objects into fresh isolated containers;
5. deploys migrations, checks schema drift, starts the release API with fresh Redis, Mailpit, and LiveKit services, and verifies restored login, protected data access, and a byte-identical recording download;
6. records elapsed time and, when `RESTORE_RTO_SECONDS` is configured, fails if that objective is exceeded;
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
6. On the host, use the health-gated release workflow rather than starting all application services in place:
   ```bash
   APP_VERSION=<version> ./ops.sh update
   ```
7. Verify `_prisma_migrations` row count equals committed migration count.
8. Run the smoke checklist above.
9. If anything fails, see "Rollback plan" — `docker compose pull` an older
   tag and `docker compose up -d`, then restore the latest pre-migration
   dump.

---

## Logrotation / Log Sink

By default container logs are written to the Docker JSON file driver. The
Compose stack caps this with `logging.options.max-size=10m,max-file=5` so
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
