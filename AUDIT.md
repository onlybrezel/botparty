# AUDIT.md

> Stand: 2026-04-30 · Audit auf Basis des Repository-Stands `onlybrezel/botparty`
> auf Branch `main`. Es wurden ausschließlich Quelldateien, Konfiguration,
> Migrations, Docker-Setup, CI-Definitionen und Doku-Bestände gelesen.
> Keine Codeänderungen, keine Build- oder Testläufe als Teil dieses Audits.

---

## 1. Executive Summary

BotParty ist eine bemerkenswert weit entwickelte, real-time orientierte
Self-Hosted Robot-Teleoperations-Plattform (NestJS 11 / Fastify 5 / Next.js 15 /
LiveKit / Postgres 16 / Redis 7 / Prisma / BullMQ). Die Architektur ist sauber
geschnitten in API, Web, Shared, Prisma. Der Funktionsumfang reicht
erstaunlich weit: Auth (JWT + Refresh, Argon2id, Email-Verify, Lockout, Reset),
RBAC, WebSocket-Gateway mit Handler-Trennung, Queue, Chat (Soft-Delete + Audit),
Moderation (Timeout/Kick/Ban inkl. Audit-Log), LiveKit-Token + Egress (Recording
nach S3/MinIO), Webhooks pro Robot inkl. SSRF-Schutz, Wallet/Credits,
Stripe + PayPal Billing mit idempotentem Webhook-Ledger, Donations, Payout
Requests, Sentry-Hooks, OpenTelemetry, Prom-Metriken, cAdvisor, Loki/Promtail
(Profile), strukturiertes Logging via Fastify/Pino, Cookie-Banner, Privacy/
Imprint/Terms-Seiten mit Runtime-Konfiguration, Service Worker, OG-Bilder,
Daten-Export.

**Wichtigste Risiken**

1. **CSP weicht zwischen den drei Layern (Helmet, nginx, Next.js) auseinander**
   und enthält in zwei davon `'unsafe-inline'`/`'unsafe-eval'`. Die
   strikteren Werte aus dem Helmet-Setup werden auf der HTML-Antwort durch
   die Next.js-Header überschrieben.
2. **Bezahlumgebung produktiv schaltbar ohne dokumentierte ENV** — die Stripe-
   und PayPal-Schlüssel (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `PAYPAL_*`) tauchen in `.env.example` nicht auf. Das macht Misskonfiguration
   sehr wahrscheinlich (z. B. Webhooks ohne Signaturprüfung scheitern leise
   bzw. Sandbox-Defaults gehen live).
3. **Riesige Service-/Helper-Dateien** (z. B. `moderation.service.ts` 992 LOC,
   `runtime-telemetry.service.ts` 804 LOC, `gateway-runtime.support.ts`
   558 LOC, `robots.controller.ts` 587 LOC) — Wartungs- und Review-Risiko,
   testtechnisch schwer zu isolieren.
4. **Legal-Konfiguration ist Pflicht im Production-Build, aber für ein
   Public-Release nur teilweise abgesichert** (Privacy-Inhalte sind generisch,
   konkrete Datenflussbeschreibung fehlt teilweise).
5. **CI baut ausdrücklich gegen Node 22, Repo & Docker-Image laufen auf
   Node 24.** Diskrepanz erhöht das Risiko unentdeckter Versionsregressionen.

**Größte Chancen**

- Sehr starke Grundsubstanz an Tests (≈ 41 API-Specs, 15 Web-Tests, Playwright,
  OpenAPI-Drift-Check). Mit fokussierter Investition in E2E + Lasttests wird
  das Projekt schnell release-fest.
- Klare Architektur (Handler pro WS-Verantwortung, Idempotency-Keys, Audit-
  Logs, ADR-Verzeichnis). Refactoring-Schmerz ist überschaubar.
- Sehr gute Operator-Story (`setup-env.sh`, Compose-only Deploy, Healthchecks,
  Secrets via File-Mount).

**Release-Reife (grobe Einschätzung)**

- Self-Hosted-Beta für technische Operator: **realistisch nahe**.
- Public/Commercial-Release inkl. Bezahlung, Moderation-SLAs, Datenschutz und
  Skalierung über einen Knoten hinaus: **noch nicht**. Zentrale Blocker sind
  Security-Headers, Bezahlflows-Härtung, Lasttests, GDPR-Datenfluss-Doku und
  saubere Mehrinstanz-Validierung des Gateways (instanz-affines Active-Turn-
  Modell ist dokumentiert, aber Cross-Instance-Verhalten unter Last ist nicht
  belegt).

**Empfohlene Prioritäten**

1. Security-Header und CSP konsolidieren (P0).
2. Bezahlpfade (`STRIPE_*`/`PAYPAL_*`) dokumentieren, in `.env.example`
   ergänzen, Boot-Validierung wenn aktiviert (P0).
3. Doku „Production-Checkliste" + Datenschutz-Datenflussbeschreibung (P1).
4. Refactor der Riesen-Services + ergänzende Tests (P2).
5. Release-Pipeline + Migrationsprozess für Prod (P1).

---

## 2. Projektüberblick

### Erkannte Technologien

- **Sprache/Build**: TypeScript ≥ 5.7, pnpm 9.15.4 Workspaces, Turborepo, Node 24.
- **Backend**: NestJS 11 auf Fastify 5 (`@nestjs/platform-fastify`),
  `@nestjs/platform-ws` (kein Socket.IO), Throttler-Guard global, Helmet,
  Swagger (Basic-Auth schützbar), BullMQ, Pino/Fastify-Logger, OpenTelemetry,
  Sentry-Init optional.
- **Frontend**: Next.js 15 App Router, React 19, Tailwind v4, Zustand,
  livekit-client + `@livekit/components-react`, Framer Motion, Lucide Icons.
- **Auth**: JWT Access (default 15 min) + Refresh (default 7 d) inkl.
  Server-side Refresh-Rotation per Lua-CAS in Redis, Argon2id Hashing,
  optionaler E-Mail-Verify-Gate, Lockout nach 10 Fehlversuchen, CSRF-Origin-
  Guard, Same-Site Cookies + getrennter CSRF-Cookie, Rate-Limit pro Benutzer.
- **Realtime**: LiveKit SFU (Video, Recording via Egress), eigener WS-Gateway
  für Steuer-/Chat-/Queue-Events (`/ws`).
- **Datenhaltung**: PostgreSQL 16 + Prisma; Redis 7 für Pub/Sub, Lockout,
  Refresh-State, Active-Turn-State, Idempotency, Rate-Limits; MinIO/S3 für
  Recordings & Thumbnails (mit Lifecycle-Regeln über `mc ilm`).
- **Externe Services**: Stripe + PayPal (provider-agnostische Schnittstelle),
  SMTP-Mailer, optional Sentry, optional Loki/Promtail (Profil), cAdvisor.
- **Robot-Client**: separates Repository `botparty-client` (Python). Im
  Hauptrepo nur als externer Vertrag (Claim-Token, Webhooks, Gateway-
  Protocol, Telemetry-Payload).

### Architektur

```
Browser ── nginx ──┬── Next.js (web)
                   ├── NestJS API (Fastify) ── Postgres / Redis / MinIO
                   ├── /ws → NestJS WS-Gateway (eigene Handler-Klassen)
                   └── /rtc → LiveKit SFU (+ Ingress / Egress)
Robot-Client (extern) ── Gateway WS + LiveKit WHIP-Ingress
```

### Frontend-Struktur

App Router mit Routen für Marketing/Home, Explore, Dashboard, Robot
(`/robot/[slug]`, `/robot/[username]/[slug]`, Catchall), Sessions, Settings,
Wallet, Mod (inkl. Payouts), Embed, Status, Leaderboard, Docs (Controller-
Doku), legal (Imprint/Privacy/Terms/Cookies), Auth (Login/Reset/Verify).
Komponenten sind sinnvoll segmentiert (`components/dashboard`, `robot-view`,
`livekit`, `mod`, `ui`). Theme-Bootstrap inline im Root-Layout. Cookie-Banner
mit explizitem Accept/Decline, Preferences via Zustand-persist.

### Backend-Struktur

NestJS-Module: `auth`, `users`, `robots`, `sessions`, `queue`, `livekit`,
`gateway`, `health`, `controls`, `moderation`, `mail`, `maintenance`, `wallet`,
`billing`, `earnings`, `prisma`, `redis`, `jobs`, `bootstrap`. WS-Gateway ist
in dedizierte Handler aufgeteilt (Room/Turn/Chat/Control/RobotRuntime/
Moderation-Enforcer/Redis-PubSub/Robot-Claim-Lock/Presence). Recordings, S3,
SMTP, Webhooks und Telemetry haben eigene Services. Audit-Log und Idempotenz
für Wallet/Webhook-Events sind als eigene Tabellen modelliert.

