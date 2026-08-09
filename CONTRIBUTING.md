# Contributing

## Setup

1. Install Docker Engine, the Docker Compose plugin, Node 24, and pnpm 11.21.
2. Run `pnpm install` for editor tooling and the containerized browser runner.
3. Run `bash setup-env.sh` and choose the local development configuration.
4. Start the Docker development stack:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
   ```

The one-shot `migrate` service owns schema changes and seed convergence. API replicas do not run
migrations during startup. See [`docs/development.md`](docs/development.md) for module ownership and
common workflows.

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @botparty/api test`
- `pnpm --filter @botparty/web test`
- `pnpm build`
- `pnpm test:e2e:docker`

## Engineering rules

- Keep API controllers thin and move business logic into services or handlers.
- Reuse shared types from `packages/shared` instead of duplicating contracts.
- Treat realtime paths as latency-sensitive: avoid blocking work in websocket handlers.
- Use env-driven configuration for operational limits, secrets, and deployment-specific legal data.
- Add or extend tests whenever you change queueing, auth, moderation, or robot-control behavior.

## Docs and release artifacts

- Update `.env.example` whenever you add or change an env var.
- Update `docs/runbook.md` for operational behavior changes.
- Export a static OpenAPI snapshot with `pnpm openapi:export` when preparing release artifacts.
