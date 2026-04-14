# syntax=docker/dockerfile:1
# ----------------------------------------------
# BotParty API Dockerfile (multi-stage, BuildKit)
# Cache mounts keep pnpm store between rebuilds so
# only changed packages are re-fetched.
# ----------------------------------------------

# ─── base: pnpm enabled ───────────────────────
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# ─── deps: install ALL workspace deps ─────────
# python3/make/g++ compile native modules (argon2)
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/tsconfig/      packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/prisma/package.json   packages/prisma/package.json
COPY apps/api/package.json          apps/api/package.json
# Cache mount: pnpm downloads are reused across builds.
RUN --mount=type=cache,id=pnpm-store-api,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ─── build-shared: compile @botparty/shared ───
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
RUN pnpm --filter @botparty/shared build

# ─── build-api: generate Prisma + compile API ─
FROM deps AS build-api
COPY packages/prisma/ packages/prisma/
COPY apps/api/        apps/api/
COPY --from=build-shared /app/packages/shared/dist packages/shared/dist
RUN pnpm --filter @botparty/prisma db:generate
# Persist NestJS webpack/tsc cache between Docker builds.
RUN --mount=type=cache,id=nest-build-cache,target=/app/node_modules/.cache \
    pnpm --filter @botparty/api build

# ─── prod-deps: production-only node_modules ──
FROM base AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/tsconfig/      packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/prisma/package.json   packages/prisma/package.json
COPY apps/api/package.json          apps/api/package.json
RUN --mount=type=cache,id=pnpm-store-api-prod,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir=/pnpm/store

# ─── runner: minimal production image ─────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache su-exec \
 && addgroup -g 1001 botparty \
 && adduser -u 1001 -G botparty -D -s /bin/sh botparty

# Production node_modules (no devDeps)
COPY --from=prod-deps --chown=botparty:botparty /app/node_modules          ./node_modules
COPY --from=prod-deps --chown=botparty:botparty /app/package.json          ./
COPY --from=prod-deps --chown=botparty:botparty /app/pnpm-workspace.yaml   ./
COPY --from=prod-deps --chown=botparty:botparty /app/packages/shared/package.json  ./packages/shared/package.json
COPY --from=prod-deps --chown=botparty:botparty /app/packages/prisma/package.json  ./packages/prisma/package.json
COPY --from=prod-deps --chown=botparty:botparty /app/apps/api/package.json         ./apps/api/package.json

# Prisma: schema, generated client, seed script
COPY --from=build-api --chown=botparty:botparty /app/packages/prisma/generated  ./packages/prisma/generated
COPY --from=build-api --chown=botparty:botparty /app/packages/prisma/prisma     ./packages/prisma/prisma
COPY --from=build-api --chown=botparty:botparty /app/packages/prisma/seed.ts    ./packages/prisma/seed.ts

# Shared + API compiled output
COPY --from=build-shared --chown=botparty:botparty /app/packages/shared/dist   ./packages/shared/dist
COPY --from=build-api    --chown=botparty:botparty /app/apps/api/dist           ./apps/api/dist

COPY --chown=botparty:botparty docker/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/entrypoint.sh"]