### Datenmodell (Prisma)

23 Modelle inkl. RBAC (`Role`), Robot-Lifecycle, Queue, Chat (Soft-Delete +
Deletor), Sessions, Recording-Egress-Verknüpfung implizit per
`recordingUrl`, Transactions (Ledger mit `ledgerGroupId`-Saldo 0),
BillingIntents + WebhookEvents (idempotent), WalletIdempotencyKey,
PayoutRequests, ControlButton, RobotModerationEntry, AdminAuditLog,
AnalyticsEvents, RobotWebhook, SwarmGroup (reserviert), RobotAllowedUser.

### Authentifizierung

- Argon2id, Lockout nach 10 Fehlversuchen / 15 min, Reset-Limit 3/15 min,
  Resend-Limit 3/15 min, Refresh-Rotation per Redis-Lua-CAS mit 15 s
  Grace-Window, `tokenVersion`-basiertes globales Revoke.
- CSRF: Eigener `CsrfOriginGuard` + zusätzliches Cookie/CSRF-Token-Issue über
  `/auth/csrf` (Double-Submit). Refresh per Cookie und/oder Body.
- Optionales E-Mail-Verify-Gate (`REQUIRE_EMAIL_VERIFICATION`).

### Build-/Startprozess

- Root: `pnpm build|dev|lint|typecheck|test:coverage` über Turbo.
- API: `tsc` Build, `nest start --watch` Dev, Jest Tests.
- Web: `next build|dev|start`, Vitest Unit Tests, Playwright E2E.
- Docker: Multi-Stage BuildKit-Dockerfiles für API und Web; `nginx:1.27-alpine`
  Reverse Proxy; Compose-Service für `livekit`, `livekit-ingress`,
  `livekit-egress`, `cadvisor`, `minio`, optional `loki`/`promtail`
  (`profiles: ["observability-logs"]`).
- Setup: `setup-env.sh` (umfangreich, generiert Secrets, ssl.conf, etc.).

### Test-/Lint-/Deploy-Prozesse

- CI Workflow `ci.yml`: lint+typecheck → test (API) + coverage (API/Web) +
  e2e (Playwright Chromium) → build + OpenAPI-Drift-Check + Artefakt-Upload.
- CodeQL-Workflow vorhanden (`codeql.yml`).
- Dependabot-Konfiguration vorhanden.

---

## 3. Codequalität

### Beobachtungen

- **Strukturell überdurchschnittlich**: NestJS-Handler-Aufteilung, ADRs, klare
  DTO/Service-Trennung, Helper-Dateien wie `robots.service.helpers.ts`,
  `gateway-runtime.support.ts`.
- **God-Class-Risiko**:
  - `apps/api/src/moderation/moderation.service.ts` (992 LOC).
  - `apps/api/src/moderation/runtime-telemetry.service.ts` (804 LOC).
  - `apps/api/src/robots/robots.service.ts` (545 LOC) + `robots.controller.ts`
    (587 LOC).
  - `apps/api/src/gateway/gateway-runtime.support.ts` (558 LOC).
  - `apps/api/src/moderation/recording-admin.service.ts` (445 LOC).
- **Typisierung**: TS strict ist offenbar aktiv (Code verwendet `satisfies`,
  `as never`, sortenreine Generics). Stellenweise `any`/`as unknown as`-Casts
  (`apps/api/src/main.ts` Helmet-Plugin-Cast, `as never` für
  Stripe `apiVersion`). Diese Stellen sind isoliert und kommentiert, aber
  sollten als Tech-Debt notiert werden.
- **Express vs. Fastify-Mismatch**: `BillingController` typisiert Webhook-
  Requests als `import type { Request } from 'express'`, obwohl Adapter
  Fastify ist. Das funktioniert, weil nur `rawBody` verwendet wird, ist aber
  irreführend und kann zu Runtime-Bugs führen, sobald Express-spezifische
  Felder genutzt werden.
- **Logging**: NestJS-Logger flächendeckend benutzt; produktion lässt
  pino-pretty weg (gut). Vereinzelt `console`-Aufrufe nicht festgestellt
  (Stichprobe).
- **Fehlerbehandlung**: Globaler `AllExceptionsFilter` registriert,
  Auth-Service mappt Exceptions sinnvoll, Refresh-Reuse löst Token-Revoke aus.
- **Validation**: Globale `ValidationPipe` mit `whitelist+forbidNonWhitelisted`
  + Zod-Schemas in shared package — zwei parallele Validierungen sind
  vorhanden (Class-Validator + Zod). Das ist robust, aber doppelt zu warten.
- **Dead Code/Reservierungen**: `User.balance` (nur Ledger-Reserve),
  `SwarmGroup`, `aiAssistEnabled`, `ros2Enabled`, `Transaction`-Typen
  `BATTLE_ENTRY`, `FEATURED_ROBOT` ohne sichtbare Nutzung. Dokumentiert in
  ADR-0005 — sauber gelabelt.
- **Naming**: Insgesamt konsistent (camelCase, PascalCase, kurze Verb-Namen
  wie `handleCommand`, `moderate`). In Schema-Migrationsordnern leichte
  Inkonsistenz (`20260416_*` × mehrfach an einem Datum statt `__01`-Suffix).
- **DRY**: Wallet/Donation/Billing nutzen gemeinsame Idempotency-Tabelle —
  gut. CSP wird in Helmet, nginx und Next.js dreimal definiert (Inkonsistenz).
- **Komplexität**: Robot-Webhook-Service kombiniert SSRF-Schutz,
  Verschlüsselung, Retry, HMAC — muss sehr gut getestet bleiben.

---

## 4. Architektur & Skalierbarkeit

- **Realtime**: Active-Turn-State ist instanzaffin (siehe ADR-0006), Redis
  Pub/Sub gleicht Events aus. Bei mehreren API-Instanzen ist die korrekte
  Re-Routing-Logik dokumentiert, aber unter Last nicht durch Tests
  abgesichert. Bei Knotenausfall ist „Turn-Übergabe" der Hauptrisikopunkt.
- **Statefulness**: Refresh-Token-Rotation per Lua-Skript (CAS) mit Grace-
  Window — sehr solide.
- **Idempotenz**: Wallet- und Webhook-Pfade verwenden Idempotency-Keys,
  Multi-Leg-Transaktionen werden über `ledgerGroupId` zusammengeführt (Saldo
  pro Gruppe = 0). Audit-/Recovery-fähig.
- **Datenbank**: Sinnvolle Indizes auf `users(email)`, `users(username)`,
  `robots(ownerId|status|visibility|status|slug)`, `sessions(robotId|userId|
  startedAt)`, `queue_entries(robotId,position)`, `chat_messages(robotId,
  createdAt|userId|deletedAt)`, `transactions(userId,createdAt|type|
  ledgerGroupId|createdAt)`, `analytics_events(robotId,event,createdAt|userId,
  event,createdAt|createdAt)`. Keine offensichtlichen N+1-Schmerzpunkte beim
  Stichprobentest, aber Public-Overview-Aggregation und Stats-Endpoint
  brauchen einen Lasttest.
- **Skalierbarkeit**: Single-Process-Annahmen wie In-Memory-`Map<string, WsClient>`
  in `gateway-runtime.support.ts` sind hinter Redis-Pub/Sub abgesichert. Es
  fehlt aber eine dokumentierte horizontale Scaling-Anleitung (Sticky-
  Routing? LiveKit Distributed? Postgres-Read-Replica?). cAdvisor und
  Prom-Metriken sind vorhanden.
- **Modularität**: Sehr gut. Jeder Realtime-Aspekt hat seinen Handler.
- **Performance-Risiken**:
  - `moderation.service.ts` lädt teils breite Joins; konkretes Mess-Ziel
    fehlt.
  - Public-Overview wird `revalidate: 10` Server-Seitig — okay, aber nicht
    klar, ob Backenddaten zwischengecacht sind.
  - Stats-Gauges werden im Health-Controller berechnet (Prom-Format),
    teilweise via `register.getSingleMetric` mit Singleton-Schutz — okay.

---

## 5. Security Audit

### Bestätigt umgesetzt (Stichproben gelesen)

