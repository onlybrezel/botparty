# syntax=docker/dockerfile:1
# ----------------------------------------------
# BotParty Web Dockerfile (multi-stage, BuildKit)
# Requires BuildKit (Docker 23+ default).
# Cache mounts keep pnpm store and Next.js SWC/
# webpack cache between rebuilds.
# ----------------------------------------------

# ─── deps: install workspace dependencies ─────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS deps
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/tsconfig/      packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/package.json  packages/shared/package.json
COPY apps/web/package.json         apps/web/package.json
# Cache mount: pnpm downloads are reused across builds.
RUN --mount=type=cache,id=pnpm-store-web,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

FROM deps AS dev
WORKDIR /app
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm --filter @botparty/shared build
EXPOSE 3000
CMD ["pnpm", "--filter", "@botparty/web", "dev"]

# ─── builder: compile shared, then Next.js ────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app
ARG NEXT_PUBLIC_APP_VERSION=dev
ARG PUBLIC_DEPLOYMENT=true
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_LEGAL_OPERATOR_NAME
ARG NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL
ARG NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS
ARG NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY
ARG NEXT_PUBLIC_LEGAL_GOVERNING_LAW
ARG NEXT_PUBLIC_LEGAL_VAT_ID
ARG NEXT_PUBLIC_LEGAL_COMMERCIAL_REGISTER
ARG NEXT_PUBLIC_LEGAL_SUPPORT_URL
ARG NEXT_PUBLIC_IMAGE_REMOTE_HOSTS
ARG NEXT_PUBLIC_FEATURE_BILLING=false
ARG NEXT_PUBLIC_FEATURE_DONATIONS=false
ARG NEXT_PUBLIC_FEATURE_PAYOUTS=false
ARG NEXT_PUBLIC_FEATURE_PAID_CONTROLS=false

# Restore workspace config so pnpm --filter resolves correctly.
COPY --from=deps /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules

COPY packages/tsconfig/      packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/        packages/shared/
COPY apps/web/               apps/web/
COPY scripts/validate-public-env.mjs scripts/validate-public-env.mjs

RUN pnpm --filter @botparty/shared build

# Persist Next.js SWC/webpack cache between builds via cache mount.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV PUBLIC_DEPLOYMENT=${PUBLIC_DEPLOYMENT}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_LIVEKIT_URL=${NEXT_PUBLIC_LIVEKIT_URL}
ENV NEXT_PUBLIC_LEGAL_OPERATOR_NAME=${NEXT_PUBLIC_LEGAL_OPERATOR_NAME}
ENV NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL=${NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL}
ENV NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS=${NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS}
ENV NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY=${NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY}
ENV NEXT_PUBLIC_LEGAL_GOVERNING_LAW=${NEXT_PUBLIC_LEGAL_GOVERNING_LAW}
ENV NEXT_PUBLIC_LEGAL_VAT_ID=${NEXT_PUBLIC_LEGAL_VAT_ID}
ENV NEXT_PUBLIC_LEGAL_COMMERCIAL_REGISTER=${NEXT_PUBLIC_LEGAL_COMMERCIAL_REGISTER}
ENV NEXT_PUBLIC_LEGAL_SUPPORT_URL=${NEXT_PUBLIC_LEGAL_SUPPORT_URL}
ENV NEXT_PUBLIC_IMAGE_REMOTE_HOSTS=${NEXT_PUBLIC_IMAGE_REMOTE_HOSTS}
ENV NEXT_PUBLIC_FEATURE_BILLING=${NEXT_PUBLIC_FEATURE_BILLING}
ENV NEXT_PUBLIC_FEATURE_DONATIONS=${NEXT_PUBLIC_FEATURE_DONATIONS}
ENV NEXT_PUBLIC_FEATURE_PAYOUTS=${NEXT_PUBLIC_FEATURE_PAYOUTS}
ENV NEXT_PUBLIC_FEATURE_PAID_CONTROLS=${NEXT_PUBLIC_FEATURE_PAID_CONTROLS}
RUN --mount=type=cache,id=next-build-cache,target=/app/apps/web/.next/cache \
    pnpm --filter @botparty/web build

# ─── runner: minimal production image ─────────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner
WORKDIR /app

ARG NEXT_PUBLIC_APP_VERSION=dev
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
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
