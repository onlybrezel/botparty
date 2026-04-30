# Changelog

## Unreleased

### Added

- Protected metrics with configurable basic auth and documented scrape setup.
- Added verify-email UX, resend flow, and enforced email verification gates when configured.
- Added signed recording playback URLs, private recordings storage defaults, and direct recording bucket blocking.
- Added dashboard webhooks management UI and a user-facing sessions history page.
- Added webhook SSRF protection, per-operator hard caps, legal/imprint runtime configuration, and Dependabot automation.
- Added SECURITY.md, CONTRIBUTING.md, and an OpenAPI export script.

### Changed

- Tightened nginx/API CSP defaults by removing `unsafe-eval`.
- Centralized cookie consent state with explicit accept/decline handling and settings controls.
- Split public robot overview aggregation and several gateway/frontend hot spots into smaller modules.
