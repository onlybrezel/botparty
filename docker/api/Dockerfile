# syntax=docker/dockerfile:1
# ----------------------------------------------
# BotParty API Dockerfile (multi-stage, BuildKit)
# Cache mounts keep pnpm store between rebuilds so
# only changed packages are re-fetched.
# ----------------------------------------------

# ─── base: pnpm enabled ───────────────────────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base
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

FROM deps AS dev
WORKDIR /app
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY docker/api/dev-entrypoint.sh /usr/local/bin/botparty-dev-entrypoint
COPY docker/api/load-file-secrets.sh /usr/local/lib/botparty-load-file-secrets.sh
COPY docker/api/load-file-secrets.sh /load-file-secrets.sh
COPY docker/api/migrate-entrypoint.sh /migrate-entrypoint.sh
COPY scripts/prepare-prisma-baseline.mjs scripts/prepare-prisma-baseline.mjs
COPY scripts/migrate-webhook-secrets.mjs scripts/migrate-webhook-secrets.mjs
RUN pnpm --filter @botparty/prisma db:generate \
 && pnpm --filter @botparty/shared build \
 && chmod +x /usr/local/bin/botparty-dev-entrypoint /migrate-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["botparty-dev-entrypoint"]
CMD ["pnpm", "--filter", "@botparty/api", "dev"]

# ─── build-shared: compile @botparty/shared ───
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
RUN pnpm --filter @botparty/shared build

# ─── build-api: generate Prisma + compile API ─
FROM deps AS build-api
COPY packages/prisma/ packages/prisma/
COPY packages/shared/ packages/shared/
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
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner
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
COPY --chown=botparty:botparty scripts/prepare-prisma-baseline.mjs              ./scripts/prepare-prisma-baseline.mjs
COPY --chown=botparty:botparty scripts/migrate-webhook-secrets.mjs              ./scripts/migrate-webhook-secrets.mjs
COPY --chown=botparty:botparty scripts/api-cluster.mjs                          ./scripts/api-cluster.mjs

# Shared + API compiled output
COPY --from=build-shared --chown=botparty:botparty /app/packages/shared/dist   ./packages/shared/dist
COPY --from=build-api    --chown=botparty:botparty /app/apps/api/dist           ./apps/api/dist

COPY --chown=botparty:botparty docker/api/entrypoint.sh /entrypoint.sh
COPY --chown=botparty:botparty docker/api/migrate-entrypoint.sh /migrate-entrypoint.sh
COPY --chown=botparty:botparty docker/api/load-file-secrets.sh /load-file-secrets.sh
RUN chmod +x /entrypoint.sh /migrate-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/entrypoint.sh"]
