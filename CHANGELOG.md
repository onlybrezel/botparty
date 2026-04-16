# Changelog

All notable changes to BotParty are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- Self-service account deletion endpoint (`DELETE /api/v1/users/me`) for GDPR compliance
- Global NestJS exception filter — unhandled errors no longer leak stack traces in production
- Account lockout after 10 failed login attempts (15-minute cooldown, Redis-backed)
- `ChatMessage` userId database index for faster user history queries
- Nginx healthcheck in Docker Compose
- Custom 404 page (`/not-found.tsx`)
- `robots.txt` and `sitemap.xml` generation via Next.js App Router
- CONTRIBUTING.md with developer guidelines

### Changed
- Content-Security-Policy re-enabled (was disabled via `contentSecurityPolicy: false`)
- Robot JWT now defaults to 30-day expiry when `ROBOT_JWT_EXPIRES_IN` is not set
- `ValidationPipe` now rejects unknown fields (`forbidNonWhitelisted: true`)
- CORS origin list is now trimmed and filtered to prevent whitespace issues
- Node.js engine requirement lowered to `>=22.0.0` (was `>=24.0.0`)
- LiveKit Docker images pinned to versioned releases (`v1.8`, `v1.4`, `v1.8`)
- Recordings volume mount changed from `:ro` to rw in API container (enables deletion via mod dashboard)
- Homepage and leaderboard switched from `force-dynamic` to ISR (`revalidate: 10`)
- Guest session IDs now use `crypto.randomUUID()` instead of `Math.random()`
- Viewer token retry now uses exponential backoff (up to 30s)
- Gateway reconnect backoff now includes jitter to prevent thundering herd
- `psutil` import moved from hot telemetry path to module init time

### Fixed
- `void username` pattern removed from `findByUsernameAndSlug` and `findPrivateByUsernameAndSlugForUser`
- Duplicate try/catch in `getLogs()` controller removed
- `body as never` casts replaced with proper `CreateRobotInput` / `UpdateRobotInput` types
- `policyCache` and `enabledButtonsCache` now sweep expired entries every 60 seconds

### Security
- `.env.bak` removed from git tracking and added to `.gitignore`
- Account lockout protection added to login endpoint
