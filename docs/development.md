# Developer Guide

## Start here

BotParty is a pnpm/Turbo monorepo. Docker is the supported runtime for development, integration
tests, and production. Install Docker Engine with the Compose plugin, Node 24, and pnpm 11.21.

```bash
pnpm install
bash setup-env.sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

The development stack starts PostgreSQL, Redis, SeaweedFS, LiveKit, API, Web, and Nginx. `migrate` is a
one-shot dependency: it applies committed migrations and converges the idempotent seed before API
startup. Development mail is disabled unless `SMTP_HOST` is set; use a disposable local SMTP
capture service when testing mail. Production requires a reachable SMTP server.

Use `pnpm dev:smoke` to build an isolated development stack and prove API and Web hot reload. The
script creates temporary secrets and volumes and removes them when it finishes.

## Repository map

| Path                                         | Responsibility                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/api/src/bootstrap`                     | Nest module composition and global guards/interceptors                          |
| `apps/api/src/auth`                          | JWT/refresh sessions, password and verification workflows, role guards          |
| `apps/api/src/robots`                        | Robot ownership, ACLs, metadata, device credentials, cameras, files, webhooks   |
| `apps/api/src/gateway`                       | WebSocket protocol, room/turn/control handlers, Redis fan-out and leases        |
| `apps/api/src/queue`                         | Durable queue ordering and admission rules                                      |
| `apps/api/src/livekit`                       | Media tokens, ingress/egress integration, robot media runtime endpoints         |
| `apps/api/src/wallet`, `billing`, `earnings` | Ledger, payments, donations, payouts, idempotency                               |
| `apps/api/src/moderation`                    | Staff actions, audit records, runtime diagnostics and recording access          |
| `apps/api/src/health`                        | Health HTTP boundary, dependency checks, public stats and Prometheus metrics    |
| `apps/web/src/app`                           | Next.js App Router pages and route boundaries                                   |
| `apps/web/src/components`                    | Product views; dashboard and robot-room workflows live in named feature folders |
| `apps/web/src/lib/api`                       | The only browser HTTP client path, including cookies, CSRF and error mapping    |
| `packages/shared`                            | Runtime schemas, protocol constants and cross-application contract types        |
| `packages/prisma`                            | PostgreSQL schema, migrations, generated client and seed                        |
| `docker-compose*.yml`, `docker/`             | Runtime topology, images, proxy and observability configuration                 |
| `scripts/`                                   | Reproducible migration, backup, restore, smoke, load and contract checks        |

## Finding a business rule

HTTP input is validated in a controller with a shared Zod schema or a focused DTO. Authentication
and global roles are guards. Resource visibility and owner isolation are checked in the relevant
service and normally return 404 for a resource the caller must not be able to enumerate. Database
transactions, locks and idempotency stay beside the business mutation that requires them.

Realtime events enter `BotGateway`, are parsed against shared schemas, and are delegated to the
handlers in `apps/api/src/gateway`. PostgreSQL is authoritative for durable queue/session data;
Redis owns cross-instance fan-out, rate limits, short-lived coordination and fenced active-turn
leases. Do not replace Redis-backed correctness state with process-local state.

The wallet is a PostgreSQL ledger. Billing and payout services may call it, but must not update
balances directly. Object-store writes use compensating deletion/outbox handling so a database
failure does not silently orphan private files.

## API and types

The frontend imports `api` or `createApiClient` from `apps/web/src/lib/api.ts` and domain modules
under `apps/web/src/lib/api/`. Do not introduce another HTTP client. Shared protocol schemas belong
in `packages/shared`; database-only types remain in Prisma and view-only types remain with their
feature.

After controller changes, refresh the checked-in contract artifacts:

```bash
pnpm openapi:export
pnpm docs:api-client
```

## Database changes

Create migration SQL locally, review it, and commit it with the schema change:

```bash
pnpm --filter @botparty/prisma exec prisma migrate dev --create-only
pnpm db:verify-migrations
```

Deploy with the one-shot migration service:

```bash
docker compose run --rm migrate
```

Migrations must remain compatible with the preceding application version during the rollback
window. API, Web, workers and schedulers must never run schema migrations independently.

The reference stack runs PostgreSQL 18. PostgreSQL 16 installations require the offline,
volume-preserving `pnpm db:upgrade:postgres18` procedure before starting the current Compose file.
This major-version data migration is separate from Prisma schema migrations; see the production
runbook for preconditions, verification, and rollback.

## Tests

On Windows with Docker Desktop using Linux containers, run the local CI runner
from a clean, committed checkout:

```powershell
pwsh -NoProfile -File scripts/test-local-docker.ps1 -Phase all
```

The runner tests an exact Git snapshot in a disposable Linux volume, with Node,
pnpm, Playwright and the Docker CLI supplied by the pinned runner image. This
avoids Windows package-wrapper, file-mode and line-ending differences. It uses
the local Docker socket to start isolated test services; no GitHub Actions run or
registry push is involved. Logs and the source commit are saved under
`data/local-ci/<run-id>/`; the run's containers and source volume are removed.

Use `-Phase checks`, `-Phase compose` or `-Phase performance` for a focused rerun.
The checks phase includes audit, lint, types, unit/integration tests, coverage,
database upgrade and migration checks, backups, queue and bundle budgets, and
generated API contract parity. Compose runs development hot reload and the
production browser suite. Performance runs the isolated API load scenario.

Fast local feedback uses the repository's pinned Node runtime:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @botparty/api test
pnpm --filter @botparty/web test
pnpm architecture:check
```

Production behavior is verified with isolated Docker projects:

```bash
pnpm test:e2e:docker
pnpm dev:smoke
pnpm test:backup
```

Tests for auth, roles, ownership, queueing, wallet mutations, WebSocket coordination, migrations and
storage should assert observable behavior. Add characterization coverage before changing a poorly
understood security or concurrency path.

## Operations and release

- Deployment, incidents, backups, restore and migration procedure: `docs/runbook.md`
- Metrics, dashboards and alerts: `docs/observability.md`
- Realtime wire contract: `docs/websocket-protocol.md`
- Robot authentication: `docs/robot-auth.md`
- Architecture decisions: `docs/adr/`
- Security reporting: [`SECURITY.md`](../SECURITY.md)
