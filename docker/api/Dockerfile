# ─── Stage 1: Build ───────────────────────────────────
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./
COPY packages/tsconfig/ packages/tsconfig/
COPY packages/eslint-config/ packages/eslint-config/
COPY packages/shared/ packages/shared/
COPY packages/prisma/ packages/prisma/
COPY apps/api/ apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Generate Prisma client
RUN pnpm --filter @botparty/prisma db:generate

# Build shared packages first, then API
RUN pnpm --filter @botparty/shared build
RUN pnpm --filter @botparty/api build

# ─── Stage 2: Production ─────────────────────────────
FROM node:24-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/prisma/generated ./packages/prisma/generated
COPY --from=builder /app/packages/prisma/package.json ./packages/prisma/package.json
COPY --from=builder /app/packages/prisma/prisma ./packages/prisma/prisma
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Run prisma migrations on startup, then start API
EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