- Argon2id, Lockout, Refresh-Rotation, CSRF-Origin-Guard, JWT-Token-Version-
  basiertes Revoke, Helmet + Fastify, Strict-CORS, Body-Limit, ParseUUIDPipe
  auf moderierten Endpunkten, Webhook-SSRF-Schutz (`robot-webhook.service.ts`),
  Webhook-Secret-Encryption-Key, Stripe + PayPal Signature-Verification
  (Webhook-Pfad), Audit-Log für Admin-Aktionen, Soft-Delete mit Deletor-
  Referenz, Rate-Limiting auf nginx + NestJS-Throttler, Swagger Basic-Auth
  Schutz für Production, Metrics-Endpoint Basic-Auth schützbar,
  `assertRequiredSecret`-Bootguard (wirft in Production bei Default-Secrets).

### Konkret gefundene Schwachstellen

1. **CSP-Inkonsistenz und teils unsichere Direktiven**:
   - `apps/web/next.config.ts` setzt `script-src 'self' 'unsafe-inline'
     'unsafe-eval'` und `connect-src 'self' https: http: wss: ws:`.
   - `docker/nginx/nginx.ssl.conf.template` setzt ebenfalls `script-src
     'self' 'unsafe-inline' 'unsafe-eval'` und `connect-src 'self' ws: wss:
     http: https:`.
   - `docker/nginx/nginx.conf` ohne `unsafe-eval`, aber ebenso permissives
     `connect-src` und ohne HSTS (HTTP-Setup, ok).
   - Helmet (API) verwendet **keine** `unsafe-eval`, aber `unsafe-inline`
     für script-src und style-src.
   Folge: Tatsächliche Browser-CSP entsteht je nach Pfad und Header-Reihenfolge
   uneinheitlich. CHANGELOG erwähnt Entfernung von `unsafe-eval` — das
   Template wurde vergessen.
2. **`X-XSS-Protection` Header** wird gesetzt — gilt als deprecated/schädlich
   (kann CVE-spezifisch sogar XSS einführen). Sowohl in `nginx.conf` als auch
   in `nginx.ssl.conf.template`.
3. **`next/image` Remote-Pattern `https://**`** ist sehr offen. Erlaubt
   Optimierung beliebiger HTTPS-Hosts → potenzielle Bandbreiten-/SSRF-Vektor
   für nachgelagerte Dienste (Next-internes Image-Proxy). Begrenzen auf die
   tatsächlich erlaubten Hosts (Avatare, Thumbnails, MinIO).
4. **Bezahl-ENV unvollständig dokumentiert**: `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`, ebenso `WEBHOOK_SECRET_ENCRYPTION_KEY`
   (in `.env.example` ohne Default), `PASSWORD_RESET_TTL_SEC`, `TRUST_PROXY`,
   `FASTIFY_BODY_LIMIT`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (nur als
   Kommentar). Operatoren müssen den Quellcode lesen, um Bezahlung zu
   aktivieren — fehleranfällig.
5. **`LIVEKIT_API_KEY=devkey` als Default** in Compose und `.env.example`.
   Sehr leicht versehentlich produktiv. Boot-Validierung prüft nur das
   Secret, nicht den Key.
6. **`SEED_ADMIN_PASSWORD` ist Pflicht zum Bootstrap**, aber `seed.ts` läuft
   automatisch beim Container-Start (laut README/Docker-Layer). Risiko, dass
   Operator dieses Passwort live lässt; keine erzwungene Rotation/Erste-
   Anmeldung.
7. **`@fastify/csrf-protection` ist als Dependency vorhanden, aber statt
   dessen wird ein eigener Origin-Guard verwendet**. Das eigene Schema
   (Origin-Header + optionales CSRF-Cookie) ist ok für SameSite-Strict,
   aber sollte explizit dokumentiert sein, damit klar ist, warum die
   Standardlösung nicht zum Einsatz kommt.
8. **Rate-Limit-Skopus**: Throttler ist global mit 100/60s — recht hoch für
   sensible Endpunkte. nginx `auth`-Zone (5/min) gibt es nur, wenn nginx
   davorsteht. Für Direktzugriff auf Port 4000 (z. B. interne Tests) ist die
   Auth-Bremse weicher.
9. **`TRUST_PROXY` Default `loopback, linklocal, uniquelocal`** ist ok hinter
   Docker, aber bei IPv6-Setup oder nicht-Docker-Reverse-Proxy muss explizit
   gesetzt werden — ist nicht in `.env.example`.
10. **Keine sichtbare Output-Sanitization für Chat** (XSS-Risiko) — UI-Seite
    nicht im Detail geprüft. `ChatHandler` validiert Länge/Profanity, aber
    Inhalt wird offenbar als Plain-Text rendern (React encodet by default,
    daher voraussichtlich ok). Prüfpunkt.
11. **Recordings-Bucket policy `mc anonymous set none`** ist gut, signed URLs
    werden über `RECORDING_SIGNED_URL_TTL_SEC` (default 300 s) ausgegeben.
    Thumbnail-Bucket dagegen `download` (öffentlich) — Avatare/Thumbnails
    sind also weltlesbar, was beabsichtigt sein dürfte, aber im Privacy-Text
    transparent erwähnt werden sollte.
12. **Einsicht in Mail-Template-Sicherheit nicht geprüft**. Operator-Settings
    (Reset-Link) gehen in plain HTML — Prüfpunkt.

### Sonstige Hinweise

- **Refresh-Token im Body als Fallback** (`refresh`-Endpunkt) — ok für native
  Clients, aber dokumentieren.
- **Login-Lockout pro E-Mail, nicht pro IP** — User-Enumeration-resistent,
  könnte aber für Massen-Lockouts ausgenutzt werden (Joe-Job). Erwägung:
  zusätzlich IP-Throttling.
- **Kein dokumentierter „Logout-überall"-Flow im UI** trotz
  `revokeRefreshTokens`-API.

---

## 6. UX/UI Audit

> Hinweis: keine Live-Sicht der gerenderten App — Bewertung anhand der Quell-
> Komponenten (`apps/web/src/app/**`, `components/**`).

- **Layout/Design**: Tailwind v4 + CSS-Variablen-Theme (Dark/Light), saubere
  Hero-Section, klare Card/Button/Badge/Dialog/Switch-Primitiven. Toast-Stack
  vorhanden. Cookie-Banner mit Accept/Decline und Settings.
- **Navigation**: Globaler Nav, Dashboard mit Sidebar (Components in
  `components/dashboard/dashboard-sidebar.tsx`). Robot-View hat dedizierte
  Header/Sidebar/Mobile-Bar — gut für Mobile.
- **Ladezustände**: `loading.tsx` für `dashboard`, `mod`, `robot` — gut.
- **Empty/Error States**: `error.tsx` und `not-found.tsx` vorhanden.
  `RobotView` zeigt Reconnect-Banner mit Sekundenanzeige — sehr gute
  Realtime-UX.
- **Onboarding-Overlay**: `RoomOnboardingOverlay` (dynamisch geladen) für
  neue Besucher — vorhanden.
- **Forms**: Login/Reset/Forgot-Password explizit gehandhabt; `mode='login'`
  vs `register` Switching im selben Component — fokussiert, keine Field-Level-
  Errors gesehen (nur globale `error`-Strings), Verbesserungspotenzial.
- **Accessibility**: `aria-hidden` auf dekorativen Backgrounds, semantische
  Headings, sichtbare Focus-Styles via Tailwind-Defaults vorhanden.
  Playwright nutzt `@axe-core/playwright` — gute Basis. Tatsächliche
  axe-Run-Coverage prüfen.
- **Microcopy/Trust**: Login-Side-Panel, Cookie-Banner, Privacy-/Imprint-
  Skelette mit Hinweis bei fehlender Konfiguration. Insgesamt seriös, aber
  marketing-/onboardings-arm (Testimonials, Beispielvideo, Quickstart-Block
  fehlen auf der Home-Seite).
- **Klickwege**: Login → /explore → Robot-Detail → Queue → Drive sieht
  durchgängig aus. Embed-Route vorhanden.
- **Mobile**: Mobile-Bar auf Robot-View, `safe-pb` Padding-Bottom-Klasse —
  gut. Responsiveness der Dashboard-Sidebar prüfen (Test vorhanden:
  `dashboard-sidebar.test.tsx`).

---

## 7. Feature Audit

### Vorhandene Features (kein Anspruch auf Vollständigkeit)

