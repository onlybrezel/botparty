# BotParty Platform – Full Audit

> **Audited**: 2026-04-19
> **Repositories**: `botparty` (monorepo), `botparty-client` (Python), `botparty-streamer` (Go)
> **Auditor**: Deep code analysis across all three codebases

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Audit: botparty (Monorepo – API + Web)](#audit-botparty-monorepo--api--web)
3. [Audit: botparty-client (Python Robot Client)](#audit-botparty-client-python-robot-client)
4. [Audit: botparty-streamer (Go Video Publisher)](#audit-botparty-streamer-go-video-publisher)
5. [Cross-Project Concerns](#cross-project-concerns)
6. [Prioritized Action Items](#prioritized-action-items)
7. [Feature Ideas & Vision](#feature-ideas--vision)

---

## Platform Overview

BotParty is a self-hosted robot teleoperation platform. Users connect real robots (via Python client on a Raspberry Pi or similar), stream live video through LiveKit (WebRTC), and let browser viewers take turns driving the robot.

| Component | Tech | Role |
|---|---|---|
| **apps/api** | NestJS 11 + Fastify 5 + PostgreSQL 16 + Redis 7 | REST API, WebSocket gateway, auth, queue, moderation |
| **apps/web** | Next.js 15 + React 19 + Tailwind CSS | Frontend: robot rooms, dashboard, explore, auth pages |
| **packages/prisma** | Prisma ORM | Shared DB schema (13 models, 10 enums) |
| **packages/shared** | TypeScript | Shared Zod schemas, types, constants |
| **botparty-client** | Python 3.10+ | Robot-side: camera, hardware control, TTS, gateway WS |
| **botparty-streamer** | Go 1.24 | High-perf H.264 Annex-B → LiveKit publisher |

---

## Audit: botparty (Monorepo – API + Web)

### 1. Code Quality

| Aspect | Rating | Notes |
|---|---|---|
| TypeScript strictness | ✅ Good | Strict TS with Zod on all inputs |
| Linting | ✅ Good | Shared ESLint config package, Prettier configured |
| Module decomposition | ✅ Good | NestJS modules cleanly separated (auth, robots, gateway, queue, moderation…) |
| Gateway file size | ⚠️ Concern | `bot.gateway.runtime.ts` is **1,234 lines** – the heart of the platform. Already partially decomposed into handler files, but the main file still does too much |
| `robots.service.ts` size | ⚠️ Concern | **1,275 lines**. Delegates to sub-services but the orchestrator is still massive |
| Test coverage | ⚠️ Low | Only a handful of spec files exist: `auth.service.spec.ts`, `robots.service.spec.ts`, `queue.service.spec.ts`, `bot.gateway.spec.ts`, `turn.handler.spec.ts`. Web has `nav.test.tsx`, `robot-card.test.tsx`, `queue-panel.test.tsx`, `dashboard-store.test.ts`. No integration tests for the gateway WS protocol. E2E tests directory exists but is sparse |
| Error handling | ✅ Good | Global `AllExceptionsFilter`, structured error responses |
| Code duplication | ⚠️ Minor | `updateByStaff` and `update` in robots service share ~80% logic |

**Action Items:**
 - [x] **P2** Extract remaining concerns from `bot.gateway.runtime.ts` (guest management, Redis pub/sub handler) into dedicated handler files
 - [x] **P2** Extract `robots.service.ts` into thinner orchestrator + domain sub-services (already started but can go further)
- [ ] **P1** Increase test coverage to ≥70% on API services. Priority: gateway WS integration tests, queue edge cases, moderation enforcement. Current full-suite baseline after this pass: 40.34% statements / 40.58% lines
- [x] **P2** Add web component tests for `controls.tsx`, `chat-panel.tsx`, `robot-page-header.tsx`
- [x] **P3** Deduplicate `update` / `updateByStaff` into a shared internal method

---

### 2. Architecture

| Aspect | Rating | Notes |
|---|---|---|
| Monorepo setup | ✅ Excellent | Turborepo + pnpm workspaces, clean package boundaries |
| Horizontal scaling | ✅ Good | Redis pub/sub for cross-instance WS broadcast with `instanceId` origin filtering |
| Database schema | ✅ Excellent | 13 well-indexed models with proper relations, cascade deletes, audit logs |
| WebSocket gateway | ✅ Good | Per-event Zod validation, per-event + global rate limiting, origin checks |
| Docker networking | ✅ Excellent | Internal bridge for DB/Redis (no external access), frontend bridge for nginx/API |
| Job processing | ✅ Good | BullMQ for async jobs (maintenance, chat persistence batching) |
| State management (Web) | ✅ Good | Zustand stores, clean separation of server/client state |

**Concerns:**
- The gateway now stores active turn state in Redis with local timer ownership on the robot-connected instance. Broadcast and moderation paths are shared across instances, while timer execution still stays local to the robot-connected node for predictable stop behavior.
- No database connection pooling config beyond Prisma defaults in production
- No API versioning strategy beyond the `/api/v1` prefix

**Action Items:**
- [x] **P2** Document horizontal scaling guarantees and limitations (turn state is instance-affine by design; document the affinity model)
- [x] **P3** Consider moving turn state to Redis for true stateless horizontal scaling
- [x] **P3** Add Prisma connection pool tuning (`connection_limit`) to production docs/env

---

### 3. Security

| Aspect | Rating | Notes |
|---|---|---|
| Auth | ✅ Excellent | Argon2id hashing, JWT access (15m) + refresh (7d), token version invalidation |
| Brute force protection | ✅ Excellent | Redis-backed login attempt counter + lockout with email notification |
| Input validation | ✅ Excellent | Zod schemas on all API inputs + WS payloads, `whitelist: true + forbidNonWhitelisted` |
| CORS | ✅ Good | Strict origin list from env, applied to both HTTP and WS |
| CSP | ✅ Good | Helmet with strict CSP directives |
| Secret management | ✅ Good | Startup assertions for JWT/LiveKit secrets with min-length + banned-value checks, file-backed secrets support |
| Rate limiting | ✅ Good | Global ThrottlerGuard + per-event-type WS rate limits with privileged overrides |
| Robot device binding | ✅ Good | Device key hashing + binding + claim lock in Redis |
| Password reset | ✅ Excellent | SHA-256 hashed tokens, one-time use, per-user token invalidation of older resets |
| Profanity filter | ✅ Basic | Slug and robot text moderation with compact-form detection |
| Guest connection limiting | ✅ Good | Per-IP guest socket limit (`MAX_GUEST_SOCKETS_PER_IP = 5`) |

**Concerns:**
- **CSRF protection**: `X-CSRF-Token` is in `allowedHeaders` but no CSRF middleware is visible. Cookie-based auth (refresh token in cookie) without CSRF validation is a risk
- **WebSocket auth**: WS connections authenticate via cookie or inline `accessToken` but the access token has a 15-minute lifetime. Long-lived WS sessions could operate with expired tokens after 15 minutes. No periodic re-auth or token rotation on active WS sockets
- **Swagger in production**: Swagger can be enabled in production via `SWAGGER_DOCS=true` — should be behind additional auth
- **No email rate limiting**: `requestPasswordReset` has no rate limit per email; an attacker could spam reset emails
- **Redis password**: Docker Compose exposes Redis on `127.0.0.1:6379` — safer than `0.0.0.0` but still accessible from localhost

**Action Items:**
- [x] **P1** Implement CSRF token validation middleware for cookie-authenticated endpoints
- [x] **P1** Add per-email rate limiting to password reset endpoint (e.g., max 3 requests per 15 minutes per email)
- [x] **P2** Add periodic JWT re-validation for long-lived WebSocket sessions (check token validity every N minutes, disconnect if expired/revoked)
- [x] **P2** Protect production Swagger behind basic auth or admin role check
- [x] **P3** Add Redis `rename-command` config to disable dangerous commands in production

---

### 4. UX / Usability

| Aspect | Rating | Notes |
|---|---|---|
| Landing page | ✅ Good | Hero section with live stats, featured robots, "how it works" cards, tags |
| Navigation | ✅ Good | Responsive nav with auth-aware links |
| Robot room | ✅ Good | Video player, chat, queue panel, controls, viewer list |
| Dashboard | ✅ Good | Robot management, telemetry, settings |
| Dark/Light mode | ✅ Excellent | CSS custom properties with system preference detection and localStorage persistence |
| SEO | ✅ Excellent | OpenGraph, Twitter cards, sitemap, robots.txt, proper metadata |
| Legal pages | ✅ Good | Terms, Privacy, Cookie notice links in footer |
| Toast system | ✅ Good | Stacked toast notifications |
| PWA | ✅ Good | Service worker registration, web manifest |

**Concerns:**
- **No mobile touch controls**: The control buttons use keyboard hotkeys (WASD/arrows). No virtual joystick or touch-friendly control interface for mobile users
- **No onboarding flow**: New users see the explore page but there's no guided tour showing how to watch/drive a robot
- **No loading skeletons**: Loading states are generic spinners, not content-shaped skeletons
- **No offline/reconnection UX**: When the WS disconnects, the server sends `server:shutdown` but the client-side reconnection UX is unclear (no visible toast/banner for "reconnecting…")
- **No accessibility audit trail**: No ARIA labels visible on interactive controls, no skip-to-content link
- **No embed preview**: The `/embed` route exists but there's no documentation or embed code generator

**Action Items:**
- [x] **P1** Virtual joystick / touch controls for mobile (this is a huge UX gap for the primary use case)
- [x] **P2** Add "reconnecting…" banner/overlay when WebSocket disconnects
- [x] **P2** Skeleton loading states for robot cards and robot room components
- [x] **P2** Add ARIA labels to all control buttons, chat input, queue join button
- [x] **P3** Guided onboarding overlay for first-time viewers ("Click to join queue → Take your turn → Watch the robot move")
- [x] **P3** Embed code generator in dashboard ("Copy embed URL" button for each robot)

---

### 5. Performance

| Aspect | Rating | Notes |
|---|---|---|
| Video latency | ✅ Excellent | <150ms via LiveKit SFU |
| Control latency | ✅ Excellent | <50ms via WS gateway |
| Redis caching | ✅ Good | Robot data cached with 30s TTL, public overview cached |
| DB queries | ✅ Good | Proper indexes on all hot paths (visibility+status, slug, robotId+position) |
| ISR | ✅ Good | `revalidate: 10` on homepage for server-side data |
| Control cooldowns | ✅ Good | Redis-backed cooldown gate with local fallback during Redis outages |
| Presence system | ✅ Good | Redis-backed shared presence with stale entry cleanup |

**Concerns:**
- **No query pagination on chat history**: `getRecentChatMessages` loads up to 200 messages on room join – this is fine now but won't scale
- **`getPublicOverview` N+1 risk**: Loads ALL public robots then filters/groups in memory. Fine for <1000 robots, won't scale beyond
- **Legacy thumbnail migration window**: Existing filesystem thumbnails migrate to object storage on first read or next write after S3/R2 is enabled
- **Metrics logging in streamer**: `runMetricsLogger` logs every 5s which is noisy for production — should be configurable

**Action Items:**
- [x] **P2** Add cursor-based pagination to chat history endpoint
- [x] **P2** Move robot thumbnails to S3/R2 with CDN caching
- [x] **P3** Optimize `getPublicOverview` with SQL aggregation instead of in-memory computation
- [x] **P3** Replace control cooldown `Map` with Redis-based cooldowns for horizontal scaling

---

### 6. Documentation

| Aspect | Rating | Notes |
|---|---|---|
| README | ✅ Excellent | Architecture diagram, project structure, quick start, production deployment guide |
| API docs | ✅ Good | Swagger/OpenAPI with proper tags |
| Inline comments | ✅ Good | Clear section separators, JSDoc on key types |
| Shared package | ⚠️ Missing | `packages/shared/README.md` exists (3KB) but no API reference |
| Deployment docs | ✅ Good | `setup-env.sh` wizard, SSL instructions, systemd examples |

**Action Items:**
- [x] **P3** Generate API client docs from OpenAPI spec
- [x] **P3** Add ADR (Architecture Decision Records) for key design decisions (Fastify over Express, ws over socket.io, queue-based turns, etc.)

---

### 7. Technical Debt

| Item | Severity | Location |
|---|---|---|
| `robots.service.ts` 1275 lines | Medium | `apps/api/src/robots/` |
| `bot.gateway.runtime.ts` 1234 lines | Medium | `apps/api/src/gateway/` |
| Inconsistent indentation in `getPublicOverview` | Low | Line 1006 has extra indent |
| `updateByStaff` duplicates `update` logic | Low | `robots.service.ts` |
| Empty `onModuleDestroy` in `RobotsService` | Low | Line 167-169 |
| No migration for orphaned queue entries cleanup | Medium | Queue entries could pile up if robot deletes don't cascade properly |
| `controlCooldowns` size guard at 4096 | Medium | Emergency cleanup in `consumeControlCooldown` |
| No graceful shutdown for BullMQ workers | Low | `JobsModule` relies on NestJS shutdown hooks but no explicit worker draining |

---

## Audit: botparty-client (Python Robot Client)

### 1. Code Quality

| Aspect | Rating | Notes |
|---|---|---|
| Type annotations | ✅ Good | Strict mypy config, `py.typed` marker |
| Linting | ✅ Good | Ruff configured with comprehensive rule set |
| Architecture | ✅ Excellent | Mixin pattern for client (`ClientLifecycleMixin`, `ClientMediaMixin`, `ClientOpsMixin`, `ClientCommandsMixin`) keeps concerns separated |
| Error handling | ✅ Good | Graceful shutdown with timeout, proper signal handling |
| Legacy compat | ✅ Good | Legacy config migration with deprecation warnings and deadline |
| Test coverage | ⚠️ Low | Only 4 test files: `test_gateway.py`, `test_config_and_commands.py`, `test_hardware_common.py`, `test_client_ops_update.py` |

**Concerns:**
- `client_ops.py` is **27KB / ~750 lines** — the main operational brain of the client
- `publisher.py` is **22KB / 548 lines** — complex ffmpeg process management with fallback logic
- `camera.py` is **20KB** — multi-camera management is complex but well-structured
- No integration tests for the WS gateway connection
- `client.py` constructor is 90 lines — too many responsibilities in `__init__`

**Action Items:**
- [x] **P2** Increase test coverage: gateway reconnection, emergency stop handling, camera fallback paths
- [x] **P2** Extract camera runtime initialization from `BotPartyClient.__init__` into a factory method
- [x] **P3** Add type stubs for optional hardware dependencies (RPi.GPIO, etc.)

---

### 2. Architecture

| Aspect | Rating | Notes |
|---|---|---|
| Plugin system (hardware) | ✅ Excellent | 27 hardware adapter plugins via `BaseHardware` subclassing |
| Video profiles | ✅ Good | Pluggable video backends (opencv, ffmpeg, ffmpeg_libcamera, botparty_streamer) |
| TTS profiles | ✅ Good | Pluggable TTS (espeak, piper, google_cloud, eleven_labs, etc.) |
| Config | ✅ Good | Pydantic-validated YAML config with legacy migration |
| Gateway reconnect | ✅ Good | Exponential backoff with server-directed retry timing |
| Multi-camera | ✅ Good | Multiple cameras with independent publish tokens |
| Device key persistence | ✅ Good | Auto-generated `.botparty-device-key` file |

**Concerns:**
- The client creates a **new `aiohttp.ClientSession`** on every reconnect loop iteration (line 90 in gateway.py). This is wasteful — sessions should be reused
- No health endpoint on the client. Operators can't easily check if the robot client is alive without checking the API
- No OTA update mechanism — `update_client` action is defined but implementation unclear

**Action Items:**
- [x] **P2** Reuse `aiohttp.ClientSession` across reconnect attempts instead of creating new one per loop
- [x] **P2** Add local HTTP health endpoint (e.g., `localhost:9100/health`) reporting gateway/livekit/camera status
- [x] **P3** Implement OTA update flow (pull latest version, restart systemd service)

---

### 3. Security

| Aspect | Rating | Notes |
|---|---|---|
| Claim token handling | ✅ Good | Config file permissions set to 600 |
| Device key | ✅ Good | Auto-generated, persisted, hashed server-side |
| WS auth | ✅ Good | Robot auth token sent via WS claim event (JWT-based) |
| No secrets in logs | ✅ Good | Claim token and auth token not logged |

**Concerns:**
- `config.yaml` contains the claim token in plaintext — no encrypted-at-rest option
- No certificate pinning for the API/WS connection
- `--break-system-packages` install option documented (README line 69) is risky

**Action Items:**
- [x] **P3** Support encrypted config values or env-var overrides for claim_token
- [x] **P3** Remove or add warning to `--break-system-packages` install path in README

---

### 4. Performance

| Aspect | Rating | Notes |
|---|---|---|
| Video pipeline | ✅ Excellent | Direct ffmpeg → LiveKit publish (no re-encoding), hardware codec fallback (h264_v4l2m2m → libx264) |
| CPU monitoring | ✅ Good | `/proc/stat` delta-based CPU sampling, psutil optional |
| Reconnection | ✅ Good | Queue drain on reconnect, planned reconnect with minimal downtime |
| Memory | ✅ Good | Deque-based log buffer with max 400 entries |

---

### 5. Documentation

| Aspect | Rating | Notes |
|---|---|---|
| README | ✅ Good | Quick start, minimal config, doc links |
| Docs directory | ✅ Excellent | 10+ doc files: installation, configuration, client-mixins, multi-camera, hardware adapters, video profiles, TTS, troubleshooting |
| Config example | ✅ Excellent | `config.example.yaml` at 11KB is comprehensive |
| Inline code docs | ✅ Good | Module-level docstrings on all files |

---

## Audit: botparty-streamer (Go Video Publisher)

### 1. Code Quality

| Aspect | Rating | Notes |
|---|---|---|
| Code style | ✅ Excellent | Idiomatic Go, clear function boundaries |
| Error handling | ✅ Good | Results-based error propagation, no panics in hot paths |
| Concurrency | ✅ Excellent | Proper goroutine lifecycle with `context.Context`, atomic counters |
| Test coverage | ⚠️ Low | Only `annexb_reader_test.go` (8.6KB) and `health_test.go` (1KB). No test for `publisher.go` or `config.go` |
| Binary size | ✅ Good | `CGO_ENABLED=0` static builds, cross-platform support |

**Action Items:**
- [x] **P2** Add unit tests for `config.go` (env parsing, validation edge cases)
- [x] **P2** Add integration test for publisher connect/disconnect lifecycle
- [x] **P3** Add benchmarks for `AnnexBReader` and `AccessUnitAssembler`

---

### 2. Architecture

| Aspect | Rating | Notes |
|---|---|---|
| Separation of concerns | ✅ Excellent | ffmpeg = encoder, streamer = publisher, backend = token issuer |
| Low-latency design | ✅ Excellent | Small frame queue (4), stale frame dropping, keyframe waiting on reconnect |
| Token model | ✅ Excellent | Three modes: static token, file-backed token, HTTP endpoint token (fail-closed) |
| Reconnect | ✅ Excellent | Exponential backoff with ±10% jitter, queue drain on session restart |
| Metrics | ✅ Excellent | Prometheus-compatible `/metrics` endpoint with all critical counters |
| SPS/PPS caching | ✅ Excellent | Global cache survives ffmpeg restarts — brilliant for fast recovery |
| Health endpoint | ✅ Good | HTTP health server with optional bearer auth and loopback binding protection |

**Concerns:**
- Single-threaded TCP input server — only one ffmpeg connection at a time (by design, but not documented as a limitation)
- No graceful handling of corrupted/truncated NAL units beyond parse error counting

---

### 3. Security

| Aspect | Rating | Notes |
|---|---|---|
| Input binding | ✅ Excellent | Loopback-only by default, explicit `ALLOW_REMOTE_INPUT=true` required for non-loopback |
| Token management | ✅ Excellent | Fail-closed startup (no token source = exit), no API keys on device |
| Health endpoint | ✅ Good | Optional bearer auth, loopback-only by default |

---

### 4. Documentation

| Aspect | Rating | Notes |
|---|---|---|
| README | ✅ Excellent | 358 lines covering architecture, build, config, ffmpeg examples for 4 platforms, systemd setup, troubleshooting |
| Config reference | ✅ Excellent | All env vars documented with defaults |
| Cross-platform | ✅ Good | Build instructions for Linux AMD64/ARM64, macOS, Windows |

---

## Cross-Project Concerns

### 1. API Contract

| Concern | Notes |
|---|---|
| WebSocket protocol | WS event types shared via `@botparty/shared` constants (`WS_EVENTS`). Python client uses string literals that must match — **no codegen or contract test** between the two |
| REST API types | Web consumes API via fetch with manual `api-types.ts` type definitions — no OpenAPI client generation |
| Versioning | API is at `/api/v1` but no versioning strategy for WS events or client protocol changes |

**Action Items:**
- [x] **P1** Add contract tests: Python client WS event strings must match `WS_EVENTS` constants from shared package
- [x] **P2** Generate TypeScript API client from OpenAPI spec (e.g., `openapi-typescript-codegen` or `zodios`)
- [x] **P2** Define a WS protocol version exchange on `robot:claim` and `room:join` for backward compatibility

### 2. Observability

| Concern | Notes |
|---|---|
| API logging | Fastify/Pino logging with correlation IDs ✅ |
| Sentry integration | Configured but optional (`.env.example` shows it commented out) |
| OpenTelemetry | `tracing.ts` exists — tracing is initialized on startup |
| Streamer metrics | Prometheus-compatible `/metrics` endpoint ✅ |
| Client metrics | Telemetry sent to API via WS, but no local metrics endpoint |
| No centralized dashboard | No Grafana/dashboard setup for correlating API + streamer + client metrics |

**Action Items:**
- [x] **P2** Create a Grafana dashboard template (or equivalent) that combines API health, streamer metrics, and robot telemetry
- [x] **P3** Add OpenTelemetry instrumentation to Prisma queries

### 3. CI/CD

| Concern | Notes |
|---|---|
| GitHub Actions | `.github/` directories exist in all three repos but workflows not audited |
| Release process | `botparty-streamer` has `cur_ver` file and `--version` flag; monorepo is `0.1.0`; client is `0.1.3` — no unified versioning |
| No automated security scanning | No Dependabot, Snyk, or CodeQL visible |

**Action Items:**
- [x] **P1** Enable Dependabot or Renovate on all three repositories
- [x] **P2** Add CodeQL / SAST scanning to CI pipelines
- [x] **P3** Unify version numbering or adopt CalVer

---

## Prioritized Action Items

### P1 – Critical (should tackle first)

| # | Area | Action | Repo | Est. Effort |
|---|---|---|---|---|
| 1 | Security | Implement CSRF token validation for cookie-authenticated endpoints | `botparty` | 4h |
| 2 | Security | Add per-email rate limiting to password reset endpoint | `botparty` | 2h |
| 3 | Testing | Increase API test coverage to ≥70% (gateway WS integration tests, queue edge cases) | `botparty` | 2-3d |
| 4 | Contracts | Add WS protocol contract tests between Python client and shared package | all | 4h |
| 5 | UX | Virtual joystick / touch controls for mobile | `botparty` | 1-2d |
| 6 | CI/CD | Enable Dependabot/Renovate on all repos | all | 1h |

### P2 – Important (major quality improvements)

| # | Area | Action | Repo | Est. Effort |
|---|---|---|---|---|
| 7 | Code Quality | Decompose `bot.gateway.runtime.ts` further (guest mgmt, Redis handler) | `botparty` | 4h |
| 8 | Code Quality | Thin out `robots.service.ts` orchestrator | `botparty` | 3h |
| 9 | Security | Periodic JWT re-validation for long-lived WS sessions | `botparty` | 3h |
| 10 | Security | Protect production Swagger behind auth | `botparty` | 1h |
| 11 | UX | "Reconnecting…" banner/overlay for WS disconnect | `botparty` | 2h |
| 12 | UX | Skeleton loading states for robot cards and room | `botparty` | 3h |
| 13 | UX | ARIA labels for all interactive controls | `botparty` | 2h |
| 14 | Performance | Move thumbnails to S3/R2 with CDN | `botparty` | 4h |
| 15 | Performance | Cursor-based chat pagination | `botparty` | 2h |
| 16 | Architecture | Generate TS API client from OpenAPI spec | `botparty` | 2h |
| 17 | Architecture | WS protocol versioning on claim/join | `botparty` + `client` | 3h |
| 18 | Client | Reuse `aiohttp.ClientSession` in gateway reconnect loop | `botparty-client` | 1h |
| 19 | Client | Add local HTTP health endpoint to Python client | `botparty-client` | 2h |
| 20 | Client | Increase test coverage (gateway reconnect, estop, camera fallback) | `botparty-client` | 1d |
| 21 | Streamer | Add config.go unit tests | `botparty-streamer` | 2h |
| 22 | Observability | Create Grafana dashboard template | all | 4h |
| 23 | CI/CD | Add CodeQL / SAST scanning | all | 2h |
| 24 | Docs | Document horizontal scaling model and limitations | `botparty` | 2h |
| 25 | Testing | Add web component tests (controls, chat, header) | `botparty` | 4h |

### P3 – Nice to Have (polish & future)

| # | Area | Action | Repo | Est. Effort |
|---|---|---|---|---|
| 26 | Code Quality | Deduplicate `update` / `updateByStaff` | `botparty` | 1h |
| 27 | Architecture | Move turn state to Redis for stateless horizontal scaling | `botparty` | 1d |
| 28 | Performance | Optimize `getPublicOverview` with SQL aggregation | `botparty` | 3h |
| 29 | Performance | Redis-based control cooldowns for horizontal scaling | `botparty` | 3h |
| 30 | Security | Redis `rename-command` hardening | `botparty` | 30m |
| 31 | UX | Onboarding overlay for first-time viewers | `botparty` | 4h |
| 32 | UX | Embed code generator in dashboard | `botparty` | 2h |
| 33 | Docs | ADR documents for key architecture decisions | `botparty` | 2h |
| 34 | Docs | Generate API client docs from OpenAPI | `botparty` | 1h |
| 35 | Client | Encrypted config values | `botparty-client` | 3h |
| 36 | Client | OTA update flow | `botparty-client` | 1d |
| 37 | Client | Type stubs for optional hardware deps | `botparty-client` | 2h |
| 38 | Streamer | AnnexBReader + AU assembler benchmarks | `botparty-streamer` | 2h |
| 39 | CI/CD | Unified version numbering or CalVer | all | 2h |
| 40 | Observability | OpenTelemetry on Prisma queries | `botparty` | 2h |

---

## Feature Ideas & Vision

### 🔥 High-Impact Features

#### 1. **Session Recording & Replay** (partially schemaed)
The database already has `SessionStatus.RECORDING`, `recordingUrl`, and LiveKit egress is deployed. Wire up:
- Dashboard toggle for "Record sessions"
- Automatic egress start/stop on session lifecycle
- Replay viewer: timeline scrubber, control command overlay, chat replay
- **Clip sharing**: Let viewers clip the last 30s and share as a link/GIF

#### 2. **Mobile Touch Controls / Virtual Joystick**
This is the #1 UX gap. Implement:
- Dual-stick controller (left = movement, right = camera/look)
- D-pad mode for simpler robots
- Swipe gestures for quick actions
- Haptic feedback on button press (vibration API)
- Portrait and landscape support

#### 3. **Spectator "Crowd Control" Mode**
Let viewers vote on the next action when no one is in the queue:
- "Should the robot go left or right?" Poll with countdown
- Most-voted command executes automatically
- Twitch Plays Pokémon style chaos mode as a room setting
- Configurable: only for VOTING queue mode, host can enable/disable

#### 4. **Robot Battles / PvP Arena**
The schema has `TransactionType.BATTLE_ENTRY`:
- Two robots enter a virtual arena (split-screen view)
- Each controller drives their robot
- Judges or crowd votes on winner
- Credit wagering on outcomes
- Tournament bracket system with scheduled rounds

#### 5. **Analytics Dashboard for Robot Hosts**
The schema has `AnalyticsEvent` already:
- Viewer count over time (line chart)
- Session duration distribution
- Peak hours heatmap
- Control command frequency breakdown
- Geographic viewer distribution (from IP geolocation)
- "Your robot was featured X times" stats

#### 6. **Leaderboard & Community Features**
- "Most-driven robot" leaderboard
- "Top drivers" (most sessions, longest turns)
- Achievement badges: "First Drive", "Night Owl", "Marathon Driver"
- User profiles with driving history
- Robot "followers" — get notified when a robot goes online

### 🚀 Medium-Impact Features

#### 7. **AI Co-Pilot / Autopilot**
`aiAssistEnabled` on Robot schema exists:
- AI vision module that suggests safe paths
- "AI Assist" mode: AI prevents collisions while human steers direction
- Autonomous return-to-dock when battery low
- Object detection overlay on video stream (bounding boxes)
- Voice commands via browser mic → transcription → command mapping

#### 8. **Multi-Camera Picture-in-Picture**
The multi-camera system is built (`cameras` in metadata, multi-token publish):
- Main view + PiP for rear/arm camera
- Viewer can switch between cameras
- "Director mode" for the host: toggle which camera is primary
- Split-screen view option

#### 9. **Text-to-Speech from Chat**
TTS profiles exist in botparty-client (espeak, piper, Google Cloud, ElevenLabs):
- Chat messages spoken aloud through robot's speaker
- Configurable: all messages, only controller's messages, or @mentions
- Profanity filter before TTS
- Crowd favorite: funny robot voice reading chat

#### 10. **Credit Economy & Priority Queue**
Schema has `Transaction`, `balance`, `credits`, `PRIORITY_QUEUE`:
- Earn credits by watching (1 credit/minute viewing)
- Spend credits for priority queue skip
- "Boost" a robot to featured for X hours
- Virtual tips to robot hosts
- Daily login bonus
- Future: Stripe integration for credit purchase

#### 11. **Scheduled Events**
`scheduleStart`, `scheduleEnd`, `timezone` already on Robot:
- Calendar view of upcoming robot sessions
- "Remind me" button → email/push notification
- Recurring schedules ("Every Saturday 2-4pm")
- Event countdown widget on robot card

#### 12. **Custom Control Layouts**
`ControlButton` is already dynamic with position, icon, color:
- Drag-and-drop button layout editor in dashboard
- Joystick zones, sliders (for servo speed), toggles (for lights/horn)
- Custom button groups ("Arm Controls", "Drive", "Fun Actions")
- Import/export control layouts as presets
- Touch-area heatmap analytics

### 💡 Creative & Fun Ideas

#### 13. **Robot Reactions / Emotes**
- Viewers send emoji reactions that pop up as overlays on the video
- Physical reactions: robot LED strips flash patterns, horn honks, pre-programmed dance macros
- "Cheer" button that triggers a confetti effect on stream

#### 14. **Sound Board**
- Grid of pre-loaded sound effects (honk, applause, dramatic music)
- Plays through robot speaker
- Configurable per-robot by host
- Cooldown per user

#### 15. **Robot "Personality" System**
- Each robot gets a generated personality (friendly, sarcastic, shy)
- AI-generated responses to chat messages in-character
- Auto-generated robot bio from driving history

#### 16. **Mini-Games / Challenges**
- "Drive through the maze" — host places obstacles, viewer tries to navigate
- Time trials with leaderboard
- "Find the hidden object" — host hides something, driver searches
- Cooperative challenges: two viewers control one robot (one does movement, one does arm)

#### 17. **Swarm Mode**
`SwarmGroup` model exists in schema:
- Link multiple robots into a swarm
- One controller drives all robots simultaneously
- Formation driving patterns
- Swarm view: tiled video of all robots

#### 18. **ROS2 Integration**
`ros2Enabled` flag on Robot schema:
- Bridge BotParty commands to ROS2 topics
- `/cmd_vel` Twist messages from control commands
- Sensor data visualization overlay (LIDAR, IMU)
- Navigation stack integration: "Go to waypoint A"

#### 19. **Stream Overlay System**
- Configurable overlays for the video stream: robot name, viewer count, current driver, queue position
- Custom CSS/HTML overlay editor in dashboard
- Sponsor logo placement
- Real-time telemetry overlay (CPU temp, battery %, signal strength)

#### 20. **Robot Discovery Map**
- World map showing all online robots with geographic pins
- Click a pin → preview thumbnail → "Join room"
- Filter by tag, queue length, viewer count
- "Robots near me" for local maker spaces / schools

#### 21. **Webhook / Integration System** (partially built)
`RobotWebhook` model exists with URL, HMAC secret, event filtering:
- Discord/Slack notifications: "Robot X just went online!"
- IFTTT integration: "When robot goes online → turn on hallway lights"
- Custom automation: "When viewer count > 10 → switch to wide-angle camera"
- Home Assistant integration for smart home robots

#### 22. **Instant Replays**
- "Instant Replay" button that plays back the last 10 seconds in slow motion
- Auto-detect "exciting moments" (rapid control inputs, emergency stops)
- Share replays as short clips

#### 23. **Screen Sharing / Whiteboard**
- Host can share a whiteboard alongside the robot video
- Draw instructions for the driver ("turn here", "avoid the table")
- AR-style annotations on the video feed

#### 24. **Robot Training Mode**
- Record a sequence of commands as a "macro"
- Replay macros for automated tasks
- Teach-by-demonstration: drive the robot through a task, save the path
- Edit macros in a visual timeline editor

#### 25. **Watch Party / Theater Mode**
- Multiple viewers watch the same recorded session together
- Synchronized playback with live chat
- Commentary track from the host

---

## Summary

The BotParty platform is well-architected with strong security fundamentals, excellent separation of concerns across the three repos, and production-ready infrastructure (Docker networking, secret management, health checks). The main gaps are:

1. **Test coverage** — the single biggest risk across all three repos
2. **Mobile UX** — no touch controls is the #1 user-facing gap
3. **CSRF protection** — the most urgent security gap
4. **Contract testing** — WS protocol isn't tested across the Python/TypeScript boundary

The codebase is clean, well-documented, and ready for the next phase of features. The schema already anticipates many future features (analytics, credits, battles, swarms, scheduling, webhooks), making the platform well-positioned for growth.
