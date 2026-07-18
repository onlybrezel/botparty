# Maintainability Audit

Stand: 18.07.2026.

## Architecture overview

BotParty remains a Docker-first pnpm/Turbo monorepo with a NestJS/Fastify API, Next.js Web,
PostgreSQL/Prisma, Redis/BullMQ, LiveKit, MinIO and Nginx. API and Web support two replicas. The
system has global `USER`, `MOD` and `ADMIN` roles and owner/resource isolation; it does not contain
a B2B tenant model.

The runtime module graph was traced from API, Web and shared-package entry points. After this audit
there are no relative-import cycles in `apps/api/src`, `apps/web/src` or `packages/shared/src`.

| Area           | Main responsibility                                  | Direct infrastructure        | Primary tests                                   |
| -------------- | ---------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| Auth           | Sessions, tokens, password lifecycle, role guards    | Prisma, Redis, Mail          | Auth and role-matrix suites                     |
| Robots         | Ownership, ACLs, metadata, device/files/integrations | Prisma, Redis, MinIO, BullMQ | Robot, access, camera and storage suites        |
| Realtime       | Protocol, turns, control, chat, presence             | Redis, Prisma, WebSocket     | Gateway suites and multi-instance Docker E2E    |
| Queue          | Durable ordering and atomic limits                   | Prisma, Redis                | Queue service/controller and integration suites |
| Media          | LiveKit tokens, rooms, ingress/egress                | LiveKit, Robots, Queue       | LiveKit and camera suites                       |
| Wallet/Billing | Ledger, provider events, payouts                     | Prisma, Redis, providers     | Wallet, billing, donation and payout suites     |
| Health         | HTTP probes, dependency state, metrics               | all required dependencies    | Health/readiness/metrics suite                  |
| Web dashboard  | Robot configuration and operations                   | HTTP API, LiveKit preview    | dashboard hooks/components and E2E              |
| Web robot room | realtime room, control, queue, chat, media           | HTTP, WebSocket, LiveKit     | component, input, protocol and E2E suites       |

## Main complexity drivers

- `use-robot-view-state.ts` still coordinates access grants, WebSocket lifecycle, turn state, chat,
  queue state and media credentials. These concerns share ordering-sensitive refs and effects. A
  mechanical split would create a large implicit contract, so it was not attempted without a
  dedicated state-machine characterization suite.
- `use-dashboard-page.ts` was a 1,228-line controller hook. Controls, polling and thumbnail
  lifecycle now have feature hooks; the remaining 950 lines still cover several owner workflows
  and should be reduced only one workflow at a time.
- LiveKit, authentication, robot ownership and wallet services remain sizeable because they contain
  provider protocols or transaction invariants. Their boundaries are explicit and independently
  tested; repository wrappers around Prisma would add navigation without isolating another concern.
- Multi-instance correctness requires Redis leases, Pub/Sub, BullMQ and scheduler locks. This is
  necessary operational complexity, not optional cache infrastructure.

## Findings and implemented simplifications

- Removed a generated TypeScript API client that had no imports and duplicated the maintained
  product-specific browser client. OpenAPI and the generated Markdown reference remain.
- Removed unused Fastify CSRF/rate-limit/CORS declarations, UUID packages, a redundant direct Pino
  declaration and redundant Web Zod/Puppeteer declarations. The application uses the CSRF origin
  guard, Nest throttler, the Nest Fastify adapter's CORS integration, Node `crypto` UUIDs and shared
  Zod. Fastify owns its Pino runtime; `pino-pretty` remains a deliberate dynamic transport.
- Removed dead compatibility/DTO/subscription-builder files after checking source imports, tests,
  CI, Docker and documentation.
- Consolidated robot domain types and three duplicate stream-camera descriptors in
  `robots.types.ts`; the previous service/type cycle is gone.
- Removed the Nest `forwardRef` cycle. LiveKit now owns the two controllers/services that depend on
  both robot and media modules, yielding a one-way `LiveKit -> Queue -> Robots` dependency chain.
- Split Health HTTP handling, dependency checks and Prometheus rendering into named responsibilities.
- Consolidated duplicated create/edit control fields into one controlled component, protected by a
  behavior test.
- Extracted the complete thumbnail workflow from the dashboard controller hook.
- Removed the tracked Playwright last-run file and ignored browser runner output as runtime data.
- Removed an unreferenced locale switcher, a superseded OpenAPI fetch script, an obsolete k6 draft
  that did not speak the current WebSocket protocol and a placeholder `expect(true)` test. The
  current Docker E2E and bounded proxy load probe provide the real multi-instance evidence.
- Replaced the duplicated legacy-to-flat ESLint adapters with one native shared Flat Config. Apps
  now declare their lint runners directly, and no project ESLint rule is disabled.
- Consolidated duplicate/stale ADRs and corrected destructive or contradictory runbook guidance.

## Dependencies intentionally retained

- `pino-pretty` is resolved by name as Fastify's development transport; Fastify itself owns the
  structured production logger.
- `@lhci/cli` is invoked by the performance script, the Prisma client package is required for code
  generation, and the ESLint/parser/config packages are executable or string-resolved tooling.
- Prisma, Zod, Argon2, Stripe, AWS S3, Sharp, LiveKit, BullMQ, ioredis and OpenTelemetry each own a
  non-trivial protocol, security primitive or runtime integration. Reimplementing them would
  increase risk.
- Zustand is used for persisted auth/preferences and dashboard drafts. Server state is not mirrored
  into a second query/cache framework.

## Necessary remaining complexity

- Redis, the queue processors, scheduler coordination, dedicated migration process, read/write
  database connections and shared object storage are retained for two-API correctness.
- API controllers and services remain separate where controllers own transport/guards and services
  own authorization, transaction or provider rules.
- Raw SQL remains only for PostgreSQL features Prisma cannot express safely, including row locks,
  guarded balance updates and operational metrics.
- Legacy routes and schema fields were not removed where doing so would change a documented HTTP or
  database contract. Dormant subscription sales remain fail-closed rather than being exposed.

## Simplifications deliberately not performed

- No rewrite of the robot-room state hook, gateway handlers, wallet transactions or authentication
  lifecycle was attempted merely to reduce file size.
- No Redis, worker, scheduler, migration, MinIO, LiveKit or proxy component was removed.
- No repository layer was inserted between services and Prisma.
- Audit reports remain dated evidence and were not merged into the current runbook. Current and
  historical documentation are distinguished in `DEVELOPER_GUIDE.md`.

## Measured result

- Repository-visible files decreased from 606 to 566 during this audit. Fifty-two obsolete files
  were removed while focused services, hooks, tests and maintainability documents were added.
- Declared direct dependencies across the workspace decreased by seven net declarations. Every
  remaining static-analysis exception is an executable, framework entry point, generated-client
  requirement, dynamic transport or migration/load fixture with a checked caller.
- The generated browser client removal eliminated the largest duplicated code path. The most
  relevant individual reductions are Health controller 588 to 125 lines, Control Button editor 710
  to 239 lines and dashboard controller hook 1,228 to 950 lines.
- `pnpm audit` reports no known production or development dependency vulnerabilities.