- Real-time Video (LiveKit), Steuerung (eigenes WS), Chat, Crowd-Echo
- FCFS Queue, konfigurierbare Turn-Time, Voting-Modus als Enum vorgesehen
- Konfigurierbare Control-Buttons mit Cooldown, Hotkey, Kosten, Access-Level
- RBAC Admin/Mod/User mit Audit-Log
- Email-Verifizierung, Password-Reset, Resend-Limits
- Robot-Dashboard (Visibility, Access-Mode, Allowlist, Telemetry, Webhooks,
  Tokens, Operations, Monitoring)
- Embed-View, Status-Page, Leaderboard, Sessions-History, Wallet-Page
- Mod-Dashboard (Robots, Users, Moderation, Runtime, Payouts)
- Stripe + PayPal Checkout, Webhook-Idempotenz, Refund-Handling, Chargeback
- Donations + Payout-Requests
- Soft-Delete + Audit-Log für Chat
- Recording (LiveKit Egress) → S3/MinIO mit Lifecycle (TTL via ENV)
- Thumbnails, Cookie-Banner, Privacy/Imprint/Terms/Cookies-Seiten
- Service Worker Registration
- Sentry-Hooks (optional)
- OpenTelemetry Tracing (optional)
- cAdvisor + Prom-Metriken
- Datenexport (laut Settings-Page)
- Account-Löschung (laut Settings-Page)

### Lücken & Risiken

- **Voting Queue Balance/Ranking** explizit als „missing/planned" im README.
- **ROS2 Integration** als Roadmap markiert (`ros2Enabled` ist nur Schema-
  Flag).
- **Credit/Priority-System** über Schema hinaus nicht aktiv.
- **Search/Filter** auf Explore: nur Status/Tag/Query/Sort als Server-Param;
  UI-Sichtbarkeit ungeklärt — Prüfpunkt.
- **Notifications**: Nur Browser-Notifications für Queue-Position/Turn
  (Settings-Switch). Email-Notifications für Mod-Aktionen unklar.
- **Multi-Camera**: Schema/Service vorhanden, UI im Dashboard-Webhook?
  Prüfpunkt.
- **Tagging/Discovery**: `tags`-Array auf Robot, aber kein offensichtliches
  Tag-Management-UI.
- **Onboarding**: Es gibt `RoomOnboardingOverlay`, aber kein dokumentierter
  „neuer Operator"-Flow (Robot anlegen, Client downloaden, erstes Live-
  Stream-Event).
- **Operator-Analytics**: AnalyticsEvent-Schema vorhanden, aber keine
  öffentliche Dashboard-Seite.
- **AGB/Terms-Inhalte**: Skeleton-Seite vorhanden — Konformität mit
  bezahltem SaaS-Use-Case (Stripe/PayPal) unklar.
- **Mehrsprachigkeit**: Kein i18n erkennbar.

---

## 8. Produkt- & Business-Audit

- **Zielgruppe**: Hobby-/Pro-Operator, die LetsRobot-/Remo.tv-Nachfolger
  suchen, plus Self-Hosted Operatoren (Arcade-/Showroom-/Bildung-Setup). Fit
  mittel-stark; Code zeigt eindeutige Operator-Tools.
- **Conversion**: Home-Page hat Hero, aber keine Pricing-Tabelle, kein
  Demo-Video, keine Case-Studies. Wallet/Credits-Modell ist da, aber nicht
  oben aufgeführt.
- **Pricing/Checkout**: `CREDIT_PACKAGES` werden API-seitig ausgegeben.
  Operator muss in `credit-packages.ts` editieren und Stripe-Webhook
  konfigurieren. Klare Pricing-Doku im Web fehlt.
- **Trust/Recht**: Privacy/Imprint/Cookies vorhanden; Inhalt ist generisch
  und enthält Hinweise „nicht konfiguriert", was einer öffentlich erreichbaren
  Seite gegenüber Endkunden problematisch ist (DSGVO Art. 13). AGB/Widerruf
  fehlen — bei Bezahlflows in der EU notwendig.
- **Wettbewerb**: USP klar (Self-hosted, OSS, niedrige Latenz). Marketing-
  Polish fehlt.
- **Kundenbindung**: Wallet+Donations sind vorhanden, Leaderboard auch.
  Email-Lifecycle fehlt (nur Verify/Reset/Lockout-Mails).
- **Fehlende Produktlogik**:
  - Kein Subscription-Modell (nur One-Off Credit-Käufe).
  - Kein Refund-Self-Service (nur Webhook-Refund-Verarbeitung).
  - Kein Operator-Onboarding-Tutorial im Web.

---

## 9. QA & Testing

### Vorhanden

- API: 41 `*.spec.ts` (`auth`, `gateway/*`, `queue/*`, `robots/*`, `wallet/*`,
  `moderation/*`, `sessions`, `livekit`).
- Web: 15 Component-/Hook-Tests (Vitest + React Testing Library).
- E2E: Playwright Smoke + Auth-Flow + Accessibility (axe).
- CI: Lint+Typecheck+Test+Coverage+E2E+Build+OpenAPI-Drift.
- OpenAPI Contract: exportiert nach `docs/openapi.json` und gegen Drift geprüft.

### Fehlend / Schwach

- **Realtime/WS-Lasttest**: keine k6/Artillery/Playwright-Stress-Suiten.
  Bei Latenz < 50 ms Anspruch fehlt eine Mess-Pipeline.
- **Cross-Instance-Test des Gateways**: ADR-0006 spricht über instanz-affin
  — aber kein integrationaler Multi-Node-Test im CI.
- **Billing-Integrationstest** (Stripe Test-Mode/PayPal Sandbox) fehlt im
  CI.
- **Migration-Test gegen bestehende Datenbestände** (es gibt nur
  `prisma db push` im Compose-Start statt `migrate deploy`!).
- **Web-Coverage-Pflichtwert** nicht definiert (kein Threshold).
- **Lighthouse/PageSpeed-Check** nicht im CI.
- **Smoke-E2E setzt einen Test-Robot „test-robot" voraus** — Setup nicht
  reproduzierbar in CI; mehrere Tests umgehen Fehler mit `.catch(() => false)`,
  was Tests faktisch unscharf macht.
- **Manuelle QA-Checkliste** fehlt im Repo.
- **Mocking** des LiveKit-Servers in Integrationstests prüfen.

---

## 10. Performance Audit

- **Bundle-Größe Web**: Framer-Motion + LiveKit-Client + lucide-react sind
  groß; `dynamic(... { ssr:false })` für Onboarding/Editor/Monitoring/
  Webhooks-Section ist gut. Bundle-Analyzer-Workflow nicht im Repo.
- **Re-Renders**: Zustand persist + WS-Events können viele Re-Renders
  verursachen — Hooks (`useRobotViewState`, `use-robot-view-state.ts`)
  sehen factored aus, sind aber nicht isoliert vermessen.
- **Server-Side Rendering**: Home/Explore mit `revalidate: 10` ist sinnvoll;
  Privacy/Imprint mit `dynamic = 'force-dynamic'` — könnte SSG werden, sobald
  Legal-Konfiguration build-time bekannt ist.
- **Caching**: Kein CDN/Cache-Header-Layer im nginx-Config sichtbar (außer
  Standard). Static Assets profitieren teils von Next.js.
- **Datenbank**: Prisma-Pool 10 (Default) — vermutlich knapp für viele
  parallele WS-Sessions, da jeder Heartbeat/Action evtl. DB-Reads triggert.
  Performance-Profiling fehlt.
- **API-Performance**: Promise.all in Page-Loaders (Home), Public-Overview-
  Service ist eigens herausgezogen — ok.
- **Lazy Loading**: `dynamic` Imports sind genutzt; LiveKit-Player als
  separates Component. `next/font` mit `display: 'swap'`.
- **Bilder**: `next/image` mit `https://**`, `unoptimized` nicht gesetzt —
  okay, aber Limitierung der Hosts notwendig (siehe Security).
- **Pagination**: API hat `limit/offset` für Robots, Sessions, Chat-History.
  Cursor-basierte Pagination wäre für Chat besser.

---

## 11. DevOps & Deployment

- **Build**: Multi-Stage BuildKit, Cache-Mounts für pnpm-Store und
  NestJS-Cache — sehr gut.
- **Runtime**: API als Node 24 Alpine + `su-exec` für Drop-Privileges.
- **Healthchecks**: Compose-Healthchecks für jedes Backend (Postgres, Redis,
  LiveKit, Ingress, Egress, MinIO, API, Web, nginx, cAdvisor) — sehr stark.
