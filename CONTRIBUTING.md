# Contributing to BotParty

Thank you for your interest in contributing to BotParty!

## Project Structure

This is a monorepo with three main components:

- `apps/api` — NestJS backend (Fastify, Prisma, Redis, LiveKit)
- `apps/web` — Next.js frontend (App Router, Tailwind v4)
- `packages/shared` — Shared TypeScript types, schemas, and constants
- `packages/prisma` — Prisma schema and seed scripts

The robot client and streamer live in separate repositories:
- [`botparty-client`](https://github.com/onlybrezel/botparty-client) — Python robot client
- [`botparty-streamer`](https://github.com/onlybrezel/botparty-streamer) — Go H.264 streamer

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 9.15
- Docker + Docker Compose

### Local Development

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Start the full stack (requires a running .env)
docker compose up -d postgres redis

For container-only changes you do not need to rebuild the whole stack:

```bash
pnpm docker:build:api
pnpm docker:build:web
pnpm docker:build:app
```

# Run API + Web in dev mode
pnpm dev
```

### Environment

Copy `.env.example` to `.env` and fill in the required values before running.

## Code Style

- TypeScript strict mode is required — no `any` unless absolutely necessary
- Follow existing naming conventions: `camelCase` for variables/functions, `PascalCase` for classes/components
- Run `pnpm lint` and `pnpm typecheck` before submitting a PR
- Backend: thin controllers, logic in services
- Frontend: Server Components where possible, Client Components for interactivity

## Commits

- Use clear, imperative commit messages: `fix: prevent memory leak in policy cache`
- Keep commits focused — one logical change per commit
- Do **not** add `Co-authored-by` trailers

## Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes, keeping diffs focused and readable
3. Ensure `pnpm lint` and `pnpm typecheck` pass
4. Open a PR with a clear description of what changed and why
5. Reference any related issues

## Reporting Issues

Please open a GitHub issue with:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or screenshots

## Security

If you discover a security vulnerability, please **do not** open a public issue.
Contact the maintainers privately instead.
