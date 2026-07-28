# Changelog

All notable operator-facing changes are recorded here. Releases use semantic version tags and link this file from the GitHub release description.

## Unreleased

### Changed
- Replaced MinIO with SeaweedFS mini (S3-compatible) for object storage. Thumbnails and LiveKit recordings use private buckets on `seaweedfs:8333`. Public `/storage/` remains blocked; media is served only through authorized API streams. Backup/restore and readiness checks use the S3 API instead of MinIO-specific health endpoints.

## Unreleased

### Added

- Durable notifications for queue turns, robot state, and financial events with in-app, browser, email, quiet-hour, retry, and preference handling.
- Consent-gated first-party product analytics, funnel dashboard, immediate withdrawal deletion, and retention enforcement.
- Host go-live checklist covering robot connection, video, control, emergency-stop verification, schedule, access policy, and moderation readiness.
- Full account export, wallet reconciliation views, filters, and CSV export.
- Prometheus/Alertmanager configuration, dependency-aware readiness, restore drill reporting, queue benchmark, web bundle budgets, and Lighthouse gates.
- Consent-gated field Web Vitals with p75 reporting, route request budgets, and visibility-aware polling limits.
- A public-production preflight for TLS, pinned image versions, host secret files, external review references, Compose rendering, and high-risk feature activation.
- Cross-browser functional, accessibility, responsive, visual-regression, and active API-failover coverage for the complete frontend route set.

### Changed

- Active turns now use Redis leases and fencing tokens across API replicas.
- Billing, donations, payouts, and paid controls are fail-closed and use atomic idempotent ledger transitions.
- Robot, LiveKit, email, stream, and webhook credentials are hashed or AEAD-encrypted and revocable.
- Multi-camera playback uses LiveKit adaptive streaming, dynacast, and demand-based quality.
- Public routes no longer prefetch unrelated route bundles; card and staff animations use lightweight CSS instead of a shared animation runtime.
- Explore and Login use static rendering on their core routes; filtered discovery remains server-rendered on a dedicated, backward-compatible search route.
- Offline and maintenance rooms use a lightweight server-rendered view; live room controls and video initialize only for connected robots.
- Dashboard diagnostics use visibility-aware, non-overlapping polling and clear stale robot context between selections.
- Background polling pauses while offline and resumes on reconnect; completed auth navigations no
  longer carry cancelled prefetches into the next workflow.
- Confirmed staff account edits update the visible row immediately instead of waiting for unrelated
  runtime and container telemetry refreshes.
- Account deletion anonymizes identity while preserving required financial records.
- Navigation, dashboard, staff, settings, session, wallet, room, form, error, empty, mobile, and zoom layouts now use clearer hierarchy and responsive action grouping without removing functions.
- Release publishing accepts only SemVer tags reachable from `main`, repeats quality and migration gates, and waits on the `production-release` environment.

### Security

- Global CSRF enforcement, database-backed access-token validation, redirect-safe webhook delivery, login lockout isolation, strict CSP, and payment-only raw-body capture.
- Production startup now validates required secrets, legal operator data, SMTP, public HTTPS/WSS URLs, provider groups, and feature flags.
- Public operational starts now require recorded legal, privacy, restore, and alerting acceptance; live billing, payouts, and paid controls require capability-specific evidence.
- Authentication mutations are never transmitted without a successfully parsed CSRF token, including
  when a canonical page redirect interrupts the initial session bootstrap.
- Valid CSRF cookies remain stable across browser tabs, malformed values are replaced, and local
  authentication mutations use an explicit same-origin transport mode.
- The theme bootstrap no longer mutates transient DOM state before React hydration.

### Removed

- Unconfigured Sentry hooks and the inactive service worker.
- Subscription endpoints and unsupported latency, refund, subscription, and automatic-safety claims.
