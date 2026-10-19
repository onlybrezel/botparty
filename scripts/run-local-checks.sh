#!/usr/bin/env bash
set -euo pipefail

phase="${1:-checks}"
mkdir -p .local-ci-tmp data/local-ci
export TMPDIR="$PWD/.local-ci-tmp"
export TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal
export DOCKER_HOST_ADDRESS=host.docker.internal
export DATABASE_URL='postgresql://botparty:local-ci-password@127.0.0.1:5432/migration_test?schema=public'
export MIGRATION_TEST_DATABASE_URL="$DATABASE_URL"
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4000 NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
export NEXT_PUBLIC_WS_URL=ws://127.0.0.1:4000 NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880
export NEXT_PUBLIC_LEGAL_OPERATOR_NAME='BotParty local CI'
export NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL=ci@example.invalid
export NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS='Local isolated test environment'
export NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY=Germany NEXT_PUBLIC_LEGAL_GOVERNING_LAW=Germany
export API_URL=http://127.0.0.1:4000

if [[ "$phase" != performance ]]; then
  pnpm install --frozen-lockfile
  pnpm db:generate
  pnpm --filter @botparty/shared build
fi

if [[ "$phase" == checks || "$phase" == all ]]; then
  pnpm audit --prod --audit-level high
  pnpm lint
  pnpm env:check
  pnpm production:preflight:test
  sh scripts/test-dotenv-loader.sh
  pnpm architecture:check
  pnpm typecheck
  pnpm test
  pnpm --filter @botparty/api test:coverage
  pnpm --filter @botparty/web test:coverage
  pnpm db:verify-migrations
  pnpm db:upgrade:postgres18:test
  pnpm --filter @botparty/prisma db:migrate:prod
  QUEUE_BENCHMARK_ALLOW_WRITES=true pnpm benchmark:queue
  pnpm test:backup
  pnpm build
  pnpm --filter @botparty/web performance:budget
  node apps/api/dist/openapi/export-openapi.js docs/openapi.json
  pnpm docs:api-client
  git diff --exit-code -- docs/openapi.json docs/api-client.md
fi

if [[ "$phase" == compose || "$phase" == all ]]; then
  ./scripts/smoke-dev-compose.sh
  E2E_RUN_FAILOVER=true E2E_RESULT_DIR="$PWD/data/local-ci/browser" ./scripts/test-e2e-docker.sh
fi

if [[ "$phase" == lighthouse || "$phase" == all ]]; then
  export NODE_ENV=test CORS_ORIGIN=http://127.0.0.1:3000 PUBLIC_WEB_URL=http://127.0.0.1:3000
  export JWT_SECRET=local-ci-jwt-secret-at-least-32-characters
  export JWT_REFRESH_SECRET=local-ci-refresh-secret-at-least-32-characters
  export ROBOT_JWT_SECRET=local-ci-robot-secret-at-least-32-characters
  export LIVEKIT_API_KEY=local-ci-key LIVEKIT_API_SECRET=local-ci-livekit-secret-at-least-32-characters
  export LIVEKIT_URL=ws://127.0.0.1:7880
  export WEBHOOK_SECRET_ENCRYPTION_KEY=local-ci-webhook-secret-at-least-32-characters
  export SEED_ADMIN_EMAIL=admin@botparty.test SEED_ADMIN_USERNAME=e2e_admin
  export SEED_ADMIN_PASSWORD=local-ci-admin-password-at-least-16 SEED_DEMO_USER_PASSWORD=local-ci-demo-password
  export SEED_E2E_FIXTURES=true LHCI_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" LHCI_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD"
  pnpm --filter @botparty/prisma db:migrate:prod
  pnpm --filter @botparty/prisma db:seed
  pnpm build
  export CHROME_PATH="$(pnpm --filter @botparty/web exec node -e 'process.stdout.write(require("@playwright/test").chromium.executablePath())')"
  TMPDIR=/tmp pnpm --filter @botparty/web performance:lighthouse
  cp -a apps/web/.lighthouseci data/local-ci/lighthouse
fi

if [[ "$phase" == performance || "$phase" == all ]]; then
  PERFORMANCE_REPORT_DIR=data/local-ci/performance ./scripts/run-performance-smoke.sh
fi