- **Restart-Policy**: `on-failure:10` durchgängig — okay, Self-Heal limited.
- **Logs**: Pino + Loki/Promtail-Profile. Logrotation nicht konfiguriert.
- **Monitoring**: cAdvisor + Prom-Metriken eingebaut. Externer Prometheus-
  Stack nicht im Compose enthalten — dokumentiert in `docs/observability.md`?
  Datei vorhanden — wahrscheinlich ja. Grafana-Dashboards in `docs/grafana/`.
- **Error Tracking**: Sentry-Hooks vorhanden, optional.
- **Backups**: `scripts/backup-db.sh` vorhanden — Inhalt prüfen, restore-
  Script ist nicht gelistet.
- **Migrations in Prod**: `prisma db push` beim API-Container-Start statt
  `prisma migrate deploy`. Risiko von Schema-Drift in Produktion ohne
  Migrations-Historie. Migrations existieren — nicht zur Anwendung in Prod
  vorgesehen?
- **Zero-Downtime-Deployments**: Nicht dokumentiert.
- **Rollback**: Keine dokumentierte Rollback-Prozedur (DB+Image+ENV).
- **SSL**: `setup-env.sh` schreibt `nginx.ssl.conf` aus Template — nicht im
  Repo (gitignored). Zertifikate werden in `docker/nginx/ssl` montiert.
- **CI**: Stabil, aber kein Release-Workflow (Tags, Image-Push, SemVer).
- **Node-Version-Drift**: `.nvmrc=24`, Dockerfile `node:24-alpine`,
  CI verwendet `node-version: '22'`. Auflösen.

---

## 12. Dokumentation

- **README**: Vollständig, lebt mit dem Projekt.
- **CONTRIBUTING.md**, **SECURITY.md**, **CHANGELOG.md**: vorhanden.
- **ADRs**: 7 ADRs, decken Kerntechnik-Entscheidungen ab.
- **Operator-Doku**: `docs/runbook.md`, `docs/observability.md`,
  `docs/websocket-protocol.md`, `docs/robot-auth.md`. Sehr operatorfreundlich.
- **API-Doku**: Swagger live + generierter `docs/api-client-docs.md` (script).
- **Lücken**:
  - Keine vollständige `.env.example` (Bezahlflow, Sentry, Trust-Proxy,
    Webhook-Encryption-Key).
  - Keine dokumentierte Production-Checkliste (Domain, DNS, SSL, Secrets,
    Migrations, Image-Push, Monitoring-Endpunkte).
  - Keine Anleitung „Was, wenn ein Knoten ausfällt".
  - Keine Datenfluss-Beschreibung für DSGVO (welche personenbezogenen Daten
    fließen wohin, wie lange).
  - `docs/grafana/` Inhalt ungeprüft.
  - Keine Roadmap außer „missing/planned"-Block im README.

---

## 13. Rechtliches & Compliance

> Kein Rechtsrat — nur Beobachtungen anhand des Codes.

- **Imprint/Privacy/Terms/Cookies**: Seiten existieren. Inhalt wird teils
  aus ENV (`NEXT_PUBLIC_LEGAL_*`) generiert. Wenn diese ENV in Production
  fehlen, wirft die App `Error` (gut) — die Inhalte selbst sind aber
  **generisch** und decken nicht zwingend alle Pflichtangaben ab (Pflichten
  variieren stark nach Land).
- **Cookie-Banner**: Explicit Accept/Decline implementiert; Cookie-Notice-
  Seite listet Kategorien. Tracking ist nicht aktiviert (Sentry optional,
  kein GA). Bei Aktivierung von Sentry müsste Consent-Logik einbinden.
- **DSGVO-Datenflüsse**:
  - PII in Postgres: Email, Username, DisplayName, Avatar, Recordings,
    Chat-Historie, AnalyticsEvents.
  - Recordings haben Retention via `RECORDING_RETENTION_DAYS` (Default 30).
  - Chat-Soft-Delete vorhanden, aber keine sichtbare automatische Löschung
    nach X Tagen.
  - User-Account-Deletion-API ist im Settings-Page genutzt — Tiefe der
    Löschung (alle abhängigen Tabellen) prüfen.
- **Zahlungsdaten**: Vollständig delegiert an Stripe/PayPal (richtig). Keine
  PAN/Karten im Code.
- **Recordings + Privacy**: Mitschnitt-Funktion existiert. Es ist nicht
  dokumentiert, dass Nutzer beim Betreten des Raums über Recording informiert
  werden müssen. UI-Hinweis prüfen.

---

## 14. Priorisierte Maßnahmen

### P0 – Kritisch, vor Public-Release

- CSP konsolidieren (Helmet vs nginx vs next.config) und `unsafe-eval`
  überall entfernen. `connect-src` auf konkrete Hosts beschränken.
- `.env.example` um Bezahl- und Webhook-ENV erweitern; Bootguard für
  Stripe/PayPal-Konfiguration, wenn aktiviert.
- Production-Migrations-Strategie umstellen von `prisma db push` auf
  `prisma migrate deploy` (vorhandene Migrations existieren!).
- Datenfluss-/Compliance-Doku ergänzen (DSGVO).
- `LIVEKIT_API_KEY` Default `devkey` entfernen / Boot-Validierung erzwingen.
- Recording-Hinweis im Robot-Room (UI) sichtbar machen.

### P1 – Wichtig vor Release

- Node-Version-Drift CI/Local/Docker konsolidieren (alle auf 24).
- HSTS/Modern-Header in nginx-Templates setzen, deprecated `X-XSS-Protection`
  entfernen.
- `next/image` `remotePatterns` auf reale Hosts beschränken.
- Test-Coverage für Billing (Stripe/PayPal) inkl. Webhook-Replay-Idempotenz.
- WS-Lasttest-Pipeline (k6/Artillery) + Soll-/Ist-Reporting.
- Production-Checkliste/Runbook ergänzen, Rollback-Prozedur dokumentieren.
- Logout-überall-Flow im UI exposen.
- IP-basiertes Rate-Limiting zusätzlich zur Email-Lockout-Logik.

### P2 – Sollte verbessert werden

- God-Class-Refactor (`moderation.service.ts`, `runtime-telemetry.service.ts`,
  `robots.controller.ts`, `gateway-runtime.support.ts`).
- Express-Typen aus Billing-Controller entfernen, Fastify-Typen nutzen.
- Cursor-basierte Chat-Pagination.
- Bundle-Analyzer als optionaler CI-Job.
- AGB/Refund-Policy-Seiten konkret formulieren.
- E2E-Tests deterministisch machen (Test-Fixture Robot in CI seedbar).

### P3 – Nice-to-have

- i18n.
- Subscription-Modell.
- Onboarding-Tutorial im Dashboard.
- Operator-Analytics-Page.

---

## 15. Konkrete Aufgabenliste

> Hinweis: Wo ein Punkt nicht eindeutig im Code verifizierbar war, ist er als
> **Prüfpunkt** markiert. Aufwand ist relativ zum Repo: klein < ½ Tag,
> mittel ≈ 1–2 Tage, groß > 2 Tage.

### Security

- [x] **CSP zwischen Helmet, nginx, next.config konsolidieren**
  - Priorität: P0
  - Kategorie: Security
  - Problem: Drei unterschiedliche CSP-Definitionen; `unsafe-eval`/
    `unsafe-inline` und permissive `connect-src` in `apps/web/next.config.ts`
    und `docker/nginx/nginx.ssl.conf.template`.
  - Risiko/Auswirkung: XSS-Eskalationspfade, „Defense-in-depth" untergraben.
  - Ziel: Eine kanonische CSP, generiert aus den tatsächlich erlaubten
    Origins (App, LiveKit Public/WS, MinIO Public, optional Sentry/Stripe).
    `unsafe-eval` entfernen, `unsafe-inline` mindestens für `script-src`
    streichen (Next.js erfordert ggf. Nonces oder Strict-Dynamic).
  - Betroffene Dateien: `apps/web/next.config.ts`, `apps/api/src/main.ts`
    (Helmet-Block), `docker/nginx/nginx.conf`,
    `docker/nginx/nginx.ssl.conf.template`.
  - Umsetzung: Eine CSP-Builder-Funktion in `packages/shared` oder einem
    Operator-Skript erzeugen; nginx als alleinige Quelle führen, Next.js
    und Helmet auf neutralen Default zurücksetzen oder identisch spiegeln.
  - Akzeptanz: `curl -I https://<host>/` und `https://<host>/api/v1/health`
    liefern identische CSP; Lighthouse CSP-Audit sauber; Browser-Tests
    werfen keine CSP-Violations.
  - Aufwand: mittel.

