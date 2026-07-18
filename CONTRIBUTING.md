# Contributing

## Setup

1. Install Node 24+ and pnpm 9.15+.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env` and set the required secrets.
4. Apply migrations with `pnpm --filter @botparty/prisma db:migrate:prod` and start local infra with `docker compose up -d postgres redis livekit-config livekit`.
5. Start the apps with `pnpm dev`.

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @botparty/api test`
- `pnpm --filter @botparty/web test`
- `pnpm build`

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
