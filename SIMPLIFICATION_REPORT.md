# Simplification Report

Stand: 18.07.2026.

## Implemented changes

| Area                 | Before                                                               | After                                                             |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Browser API client   | Handwritten client plus 38 unused generated files                    | One runtime client under `apps/web/src/lib/api/`                  |
| Robot types          | Types exported from `RobotsService`; three camera descriptor copies  | One dependency-free `robots.types.ts`                             |
| Nest modules         | Robots/Queue/LiveKit connected with `forwardRef`                     | Acyclic `LiveKit -> Queue -> Robots` ownership                    |
| Health               | 588-line controller with eight constructor dependencies              | 125-line HTTP controller, dependency service, metrics service     |
| Control editor       | 710-line component with duplicated create/edit fields                | 239-line flow plus one 271-line shared field component            |
| Dashboard hook       | 1,228 lines including thumbnail browser/media lifecycle              | 950-line controller plus a 290-line thumbnail hook                |
| Browser artifacts    | Tracked `test-results/.last-run.json`                                | Runner output ignored and untracked                               |
| ADRs                 | Duplicate WebSocket records and an out-of-repository Python decision | Eight consistently named, repository-owned decisions              |
| ESLint               | Two FlatCompat wrappers around a legacy shared config                | One native shared Flat Config; no disabled project rules          |
| Multi-instance check | Placeholder unit test and an unintegrated stale k6 draft             | Real two-replica Docker E2E plus bounded proxy distribution probe |

Removed direct dependencies:

- root: `openapi-typescript-codegen`;
- API: `@fastify/csrf-protection`, `@fastify/rate-limit`, redundant `@fastify/cors`, unused optional
  `@fastify/static`, redundant `pino`, `uuid` and `@types/uuid`;
- Web: redundant direct `zod` and `puppeteer-core` declarations;
- shared lint config: unused `eslint-plugin-prettier`.

The apps now declare their ESLint runner/config directly and Web declares its PostCSS build tool.
This corrects reliance on transitively hoisted packages. Including those corrections, the workspace
contains seven fewer direct dependency declarations than at audit start.

Removed production-source files:

- generated OpenAPI TypeScript client directory (38 files) and its generator;
- unused `apps/api/src/app.module.ts` compatibility re-export;
- unused billing/user DTO files superseded by active Zod schemas;
- unused subscription plan builder;
- unreferenced locale switcher and its commented render sites;
- obsolete OpenAPI HTTP fetch helper and stale k6 WebSocket draft;
- placeholder cross-instance test containing only unconditional assertions;
- three obsolete/duplicate ADR files.

## Behavior protection

Public HTTP paths, status codes, error shapes, role behavior, owner isolation, database semantics,
environment names, migrations and Docker service contracts were preserved. The Subscription plans
endpoint remains fail-closed. The OpenAPI JSON and human-readable API reference remain generated and
checked in CI.

A characterization test was added before consolidating the Control Button editor. It verifies that
create and edit drafts expose the same fields, remain independent and preserve cancellation state.
A module-boundary regression test verifies that LiveKit owns its JWT dependency after removal of the
Nest module cycle. Existing robot, access, queue, LiveKit, health, dashboard, storage and end-to-end
tests protect the other refactorings.

## Verification completed during refactoring

- API lint and typecheck after each backend boundary change;
- 77 robot/access/camera/action-queue tests after the domain-type extraction;
- 7 health/readiness/metrics tests after the Health split;
- 89 queue/LiveKit/camera/gateway tests after removing module cycles;
- Web lint, typecheck and architecture budget after each UI extraction;
- all 33 Web test files, 109 tests, after dashboard and control-editor changes;
- relative-import cycle scan: zero cycles in API, Web and shared source trees.

## Final fresh verification

- frozen pnpm installation: passed;
- workspace lint: passed with zero errors and zero warnings;
- workspace typecheck: four tasks passed;
- API: 65 suites and 608 tests passed, including real PostgreSQL/Redis Testcontainers tests;
- Web: 33 files and 109 tests passed;
- production Web build and all seven route bundle budgets: passed;
- architecture module-size policy and relative-import cycle scan: passed, zero cycles;
- production Docker E2E: images rebuilt, fresh volumes, 12 migrations, seed, two API replicas and
  two Web replicas healthy; 21 Playwright tests passed;
- proxy distribution probe: 20/20 HTTP 200 responses, ten from each API instance, p50 7.77 ms,
  p95 63.38 ms and p99/max 91.55 ms;
- isolated Development Compose smoke: fresh migration, API/Web startup and both hot-reload probes
  passed;
- fresh and legacy migration verification, backup URL/cryptography checks, file-secret smoke and
  environment parity for 170 variables: passed;
- production and complete dependency audits: no known vulnerabilities;
- OpenAPI export, API documentation generation, dependency-entry analysis and `git diff --check`:
  passed.

No Docker service was removed. PostgreSQL, Redis, MinIO, LiveKit, the proxy, the dedicated migration
job and observability services all have current runtime or operational responsibilities.

Measured from audit start, repository-visible files decreased from 606 to 566. Fifty-two files were
removed; smaller focused modules and the required audit/guide documents account for the additions.

## Remaining maintainability risks

- `use-robot-view-state.ts` remains the largest coupled frontend workflow. Refactor only with a
  state-machine-level characterization suite for access, reconnect, queue and turn ordering.
- Dashboard, LiveKit, Auth, Robots and Wallet modules remain large. Their next reductions should
  follow concrete feature boundaries, not line-count targets.
- The fail-closed subscription schema/provider compatibility path is dormant. Removing its database
  fields or webhook compatibility requires an explicit contract/deprecation decision.
- Compose intentionally retains single PostgreSQL, Redis, MinIO, Nginx and LiveKit instances. This
  is an availability limitation, not removable application complexity.
- Knip cannot infer string-loaded transports/CLIs, framework source entries, Prisma generation or
  shell/Compose callers. Each reported file and package in those categories was manually traced;
  no unowned application dependency remains.

Do not add another browser API client, generic repository layer, provider registry, state-management
system or workflow engine without at least two current use cases and a measurable reduction in
coupling.
