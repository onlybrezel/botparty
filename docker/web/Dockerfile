# syntax=docker/dockerfile:1
# ----------------------------------------------
# BotParty Web Dockerfile (multi-stage, BuildKit)
# Requires BuildKit (Docker 23+ default).
# Cache mounts keep pnpm store and Next.js SWC/
# webpack cache between rebuilds.
# ----------------------------------------------

# ─── deps: install workspace dependencies ─────
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/tsconfig/      packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/package.json  packages/shared/package.json
COPY apps/web/package.json         apps/web/package.json
# Cache mount: pnpm downloads are reused across builds.
RUN --mount=type=cache,id=pnpm-store-web,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

# ─── builder: compile shared, then Next.js ────
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Restore workspace config so pnpm --filter resolves correctly.
COPY --from=deps /app/.npmrc /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules

COPY packages/tsconfig/  packages/tsconfig/
COPY packages/shared/    packages/shared/
COPY apps/web/           apps/web/

RUN pnpm --filter @botparty/shared build

# Skip type-check and ESLint in Docker; those run in CI.
# Persist Next.js SWC/webpack cache between builds via cache mount.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_SKIP_TYPECHECK=1
RUN --mount=type=cache,id=next-build-cache,target=/app/apps/web/.next/cache \
    pnpm --filter @botparty/web build

# ─── runner: minimal production image ─────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to all interfaces so the 127.0.0.1 health check works inside Docker.
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Standalone output bundles only what is needed at runtime.
# outputFileTracingRoot=workspace root means Next.js generates:
#   .next/standalone/apps/web/server.js   ← entry point
#   .next/standalone/node_modules/        ← traced runtime deps
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public           ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