- [x] **`unsafe-eval` aus `nginx.ssl.conf.template` und `next.config.ts` entfernen**
  - Priorität: P0
  - Kategorie: Security
  - Problem: CHANGELOG sagt „Tightened nginx/API CSP defaults by removing
    unsafe-eval", `nginx.ssl.conf.template:84` und `next.config.ts:11`
    enthalten es jedoch weiterhin.
  - Risiko: Erhöhtes XSS-Risiko, JIT-eval-Vektoren möglich.
  - Ziel: `unsafe-eval` raus, App-Smoke-Test bestehen.
  - Betroffene Dateien: `docker/nginx/nginx.ssl.conf.template`,
    `apps/web/next.config.ts`.
  - Umsetzung: Direktive entfernen, `next dev` auf React 19 Strict ohne
    eval prüfen, manuelles Testen aller Live-Pfade.
  - Akzeptanz: Smoke + E2E grün, keine eval-Errors in Browser-Konsole.
  - Aufwand: klein.

- [x] **`X-XSS-Protection`-Header entfernen**
  - Priorität: P1
  - Kategorie: Security
  - Problem: Header ist deprecated, kann in alten Browsern XSS einführen.
  - Ziel: Header in nginx-Configs streichen.
  - Betroffene Dateien: `docker/nginx/nginx.conf`,
    `docker/nginx/nginx.ssl.conf.template`.
  - Umsetzung: `add_header X-XSS-Protection ...` löschen.
  - Akzeptanz: `curl -I` zeigt Header nicht mehr.
  - Aufwand: klein.

