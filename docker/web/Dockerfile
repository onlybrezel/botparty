# ─── Stage 1: Build ───────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./
COPY packages/tsconfig/ packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Build shared + web
RUN pnpm --filter @botparty/shared build
RUN pnpm --filter @botparty/web build

# ─── Stage 2: Production ─────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone Next.js build
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
