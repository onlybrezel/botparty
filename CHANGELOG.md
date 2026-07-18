# Changelog

All notable operator-facing changes are recorded here. Releases use semantic version tags and link this file from the GitHub release description.

## Unreleased

### Added

- Durable notifications for queue turns, robot state, and financial events with in-app, browser, email, quiet-hour, retry, and preference handling.
- Consent-gated first-party product analytics, funnel dashboard, immediate withdrawal deletion, and retention enforcement.
- Host go-live checklist covering robot connection, video, control, emergency-stop verification, schedule, access policy, and moderation readiness.
- Full account export, wallet reconciliation views, filters, and CSV export.
- Prometheus/Alertmanager configuration, dependency-aware readiness, restore drill reporting, queue benchmark, web bundle budgets, and Lighthouse gates.
- Consent-gated field Web Vitals with p75 reporting, route request budgets, and visibility-aware polling limits.

### Changed

- Active turns now use Redis leases and fencing tokens across API replicas.
- Billing, donations, payouts, and paid controls are fail-closed and use atomic idempotent ledger transitions.
- Robot, LiveKit, email, stream, and webhook credentials are hashed or AEAD-encrypted and revocable.
- Multi-camera playback uses LiveKit adaptive streaming, dynacast, and demand-based quality.
- Public routes no longer prefetch unrelated route bundles; card and staff animations use lightweight CSS instead of a shared animation runtime.
- Explore and Login use static rendering on their core routes; filtered discovery remains server-rendered on a dedicated, backward-compatible search route.
- Offline and maintenance rooms use a lightweight server-rendered view; live room controls and video initialize only for connected robots.
- Dashboard diagnostics use visibility-aware, non-overlapping polling and clear stale robot context between selections.
- Account deletion anonymizes identity while preserving required financial records.

### Security

- Global CSRF enforcement, database-backed access-token validation, redirect-safe webhook delivery, login lockout isolation, strict CSP, and payment-only raw-body capture.
- Production startup now validates required secrets, legal operator data, SMTP, public HTTPS/WSS URLs, provider groups, and feature flags.

### Removed

- Unconfigured Sentry hooks and the inactive service worker.
- Subscription endpoints and unsupported latency, refund, subscription, and automatic-safety claims.