- [x] **HSTS-Header in `nginx.ssl.conf.template` prüfen und sicher stellen**
  - Priorität: P1
  - Kategorie: Security
  - Umsetzung: HSTS-Strategie in `docs/runbook.md` (Abschnitt „HSTS Strategy")
    festgehalten. Default bleibt `max-age=31536000; includeSubDomains` ohne
    `preload`; Begründung und Opt-in-Schritte dokumentiert.

- [x] **Bezahl-ENV in `.env.example` ergänzen + Boot-Guard**
  - Priorität: P0
  - Kategorie: Security / Produkt
  - Problem: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`,
    `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`,
    `WEBHOOK_SECRET_ENCRYPTION_KEY`, `PASSWORD_RESET_TTL_SEC`, `TRUST_PROXY`,
    `FASTIFY_BODY_LIMIT`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT` werden im Code
    gelesen, sind aber in `.env.example` nicht (oder nur als Kommentar)
    enthalten.
  - Risiko: Webhook ohne Signaturprüfung scheitert leise; Operator deployt
    Bezahlung mit Sandbox-Defaults; Webhook-Encryption-Key fällt zurück
    auf einen statischen Default.
  - Ziel: Vollständige `.env.example` + harter Bootguard, der Bezahl-ENV
    erzwingt, sobald `STRIPE_SECRET_KEY`/`PAYPAL_CLIENT_ID` gesetzt sind.
  - Betroffene Dateien: `.env.example`, `apps/api/src/main.ts`,
    `apps/api/src/billing/providers/*.ts`,
    `apps/api/src/robots/robot-webhook.service.ts`.
  - Umsetzung: ENV-Liste vervollständigen; in `bootstrap` die
    `assertRequiredSecret`-Logik um Bezahl-Env erweitern (nur wenn der
    Provider effektiv aktiviert ist).
  - Akzeptanz: Bei aktivem Stripe ohne `STRIPE_WEBHOOK_SECRET` startet die
    App in Production nicht; lokaler Dev-Run unverändert.
  - Aufwand: mittel.

- [x] **`LIVEKIT_API_KEY=devkey` Default entfernen oder Boot blockieren**
  - Priorität: P0
  - Kategorie: Security
  - Problem: `.env.example` und Compose verwenden `devkey` als Fallback.
  - Risiko: Operator deployt mit Schlüssel `devkey`; LiveKit-Token werden
    trivial fälschbar.
  - Ziel: Kein Default; Bootguard verlangt `LIVEKIT_API_KEY != devkey` in
    Production.
  - Betroffene Dateien: `apps/api/src/main.ts`, `.env.example`,
    `docker-compose.yml`, `docker/livekit/livekit.yaml`.
  - Umsetzung: `bannedValues: ['devkey']` für `LIVEKIT_API_KEY` ergänzen;
    Compose-Default streichen.
  - Akzeptanz: Production-Start scheitert mit klarer Fehlermeldung, wenn
    Default benutzt wird.
  - Aufwand: klein.

- [x] **`next/image` `remotePatterns` auf konkrete Hosts beschränken**
  - Priorität: P1
  - Kategorie: Security / Performance
  - Umsetzung: `apps/web/next.config.ts` baut `remotePatterns` jetzt aus
    `THUMBNAIL_PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL` und expliziter
    Avatar-Allowlist. Kein `https://**` mehr als Default.

- [x] **IP-basiertes Rate-Limiting für Auth ergänzen**
  - Priorität: P1
  - Kategorie: Security
  - Problem: Lockout-Logik arbeitet nur pro Email — Joe-Job-Lockouts möglich.
  - Risiko: Nutzer können absichtlich aus dem Account ausgesperrt werden.
  - Ziel: IP+Email kombiniertes Rate-Limit; Ban statt Lockout, sobald IP
    hochfrequent fehlschlägt.
  - Betroffene Dateien: `apps/api/src/auth/auth.service.ts`,
    `docker/nginx/nginx*.conf`.
  - Umsetzung: Throttler-Storage `redis` mit IP-Schlüsseln; nginx-Zone wird
    ergänzt um eine zusätzliche IP-Bremse.
  - Akzeptanz: Test simuliert 100 Login-Fehler von einer IP — Lockout
    erfolgt IP-seitig, Account des realen Nutzers bleibt nutzbar.
  - Aufwand: mittel.

- [x] **Logout-überall im UI**
  - Priorität: P1
  - Kategorie: Feature / Security
  - Problem: `revokeRefreshTokens` existiert API-seitig, ist im Settings-UI
    nicht klar exponiert (Prüfpunkt).
  - Risiko: Nutzer können nach Geräteverlust nicht alle Sessions sperren.
  - Ziel: Sichtbarer „Aus allen Geräten abmelden"-Button in Settings.
  - Betroffene Dateien: `apps/web/src/app/settings/page.tsx`,
    ggf. `apps/api/src/auth/auth.controller.ts`.
  - Umsetzung: Endpoint exposen + UI-Button hinzufügen.
  - Akzeptanz: Klick invalidiert sofort alle Refresh-Tokens (Versionsbump).
  - Aufwand: klein.

- [x] **Chat-Output-Sanitization Prüfpunkt**
  - Priorität: P1
  - Kategorie: Security (Prüfpunkt)
  - Umsetzung: Codereview ergab keine `dangerouslySetInnerHTML`-Verwendung
    im Chat-Pfad. Vitest in `apps/web/src/components/robot-view/chat-panel.test.tsx`
    rendert `<img src=x onerror=…>`-Payload, prüft dass weder `<img>`/
    `<script>` ins DOM gelangen noch globale Seiteneffekte ausgelöst werden,
    und dass der Klartext sichtbar ist.

### DevOps / Deployment

- [x] **`prisma migrate deploy` statt `prisma db push` in Production**
  - Priorität: P0
  - Kategorie: DevOps
  - Problem: Container-Start ruft laut README/Dockerfile-Layer `prisma db push`
    auf, obwohl Migrations vorhanden sind.
  - Risiko: Schemadrift, Migrations werden nie historisch angewendet,
    Rollbacks unmöglich.
  - Ziel: `prisma migrate deploy` als Start-Schritt; `seed` nur initial.
  - Betroffene Dateien: `docker/api/Dockerfile`, `apps/api`-Startskripte,
    `packages/prisma/package.json`, `README.md`.
  - Umsetzung: Entrypoint umstellen; CI-Job „migration-dry-run" gegen
    Produktionsdump.
  - Akzeptanz: Frischer Production-Start applied alle Migrations; `_prisma_migrations`-Tabelle gefüllt.
  - Aufwand: mittel.

- [x] **Node-Version konsistent auf 24**
  - Priorität: P1
  - Kategorie: DevOps
  - Umsetzung: Alle Jobs in `.github/workflows/ci.yml` und `codeql.yml`
    laufen auf `node-version: '24'`. Engines + Dockerfiles sind bereits
    auf 24.

- [ ] **Release-Workflow mit Image-Push und SemVer-Tagging**
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: Es gibt keinen Workflow für Image-Push (`docker push`) oder
    Tag-Release.
  - Risiko: Operator zieht „latest" oder baut selber, kein definierter
    Release-Stand.
  - Ziel: GitHub-Action triggered via Tag baut & pusht
    `botparty-api`/`botparty-web` zu GHCR.
  - Betroffene Dateien: `.github/workflows/release.yml` (neu),
    `docker-compose.yml` (Image-Referenz).
  - Akzeptanz: Tag `v0.1.4` produziert signierte (cosign) Images.
  - Aufwand: mittel.

- [x] **Production-Checkliste / Runbook ergänzen**
  - Priorität: P1
  - Kategorie: DevOps / Doku
  - Umsetzung: Abschnitt „Production Release Checklist" in
    `docs/runbook.md` mit DNS, TLS, Secrets, Migrations, Smoke-Tests,
    Monitoring, Backups und Rollback-Plan.

- [x] **Backup/Restore-Prozedur dokumentieren**
  - Priorität: P1
  - Kategorie: DevOps
  - Umsetzung: `scripts/restore-db.sh` als Pendant zu `backup-db.sh`
    hinzugefügt (Container- + Host-Mode, gzip-Support, interaktive
    Bestätigung, automatische Service-Quiesce). Frequenz/Retention/
    Restore-Schritte in `docs/runbook.md` (Abschnitt „Backup & Restore").

- [x] **Logrotation/Logsink für Production**
  - Priorität: P2
  - Kategorie: DevOps
  - Umsetzung: Docker-JSON-Driver-Caps (`max-size=20m`, `max-file=5`) im
    `docker-compose.yml` aktiv; Loki/Promtail/Grafana laufen unter dem
    `observability`-Profile. Doku in `docs/runbook.md` (Abschnitt
    „Logrotation / Log Sink") inkl. Drop-In-Alternative für Vector/
    Fluent Bit/journald.

### Codequalität / Refactor

- [ ] **`moderation.service.ts` aufteilen**
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: 992 LOC, Mehrere Verantwortlichkeiten (Moderate, Audit-Log,
    Admin-Overview, Runtime-Overview).
  - Ziel: Split in `ModerationService`, `ModerationAuditService`,
    `ModerationOverviewService`.
  - Betroffene Dateien: `apps/api/src/moderation/*`.
  - Akzeptanz: Datei < 400 LOC, Tests grün.
  - Aufwand: groß.

- [ ] **`runtime-telemetry.service.ts` aufteilen**
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: 804 LOC.
  - Ziel: Split nach Datenquelle (Gateway, cAdvisor, LiveKit, DB).
  - Aufwand: groß.

- [ ] **`robots.controller.ts` und `robots.service.ts` modularisieren**
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: 587 + 545 LOC. Multiple Subcontroller-Verantwortlichkeiten
    (Stream-Key, Webhooks, Cameras, Telemetry).
  - Ziel: Eigene Controller je Aspekt (`RobotWebhooksController`,
    `RobotCamerasController`, ...).
  - Aufwand: groß.

- [x] **Express-Typen aus `BillingController` entfernen**
  - Priorität: P2
  - Kategorie: Codequalität
  - Umsetzung: `apps/api/src/billing/billing.controller.ts` nutzt
    `FastifyRequest` + `FastifyRequestWithRawBody`-Helper. Keine
    Express-Imports mehr.

- [ ] **Doppelte Validierung (Zod + class-validator) konsolidieren**
  - Priorität: P3
  - Kategorie: Codequalität
  - Problem: ValidationPipe + Zod-Schemas validieren teils dieselben Felder.
  - Ziel: Klare Konvention — Zod als Single-Source, NestJS-Pipe daraus
    abgeleitet (z. B. `nestjs-zod`).
  - Aufwand: groß.

### Tests / QA

- [ ] **Billing-Webhook-Idempotenz und Refund-Pfade testen**
  - Priorität: P1
  - Kategorie: QA
  - Problem: Keine Spec für `BillingService` gefunden; Stripe-/PayPal-
    Provider werden nur typgeprüft.
  - Risiko: Doppelbuchung, fehlerhafter Refund, Webhook-Replay.
  - Ziel: Specs für Verify-Webhook (Replay-Header), Refund, Chargeback,
    PayPal-Sandbox-Mock.
  - Betroffene Dateien: `apps/api/src/billing/`.
  - Akzeptanz: Tests decken `paid → refunded → chargeback` ab.
  - Aufwand: mittel.

- [ ] **Cross-Instance-Test des WS-Gateways**
  - Priorität: P1
  - Kategorie: QA
  - Problem: ADR-0006 beschreibt instanzaffines Active-Turn-Modell, aber
    kein automatischer Multi-Node-Test.
  - Ziel: Integrationstest mit zwei API-Containern (Testcontainers Compose),
    der Turn-Übergabe bei Knoten-Stop verifiziert.
  - Aufwand: groß.

- [ ] **WS-Lasttest-Pipeline (k6 oder Artillery)**
  - Priorität: P1
  - Kategorie: Performance / QA
  - Problem: Keine Lasttest-Suiten.
  - Ziel: Profil mit 200 gleichzeitigen Zuschauern + 5 aktiven Drivern
    pro Robot; SLA: < 100 ms Roundtrip Control.
  - Betroffene Dateien: `tests/load/` (neu).
  - Akzeptanz: Reproduzierbarer Lauf in CI mit Threshold-Reporting.
  - Aufwand: groß.

- [ ] **Deterministische E2E mit Test-Robot-Fixture**
  - Priorität: P1
  - Kategorie: QA
  - Problem: `apps/web/tests/e2e/smoke.spec.ts` referenziert
    `/robot/test-robot`, aber kein automatischer Seed in CI.
  - Ziel: Setup-Schritt im Playwright-Workflow legt User+Robot per
    `prisma db seed --preview-feature` an.
  - Betroffene Dateien: `apps/web/tests/e2e/*`,
    `packages/prisma/seed.ts`, `.github/workflows/ci.yml`.
  - Akzeptanz: E2E grün auch in frischer DB.
  - Aufwand: mittel.

- [x] **Coverage-Threshold konfigurieren**
  - Priorität: P2
  - Kategorie: QA
  - Umsetzung: `apps/api/package.json` setzt `coverageThreshold`
    (statements 55, branches 40, functions 50, lines 55) in der Jest-
    Config. `apps/web/vitest.config.ts` bekommt `coverage.thresholds`
    (statements 25, branches 50, functions 35, lines 25). CI-Job
    `coverage` führt beide Coverage-Runs aus und schlägt bei
    Unterschreitung fehl.

### UX / UI

- [x] **Recording-Hinweis im Robot-Room sichtbar machen**
  - Priorität: P0 (Compliance)
  - Kategorie: UX / Compliance
  - Problem: Recording wird via Egress aktiviert, Endnutzer im Room
    bekommen keinen sichtbaren Hinweis (Prüfpunkt).
  - Ziel: Sichtbares „REC"-Badge + Onboarding-Hinweis, dass Mitschnitt
    erfolgt; Privacy-Page-Link.
  - Betroffene Dateien: `apps/web/src/components/robot-view/*`,
    `apps/web/src/app/robot/[slug]/page.tsx`.
  - Akzeptanz: Bei aktivem `Robot.recordSessions` ist Banner präsent.
  - Aufwand: klein.

- [ ] **Field-Level-Validation in Login/Reset/Register**
  - Priorität: P2
  - Kategorie: UX
  - Problem: `apps/web/src/app/login/page.tsx` zeigt nur globalen
    `error`-String.
  - Ziel: Inline-Fehler an Email/Password/Username, Submit-Button-State.
  - Aufwand: klein.

- [x] **Empty-State auf Explore wenn keine Roboter**
  - Priorität: P2
  - Kategorie: UX (Prüfpunkt)
  - Problem: Bei leerer DB unklar, was die Seite zeigt.
  - Ziel: Hilfreiche CTA-Karten („Robot anlegen", „Doku lesen").
  - Aufwand: klein.

- [ ] **Onboarding-Tutorial nach Account-Erstellung**
  - Priorität: P2
  - Kategorie: UX / Produkt
  - Problem: Operator wird auf `/explore` geworfen; kein Hinweis „Erstelle
    deinen ersten Robot".
  - Ziel: Conditional-Banner, wenn 0 Robots im Besitz.
  - Aufwand: klein.

- [x] **Search/Filter sichtbar im UI**
  - Priorität: P2
  - Kategorie: UX (Prüfpunkt)
  - Umsetzung: `apps/web/src/app/explore/explore-filters.tsx` rendert
    Suchfeld + Status-/Sort-Selects + Tag-Übernahme + „Clear filters" und
    schreibt Suchparameter über `router.replace`. URL-Query (`q`, `status`,
    `sort`, `tag`) wird an `/api/v1/robots` weitergereicht.

### Feature / Produkt

- [ ] **Pricing-/Credits-Seite**
  - Priorität: P1
  - Kategorie: Feature / Produkt
  - Problem: `CREDIT_PACKAGES` API existiert, aber öffentliche Pricing-
    Seite fehlt.
  - Ziel: `/pricing` oder Sektion auf `/wallet` mit Pakete + Stripe/PayPal-
    Buttons.
  - Aufwand: mittel.

- [ ] **Admin-UI für Webhook-Events**
  - Priorität: P3
  - Kategorie: Feature
  - Problem: `BillingWebhookEvent` und `RobotWebhook` werden DB-seitig
    gepflegt, aber kein Mod-UI sichtbar.
  - Ziel: Liste/Replay-Funktion in `/mod/payouts` oder neuer Mod-Subroute.
  - Aufwand: mittel.

- [ ] **Subscription/Recurring-Plan**
  - Priorität: P3
  - Kategorie: Feature
  - Problem: Nur Einmal-Käufe. Subscriptions vermutlich gewünscht.
  - Aufwand: groß.

- [ ] **i18n-Foundation (Next.js i18n routing)**
  - Priorität: P3
  - Kategorie: Feature
  - Aufwand: groß.

### Performance

- [x] **Public-Overview-Cache durch Redis**
  - Priorität: P2
  - Kategorie: Performance (Prüfpunkt)
  - Umsetzung: `RobotPublicOverviewService` cached die aggregierte Antwort
    im Redis-Key `robots:public-overview` mit 30 s TTL und liest Cache
    zuerst. Bei JSON-Parse-Fehler wird der Eintrag selbstheilend gelöscht
    und neu berechnet.

- [x] **Bundle-Analyzer + Asset-Budget**
  - Priorität: P2
  - Kategorie: Performance
  - Umsetzung: `@next/bundle-analyzer` als devDependency hinzugefügt;
    `apps/web/next.config.ts` aktiviert ihn lazy bei `ANALYZE=true`. Neuer
    Script `pnpm --filter @botparty/web analyze` produziert einen Report
    unter `.next/analyze/`.

- [x] **Cursor-basierte Chat-Pagination**
  - Priorität: P2
  - Kategorie: Performance
  - Umsetzung: `getChatHistoryPage` (in `robot-room-state.helper.ts`) sortiert
    jetzt stabil nach `(createdAt desc, id desc)` und akzeptiert zusätzlich
    `beforeId` als Tie-Breaker. `ChatHistoryPage` liefert `nextCursor` und
    `nextCursorId`; `GetChatHistoryDto` plus REST-Controller geben den
    `beforeId`-Parameter durch. Web-Client (`use-robot-view-state.ts`,
    `apps/web/src/lib/api/robots.ts`, `RobotChatHistoryPage`) speichert und
    sendet den Cursor-Id-Wert beim Nachladen älterer Nachrichten — keine
    Duplikate mehr bei gleicher Millisekunde. Bestandstests grün
    (`robots.service.spec.ts`, `room.handler.spec.ts`). Back-compat:
    `before` (ms) bleibt funktional, `beforeId` ist optional.

### Doku / Compliance

- [ ] **Datenfluss-Beschreibung für DSGVO**
  - Priorität: P1
  - Kategorie: Compliance
  - Problem: Privacy-Seite ist generisch.
  - Ziel: Kapitel mit Tabelle „Datum → Zweck → Speicherort → Aufbewahrung".
  - Aufwand: mittel.

- [x] **Vollständige `.env.example`**
  - Priorität: P1
  - Kategorie: Doku
  - Aufwand: klein.

- [x] **Production-Migrationsanleitung**
  - Priorität: P1
  - Kategorie: Doku
  - Umsetzung: Abschnitt „Production Migration Procedure" in
    `docs/runbook.md` (Backup → `migrate deploy` → Verify → Rollback).

- [ ] **AGB/Refund-Policy-Templates**
  - Priorität: P2
  - Kategorie: Compliance
  - Problem: Terms-Seite existiert als Skeleton.
  - Ziel: Bezahlrelevante Inhalte (Widerruf, Lieferung digitale Produkte,
    Refund-Bedingungen) — als Vorlage, nicht als Rechtsrat.
  - Aufwand: mittel.

- [x] **OpenAPI-Drift-Check fixt-laufen lassen**
  - Priorität: P3
  - Kategorie: Doku (Prüfpunkt)
  - Umsetzung: `.github/workflows/ci.yml` Build-Job exportiert
    `docs/openapi.json` mit `node apps/api/dist/openapi/export-openapi.js`
    und schlägt mit `git diff --exit-code` fehl, falls die Datei nicht
    aktualisiert wurde. Artefakt wird hochgeladen. Dependabot ist auf
    `npm`/`docker`/`github-actions` aktiviert (`.github/dependabot.yml`).

### Sonstige Prüfpunkte (kein bestätigter Bug)

- [ ] Tatsächliche Reichweite der Account-Löschung (alle abhängigen Tabellen,
  Recordings im Bucket).
- [ ] Zeit- und Zonen-Logik für `Robot.scheduleStart/scheduleEnd` (`timezone`-
  Feld vorhanden, UI/Service-Verhalten verifizieren).
- [ ] Mail-Templates auf XSS-Sicherheit (variable Inhalte, HTML-Encoding).
- [ ] `WEBHOOK_SECRET_ENCRYPTION_KEY` Defaultverhalten in Production:
  Bootguard?
- [ ] `gateway-rate-limit.ts` (23 LOC): Reichweite, Bypass-Möglichkeit.
- [ ] Verhalten bei Abbruch/Disconnect des Robot-Clients während aktiver
  Recording-Egress (Egress wird gestoppt? Recording-File konsistent?).
- [ ] Mod-Audit-Log Aufbewahrung/Pruning (kein TTL erkannt).
- [ ] `Transaction`-Typen `BUTTON_SPEND`, `BUTTON_PAYOUT`, `DONATION_*`
  laufen sauber durch `ledgerGroupId`-Saldo-Check (Tests vorhanden, aber
  Production-Reconciliation-Job?).
- [ ] Service-Worker-Strategie (Cache-Invalidation bei Deploy).

---

## Abschlussbewertung

- **Ist das Projekt aktuell release-ready?**
  **Teilweise.** Für eine Self-Hosted Beta in technisch versierten Händen
  ist BotParty bereits sehr nahe am Release. Für ein zahlungspflichtiges,
  öffentliches Angebot fehlen einige Sicherheits-, Compliance- und
  Operability-Bausteine.

- **Wichtigste 5 Blocker**
  1. CSP-Inkonsistenz und unsichere Direktiven (Helmet/nginx/next.config),
     `unsafe-eval`/`unsafe-inline` und permissive `connect-src`.
  2. `prisma db push` statt `migrate deploy` in Production.
  3. Bezahl-/Webhook-ENV unvollständig dokumentiert und ohne Boot-Validierung.
  4. `LIVEKIT_API_KEY=devkey` als kopierbarer Default und fehlende
     Bootguard-Bann-Liste.
  5. Fehlende DSGVO-Datenflussdoku und sichtbarer Recording-Hinweis im UI.

- **Wichtigste 5 Verbesserungen mit höchstem Impact**
  1. Konsolidierte CSP + HSTS + Header-Hygiene über alle Layer.
  2. Production-Migrations + Release-Workflow + Image-Push.
  3. Lasttest-Pipeline (Realtime SLA messen) und Cross-Instance-Test.
  4. Refactor der drei größten Services (Wartungsgewinn, Test-Coverage).
  5. Pricing-Seite + AGB/Refund-Vorlagen → Bezahlweg „erlebt sich rund".

- **Empfohlene nächste Schritte**
  1. P0-Pakete (Security-Headers, Bezahl-ENV-Doku, LiveKit-Default-Guard,
     Migration-Strategie, Recording-UI-Hinweis) als ein Sprint.
  2. P1-Pakete (Node-Drift, Pricing-Seite, IP-Rate-Limit, Logout-überall,
     E2E-Determinismus, DSGVO-Doku) als zweiter Sprint.
  3. Refactor- und Test-Investments in laufenden Sprints einplanen
     (P2-Backlog).
  4. Erste Public-Beta erst nach P0+P1 ausrollen, mit Monitoring-Alarmen
     scharfgeschaltet (cAdvisor + Prom + optional Loki/Sentry).
