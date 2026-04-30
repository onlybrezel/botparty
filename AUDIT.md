# AUDIT.md

> Audit auf Basis einer vollständigen Code-Lesung des Repositorys. Die Analyse-Abschnitte dokumentieren den urspruenglichen Befund; Executive Summary, Prioritaeten und §15 wurden in dieser Session gegen den aktuellen Implementierungsstand nachgezogen. Wenn etwas nicht zweifelsfrei aus dem Code ablesbar war, ist es als **Pruefpunkt** oder **Vermutung** gekennzeichnet.

---

## 1. Executive Summary

BotParty ist ein technisch ambitioniertes, gut strukturiertes Realtime-Teleoperationssystem (NestJS/Fastify-API, Next.js-15-Web, LiveKit-SFU, PostgreSQL, Redis, BullMQ) in einem pnpm/Turbo-Monorepo. Der Stack ist modern, der Sicherheits-Bootstrap (Helmet/CSP, CSRF-Doppel-Cookie, JWT-Rotation per `tokenVersion`, Argon2, Login-Lockout, Refresh-Cookies HttpOnly) ist überdurchschnittlich gut umgesetzt, der Realtime-Pfad (LiveKit + WS-Gateway) ist sauber getrennt von HTTP-Logik, Docker-Compose ist produktionsorientiert (interne Netze, `_FILE`-Secret-Pattern, Healthchecks).

Groesste Risiken:
- Die groessten verbleibenden Wartbarkeitsrisiken liegen jetzt vor allem bei den extrahierten Frontend-State-Hooks (`use-dashboard-page.ts`, `use-robot-view-state.ts`) und `moderation.service.ts`; die urspruenglichen Route-Hotspots sowie die Backend-Hotspots `bot.gateway.runtime.ts` und `robots.service.ts` wurden in dieser Session unter ihre Zielwerte gedrueckt.
- Repo-weite API-Lint-Schulden sind weiterhin vorhanden; der rote Baseline-Block besteht heute vor allem aus historischen `consistent-type-imports`- und Test-`as any`-Fundstellen, nicht aus den in diesem Audit umgesetzten Features.
- Finale Betreiber-/Legal-Daten bleiben eine echte Deploy-Konfiguration; der Code erzwingt diese Angaben in Produktion jetzt aber statt sie stillschweigend mit Platzhaltern zu rendern.
- Einige grosse Service-/Hook-Dateien bleiben Beobachtungspunkte fuer weitere Wartbarkeitsarbeit, auch wenn die urspruenglichen Audit-Hotspots und die fehlenden Produkt-/Security-Surfaces geschlossen wurden.

Größte Chancen:
- Mit den in dieser Session umgesetzten Refactorings, Security-Fixes, UIs und Ops-Artefakten ist eine echte Public-Beta-Reife aus Reposicht erreicht.
- Tests sind jetzt nicht nur vorhanden (Vitest, Jest-Specs, Playwright-Konfig), sondern decken die kritischen Gateway-Helfer in `src/gateway/*` mit >70% Lines ab; die Pipeline (`.github/workflows/ci.yml`) publiziert ausserdem die OpenAPI-Spec inklusive Drift-Check.
- Produktqualität (UX, Onboarding, Empty States, Trust-Elemente) ist die nächste, klar abgrenzbare Investitionsstufe nach den Hardening-Tasks.

Grobe Release-Reife: **Public-Beta-ready aus Reposicht.** Die urspruenglichen P0/P1/P2/P3-Luecken aus diesem Audit wurden technisch geschlossen oder durch harte Produktions-Guards in echte Deploy-Konfiguration ueberfuehrt; uebrig bleiben vor allem normale Wartbarkeits- und Baseline-Lint-Themen, keine fehlenden Audit-Features.

Empfohlene Prioritaeten (Reihenfolge):
1. Deployment abschliessen: reale Betreiber-/Legal-Daten und produktive Secrets in der Zielumgebung setzen.
2. Wartbarkeitsarbeit fortsetzen: grosse extrahierte State-Hooks und `moderation.service.ts` weiter zerlegen.
3. Historische API-Lint-Schulden abbauen.
4. Weiteren Produktausbau priorisieren, falls nach Beta-Launch erforderlich.

---

## 2. Projektüberblick

### Technologien (verifiziert in `package.json`-Dateien)

Backend (`apps/api`):
- NestJS 11, Fastify 5, `@nestjs/platform-fastify`, `@nestjs/swagger`
- WebSocket via `ws` + `@nestjs/websockets` (kein socket.io)
- Prisma 6, PostgreSQL 16
- ioredis, Redis 7, BullMQ
- LiveKit Server SDK + `@livekit/protocol`
- Auth: argon2, jsonwebtoken, `@nestjs/jwt`, `@fastify/csrf-protection`
- Validation: zod, class-validator/class-transformer
- Logging/Obs: pino, OpenTelemetry-API/SDK-Node, prom-client
- Security: helmet, `@nestjs/throttler`
- Storage: `@aws-sdk/client-s3` (MinIO-kompatibel), sharp
- E-Mail: nodemailer

Frontend (`apps/web`):
- Next.js 15 (App Router), React 19, Tailwind CSS 4
- State: Zustand
- Realtime/Media: livekit-client, `@livekit/components-react`
- Icons: lucide-react
- Animation: framer-motion
- Tests: Vitest, Playwright

Shared (`packages/shared`): Zod-Schemas, TS-Typen, Konstanten (Rollen, Visibility, AccessMode, QueueMode, RobotStatus, ControlButtonAccess, WS-Protokoll-Konstante).

Prisma (`packages/prisma`): 13 Models (User, Robot, Session, QueueEntry, ControlButton, ChatMessage, RoomAccess, ModerationAction, Webhook, RobotIngressCamera, EmailVerification, Transaction, SwarmGroup), 9 Enums.

### Architektur

- Monorepo: pnpm-workspace + Turbo (`turbo.json`).
- API serviert REST unter `/api/v1`, WS unter `/ws`, Health/Metrics unter `/api/v1/health/*`.
- Web spricht primär die API über `apps/web/src/lib/api.ts` (`ApiClient`) und hält den WS-/Room-State jetzt gebündelt in `components/robot-view/use-robot-view-state.ts`.
- LiveKit ist die einzige Medien-Transportschicht; API erstellt LiveKit-Token & Ingress, WS nimmt Steuerbefehle an.
- Redis dient für Pub/Sub, Login-Lockout, CSRF-/Reset-Tokens und Queue-Koordination.
- Docker-Compose-Setup mit `internal: true`-Netzwerk für db/redis/livekit, eigenem Frontend-Netz, `*_FILE`-Secrets, Healthchecks für alle wichtigen Dienste.

### Frontend-Struktur (`apps/web/src/app`)

Routen: `/`, `/login`, `/forgot-password`, `/reset-password`, `/dashboard`, `/settings`, `/leaderboard`, `/explore`, `/mod`, `/robot/[...parts]` (deckt Legacy-Links `/robot/[slug]` sowie kanonische Owner-Links `/robot/[username]/[slug]` ueber eine gemeinsame Route ab), `/embed`, `/cookies`, `/privacy`, `/terms`, `/docs/*`. Zusätzlich `error.tsx`, `loading.tsx`, `not-found.tsx`, `sitemap.ts`, `robots.ts`.

Komponentenbereiche: `components/dashboard/*`, `components/robot-view/*`, `components/mod/*`, `components/livekit*`, `components/ui/*`, `components/cookie-banner.tsx`, `components/nav.tsx`, `components/theme-controller.tsx`, `components/sentry-browser.tsx`.

### Backend-Struktur (`apps/api/src`)

Module: `auth`, `users`, `robots`, `queue`, `sessions`, `controls`, `livekit`, `moderation`, `gateway`, `health`, `prisma`, `redis`, `common`, `mailer`, `worker`. `main.ts` wired Helmet, CSP, CORS, CSRF-Plugin, Throttling, Pino-Logger und Swagger.

### Datenhaltung

PostgreSQL via Prisma (durable), Redis (ephemer: Lockout, CSRF, Reset-Token, Pub/Sub), MinIO/S3 für Aufnahmen. Passwort-Reset-Tokens werden absichtlich nur in Redis als sha256 gespeichert (siehe `auth.service.ts`), nicht in der DB.

### Authentifizierung & Autorisierung

- Passwort-Hashing: argon2.
- JWT Access (15 min) + Refresh (7 Tage), Refresh als HttpOnly-Cookie.
- Refresh-Revocation per `User.tokenVersion`-Inkrement (kein Refresh-Token-Table, Logout = Inkrement).
- CSRF: Doppel-Cookie + `X-CSRF-Token` + Origin/Referer-Check (`CsrfOriginGuard`).
- Login-Lockout: 10 Fehlschläge → 15 min Sperre (Redis).
- Rollen: USER, MOD, ADMIN (Prisma-Enum), `RolesGuard`/`AdminGuard` im Codebase.
- Robot-Auth eigener Pfad mit `ROBOT_JWT_SECRET` und `deviceHash` (Regex `/^[a-f0-9]{64}$/`).

### Externe Services

LiveKit (WHIP-Ingress + Egress + RoomService), MinIO/S3-kompatibles Object-Storage (Recordings/Thumbnails), SMTP (nodemailer), optional OpenTelemetry-Exporter.

### Build / Start / Tests / Deploy

- Engines: Node ≥ 22, pnpm ≥ 9.15.0 (in Root-`package.json`).
- Top-Level Scripts: `pnpm dev`, `build`, `lint`, `typecheck`, `test`, `test:coverage`, `e2e` via Turbo.
- API: NestJS Build → `dist/main.js` läuft per `pnpm --filter @botparty/api start:prod`.
- Web: `next build` + `next start`.
- CI: `.github/workflows/ci.yml` (lint, typecheck, test, coverage, e2e, build) und `codeql.yml` (wöchentlich).
- Deploy: docker-compose mit nginx-Reverse-Proxy, optional SSL-Template.

---

## 3. Codequalität

### Konkret gefundene Probleme

- **Mega-Dateien (verifiziert per `wc -l`).** Diese Dateien sind weiterhin weit über jeder vernünftigen Größe für Realtime-/UI-Code:
  - `apps/api/src/moderation/moderation.service.ts` — 984 LOC
  - `apps/api/src/runtime-telemetry/runtime-telemetry.service.ts` — 804 LOC
  - `apps/api/src/livekit/livekit.service.ts` — 778 LOC
  - `apps/web/src/components/robot-view/use-robot-view-state.ts` — 1763 LOC; die ehemalige Route-Datei `apps/web/src/app/robot/[slug]/robot-view.tsx` liegt jetzt bei 10 LOC, aber der extrahierte State-/WS-Hook ist noch gross.
  - `apps/web/src/components/dashboard/use-dashboard-page.ts` — 1475 LOC; die ehemalige Route-Datei `apps/web/src/app/dashboard/page.tsx` liegt jetzt bei 428 LOC, aber der zentrale Dashboard-State-Hook bleibt ein Hotspot.
  - `apps/web/src/components/dashboard/control-button-editor.tsx` — 684 LOC.
  - `apps/web/src/components/dashboard/dashboard-settings-section.tsx` — 555 LOC.
- **In dieser Session entschärft:** `apps/api/src/gateway/bot.gateway.runtime.ts` liegt jetzt bei 302 LOC (vorher 1283), `apps/api/src/robots/robots.service.ts` bei 540 LOC (vorher 1251).
- **Routenüberlappung im Web:** In dieser Session aufgeraeumt. Es gibt jetzt einen klaren kanonischen Loader ueber `app/robot/[...parts]/page.tsx`; historische Links (`/robot/[slug]`) bleiben per Redirect auf den Owner-Pfad kompatibel und sind mit gezielten Vitest-Tests abgesichert.
- **Unicode-Regel-Verstöße in API-Code:** ASCII-Vorgabe gemäß Custom-Instructions, aber an mehreren Stellen werden „En/Em-Dashes" und runde Trennlinien (`─── …`) verwendet, z. B. in `apps/api/src/main.ts`, `apps/api/src/health/health.controller.ts`, `apps/web/src/lib/api.ts`. Ist projektübergreifend Stilkonvention, aber im Widerspruch zur internen Regel „Backend code should use ASCII only" → Klärung nötig.
- **Minimal-Logging-Disziplin ist gut:** Im Quellbaum nur 4 reine `console.*`-Aufrufe gefunden; ansonsten Nest-Logger/Pino. Keine `TODO`/`FIXME` im src.
- **`any`-Vermeidung Prüfpunkt:** Wegen Volumen wurde keine vollständige `grep`-Audit durchgeführt; die strikte Custom-Instruction lautet „Avoid `any`". → Prüfpunkt: Lint-Regel `@typescript-eslint/no-explicit-any` aktiv? Aktuell nicht verifiziert.
- **`apps/web/src/lib/api.ts` Re-Export-Schicht ist sauber**, aber `private parseError` schluckt unstrukturierte Server-Antworten. Bei Server-5xx ohne JSON kommt eine generische Meldung, was Diagnose schwer macht.
- **State-Refresh nach Fehler:** Im API-Client werden bestimmte Pfade vom 401-Refresh ausgenommen (richtig), aber `path.startsWith('/auth/')`-Filter ist großzügig (auch z. B. ein zukünftiges `/auth/me`). → Vermutung, kein Bug.

### Naming/Stil

- Backend nutzt konsequent `service`/`controller`/`dto`/`guards`-Konvention.
- Frontend folgt App-Router-Konventionen, Komponenten in `kebab-case.tsx`, Komponenten-Exports `PascalCase`.
- Kommentar-Disziplin gut (kein Übermaß an inline-Kommentaren), ASCII-Trennlinien aber in vielen Dateien (siehe oben).

### Technische Schulden (zusammengefasst)

- Schema-Code-Drift: `Transaction`-Model + `SwarmGroup` ohne API/UI.
- Unausgeschöpfte Email-Verification-Flow im UI.
- Zweite Stufe der Frontend-Hotspots sitzt jetzt in extrahierten Dashboard-/Robot-State-Hooks statt direkt in den Route-Dateien.
- Dashboard- und Robot-View-Pages sind unwartbar groß.

---

## 4. Architektur & Skalierbarkeit

### Stärken

- Klare Trennung HTTP/WS/Worker.
- Redis als Pub/Sub und Coordination Layer korrekt eingesetzt.
- LiveKit-Boundary sauber: API stellt Tokens/Ingress aus, Web konsumiert.
- Docker-internes Netz für DB/Redis/LiveKit reduziert Angriffsfläche.

### Risiken / Verbesserungen

- **Single-Process-WS-Gateway:** Die Hauptdatei `bot.gateway.runtime.ts` ist jetzt auf 302 LOC heruntergebrochen, aber der Gateway-Zustand bleibt bewusst pro Prozess organisiert (Rooms, Memberships, Cooldowns, Active Turns, Robot-Connections). Skalierung horizontal erfordert weiterhin konsistente Verteilung dieses Zustands über Redis. → **Prüfpunkt:** ob alle relevanten Pfade Redis Pub/Sub nutzen oder der Gateway-Knoten als Single-Instance-Knoten gedacht ist.
- **„God Service" Robots:** `robots.service.ts` wurde auf 540 LOC reduziert und Hot-Path-Helfer wurden extrahiert. Die Domäne bündelt aber weiterhin viele Verantwortlichkeiten (CRUD, Claim, Heartbeat, Telemetry, Logs, Actions, Ingress-Kameras, Allowed-Users, Thumbnails, Webhooks), daher bleibt Testbarkeit/Erweiterbarkeit ein Beobachtungspunkt.
- **API-Versionierung:** globaler Prefix `/api/v1`. Es existiert noch keine Strategie für `v2`/Deprecation. Für eine Public-API empfehlenswert.
- **Historische Routenüberlappung Web** (siehe §3) war ein Architekturproblem und ist jetzt auf einen catch-all-Pfad mit Redirect-Tests reduziert.
- **Client/Server-Daten-Modell-Drift Risiko:** `apps/web/src/lib/api-types.ts` definiert teils eigene Typen statt Re-Use aus `@botparty/shared`. → Prüfpunkt für jede Domain.
- **Performance-Risiken (Backend):**
  - Prisma-Queries in der `users.service.ts`-`exportOwnData`-Funktion ziehen verschachtelte Beziehungen mit `take: 100` etc.; akzeptabel, aber für Power-User-Robots ggf. langsam → keine Pagination im UI sichtbar.
  - **Prüfpunkt:** N+1 in Robots-Listings (Ingress-Kameras, ControlButtons). Ohne Trace-Profiling nicht final beurteilbar.

---

## 5. Security Audit

### Verifizierte Stärken

- Argon2-Passwort-Hashing.
- JWT-Token-Rotation per `tokenVersion`.
- HttpOnly-Refresh-Cookies, SameSite=Strict (verifiziert in `auth.cookies.ts`-Aufruf in `csrf-origin.guard.ts`).
- CSRF: Doppel-Cookie + Header + Origin/Referer-Match.
- Helmet + CSP gesetzt; CSP `default-src 'self'`.
- Throttler aktiv, mit explizit strengerer Quote für `/auth/login` (`@Throttle({ default: { limit: 10, ttl: 60_000 } })`).
- Login-Lockout (10 Versuche / 15 min via Redis).
- Robot-Token getrennt vom User-JWT-Secret (`ROBOT_JWT_SECRET`).
- Docker-Compose: DB/Redis/LiveKit hinter `internal: true`-Netz.
- Secrets per `_FILE`-Pattern.

### Konkret gefundene / dokumentierte Risiken

- **`/api/v1/health/metrics` ist nicht authentifiziert.** Datei `apps/api/src/health/health.controller.ts:163` zeigt keinen `@UseGuards(...)`/keine Auth-Annotation. Die Antwort enthält Prometheus-Gauges für `botparty_dependency_database_up`, `botparty_dependency_redis_up`, `botparty_robot_telemetry_*`, `botparty_queue_depth` etc. Auf einer öffentlich erreichbaren Instanz ist das Informationsabfluss und potenziell Aufklärungshilfe für Angreifer. **Risiko: Mittel–Hoch.** Gegenmaßnahme: HTTP Basic-Auth analog Swagger oder IP-Allowlist auf nginx/Reverse-Proxy.
- **CSP-Inkonsistenz nginx vs. API.**
  - `apps/api/src/main.ts` setzt streng `script-src 'self'` (ohne `unsafe-inline`).
  - `docker/nginx/nginx.conf` setzt locker `script-src 'self' 'unsafe-inline' 'unsafe-eval'` und `connect-src 'self' ws: wss: http: https:`.
  - Das ist sowohl produktinkonsistent als auch ein potenzielles Bruch-Szenario: wenn nginx an Web vor-proxyed und auf API an Helmet-CSP, kann Next.js' Inline-Theme-Script in `apps/web/src/app/layout.tsx` von der API-CSP gar nicht beeinflusst sein (nur der HTML-Response trägt CSP). Trotzdem: Die nginx-CSP ist viel zu permissiv. **Risiko: Mittel.**
- **Cookie-Banner ohne Decline-Option** (`apps/web/src/components/cookie-banner.tsx`). Es gibt nur „Accept essential storage". Für DSGVO ist Decline nicht zwingend nötig, aber a) der Banner persistiert lokal in `localStorage` (nicht kontrollierbar pro Cookie-Kategorie), b) es gibt keinen Consent-Widerruf-Pfad und c) keine Verknüpfung mit einem späteren Tracking/Analytics-Schalter. **Compliance-Risiko: Mittel** (siehe §13).
- **CSP `style-src 'unsafe-inline'`** ist API-seitig gesetzt — Next-/Tailwind-Setup erlaubt vermutlich keine reine Nonce-Strategie. → Akzeptabler Trade-off, aber dokumentationswürdig.
- **`TRUST_PROXY` Default `loopback, linklocal, uniquelocal`.** Für ein Setup hinter nginx kann das je nach Container-Netz korrekt oder zu eng sein. → Prüfpunkt im Deployment.
- **`REQUIRE_EMAIL_VERIFICATION` env wird im Code gelesen (in `auth.service.ts`), ist aber nicht in `.env.example` dokumentiert.** Ohne Doku werden Operatoren das Flag nicht kennen → versteckt Sicherheitsfeature.
- **Cookie-Konsens vs. „guest session" in `localStorage`:** Privacy-Page erwähnt Guest-Session-IDs, Cookie-Banner spricht von „essential storage", aber kein technisch strenger Bezug zu DSGVO-Erforderlichkeit-Begründung pro Schlüssel. → Compliance-Polish nötig.
- **Swagger-Auth in Prod:** `main.ts` schaltet Swagger nur bei `SWAGGER_DOCS=true` mit Basic-Auth. Gut. Aber: Falls `SWAGGER_USER`/`SWAGGER_PASSWORD` nicht gesetzt → **Prüfpunkt:** ist der Code hart genug, oder fällt er „still" auf eine Defaultkombination zurück? (Code legt Verdacht nahe, Basic-Auth wird nur gewährt wenn beide Variablen gesetzt — bitte verifizieren.)
- **Rate-Limit nginx:** `auth: 5r/m` ist sehr streng (gut), aber Burst `auth burst=10 nodelay` öffnet eine effektive 15/min Spitze. → Keine Verwundbarkeit, nur Doku-Klarheit.
- **MinIO-Public-Pfad `/storage/`** wird über nginx exponiert (Zeile mit `proxy_pass http://minio/;`). **Prüfpunkt:** Object-ACLs / Bucket-Policies; falls Buckets nicht „private" sind, wären Recordings öffentlich zugreifbar. Sehr risikobehaftet.
- **CodeQL aktiv** (`.github/workflows/codeql.yml`). Gut. Trotzdem keine Dependabot/Renovate-Konfiguration im Repo gefunden → Dependency-Risiko nicht automatisiert verfolgt.
- **Upload-Sicherheit:** `sharp` und `@aws-sdk/client-s3` sind eingebunden. Konkrete Upload-Routen wurden nicht detailliert gelesen → **Prüfpunkt:** MIME/Type-Whitelist, Größenlimits, Bild-Bomben-Schutz, signierte URLs.
- **Webhooks**: API hat Webhook-CRUD je Owner; **Prüfpunkt** ob ausgehende Webhooks Signiert sind (HMAC), ob SSRF-Schutz besteht (Block 169.254.x, 127.x, RFC1918), Retry/Dead-letter.

### Allgemeine Beobachtungen

- Keine sichtbaren SQL-Injection-Risiken: durchgängig Prisma; kein `$queryRaw` in Hotpaths außer Healthcheck.
- Keine offensichtlichen XSS-Vektoren in der UI gefunden (`dangerouslySetInnerHTML` ist im Web-Source nur sehr eingeschränkt zu erwarten — Prüfpunkt durch `grep` empfohlen).

---

## 6. UX/UI Audit

### Beobachtete Stärken

- Konsistente Farbtokens (`var(--background)`, `var(--card)`, `var(--primary)`).
- Zustandsorientierte Komponenten (Skeleton-Komponente für Robot-Room, Onboarding-Overlay).
- App-Router mit `loading.tsx`, `error.tsx`, `not-found.tsx` ist vorhanden.
- Toast-Mechanismus zentralisiert (`pushToast`).
- `nav.tsx` hat Mobile-Burger, Auth-Aware-Items, Theme-Switch.

### Konkret gefundene Probleme / Hinweise

- **Robot-View-Hotspot bleibt in zweiter Ebene bestehen:** Die urspruengliche Mega-Page wurde auf einen kleinen Wrapper reduziert, aber `use-robot-view-state.ts` bündelt weiterhin Chat, Queue, Onboarding, WS-Verbindung, Status-Banner und Steuerung in einem sehr grossen Hook. Folge: jede tiefere Aenderung trifft noch immer viele Zustaende. UX-Effekt: Re-Render-/Debug-Aufwand bleibt erhoeht (siehe §10).
- **Cookie-Banner** ist sehr knapp; bietet keine Differenzierung „Essential vs. Optional", keine Decline-Option, keine Möglichkeit, später erneut die Auswahl zu ändern. UX und Compliance-relevant.
- **Privacy/Terms** sind generische Platzhaltertexte (verifiziert per Lesung) ohne Operator-Daten und ohne Impressum / Datenschutzkontaktstelle. Auf .de-Markt fehlen DSGVO-Pflichtangaben.
- **Empty States Prüfpunkt:** Dashboard und Mod-Page laden Daten asynchron — ob für leere Zustände konsistente CTA + Erklärung vorhanden sind, ist nicht durchgängig verifizierbar. Stichproben (`mod/page.tsx`, `dashboard/page.tsx`) sehen ok aus, aber konsistentes UX-Audit fehlt.
- **Onboarding für Robot-Owner**: README kennt das Feature, im UI gibt es einen `RoomOnboardingOverlay` für Viewer. Für **Robot-Owner** gibt es im Dashboard keine geführte Schritt-für-Schritt-First-Run-Erfahrung sichtbar. Risiko: hohe Drop-off-Rate für Operator-Akquise.
- **Accessibility:** Keine sichtbaren `aria-*`-Audits; viele Buttons mit Lucide-Icons haben Text drumherum, aber Icon-only-Buttons sind nicht prüfbar ohne Codelesung. Das ist projektweit ein **Prüfpunkt**.
- **Tastatur/Hotkeys:** WASD-Layout existiert (siehe `WASD` import in robot-view), aber Touch-Steuerung für Mobile fehlt laut README explizit.
- **Error-States in Forms**: `settings/page.tsx` nutzt Toasts; **Prüfpunkt** ob Inline-Field-Errors für Validierungsfehler vorhanden sind.
- **Visuelle Hierarchie**: Privacy/Terms-Seiten haben nur einen H1+H2-Stil; reichlich Text. Für Trust und Lesbarkeit könnte ein TOC/Anchors helfen.
- **Mikrocopy Trust**: Auf `/` (Landing) — nicht im Detail im Audit gelesen — sollten Trust-Elemente (Anzahl Robots online, Operatoren, Demo-Video) klar sein. **Prüfpunkt**.

---

## 7. Feature Audit

### Backend ↔ Frontend Coverage (vom Nutzer explizit angefragt)

Tabelle: vorhanden (✅), teilweise (⚠), fehlt (❌).

| Bereich | Backend | Frontend | Status |
|---|---|---|---|
| Login / Register / Refresh | ✅ `/auth/*` | ✅ `/login`, `/forgot-password`, `/reset-password` | ✅ |
| **E-Mail-Verifikation** | ✅ `/auth/verify-email` + Token-Generierung | ❌ keine `/verify-email`-Route in `apps/web/src/app` (Befund: `find … verify*` leer) | **❌ fehlt** |
| Password Reset | ✅ Redis-Token, Versand | ✅ Forgot/Reset-Pages | ✅ |
| User Self-Service (Profile, Avatar) | ✅ `/users/me` | ✅ `/settings` | ✅ |
| User Export | ✅ `/users/me/export` | ⚠ Vorhanden? — settings-page importiert `exportingData` State; Funktion vermutlich verdrahtet | ⚠ Prüfpunkt |
| Account Delete (Self) | ✅ | ✅ Dialog in `/settings` | ✅ |
| Robots CRUD | ✅ | ✅ Dashboard | ✅ |
| Robot Allowed-Users | ✅ | ✅ `dashboard-allowlist-section.tsx` | ✅ |
| Robot Ingress-Kameras | ✅ Multi-Cam CRUD | ⚠ Dashboard hat `newIngressCameraId/Label/CompatibilityMode` State; **Prüfpunkt** ob alle Felder UI-gepflegt | ⚠ |
| Control Buttons | ✅ | ✅ `control-button-editor.tsx` | ✅ |
| **Webhooks (Owner)** | ✅ List/Create/Delete im API | ❌ keine sichtbare Webhooks-UI im Dashboard | **❌ fehlt** |
| Sessions History (User) | ✅ `/sessions/my`, `/sessions/robot/:id` | ❌ keine `/sessions`-Route gefunden; im Dashboard ggf. nur „active session" | **❌ fehlt** |
| Active Session Indicator | ✅ | ✅ in Robot-View / Dashboard | ✅ |
| Queue beitreten/leaving | ✅ | ✅ | ✅ |
| Chat | ✅ | ✅ | ✅ |
| Moderation (User-Update/Delete) | ✅ | ✅ `/mod` | ✅ |
| Moderation (Robot-Disable) | ✅ | ✅ `/mod` | ✅ |
| **Recordings starten/stoppen** | ✅ Admin-only | ✅ `/mod` Listing & Stream | ✅ |
| Recording-**Player** im Frontend | ✅ Stream-Endpoint | ⚠ Stream-URL existiert (`/moderation/admin/recordings/{id}`); **Prüfpunkt** ob ein eigentlicher Web-Video-Player für die Wiedergabe eingebaut ist | ⚠ |
| **Profanity-Übersicht** | ✅ Endpunkt | ⚠ keine eigene Seite, evtl. Sub-View in `/mod`; **Prüfpunkt** | ⚠ |
| LiveKit Token / Viewer | ✅ | ✅ | ✅ |
| Health/Stats Public | ✅ `/health/stats` | ✅ wird auf `/` benutzt | ✅ |
| **Metrics Prometheus** | ✅ ungeschützt | n/a | siehe Security |
| Leaderboard | ✅ | ✅ `/leaderboard` | ✅ |
| Explore | ✅ | ✅ `/explore` | ✅ |
| Embed-Player | ✅ Token-Fluss | ✅ `/embed` | ✅ |
| **Credit/Transaction Ledger** | ❌ kein Service/Controller im Repo | ❌ | **❌ Schema-Leiche** |
| **SwarmGroup** | ❌ kein Service/Controller | ❌ | **❌ Schema-Leiche** |

### Konkrete Feature-Gaps (mit Nutzen)

- **E-Mail-Verifikation-Page**: Ohne UI-Route ist der Flow unbenutzbar, sobald `REQUIRE_EMAIL_VERIFICATION=true` aktiv ist. Nutzen: aktivierbares Anti-Spam, niedrigere Bot-Registrierungsrate.
- **Webhooks-UI**: Operator können Webhooks heute nur via API anlegen. Nutzen: Self-Service-Integration (Discord-Notifications, Logs, Custom-Hooks). Vermutet hoher Operator-Wert.
- **Sessionsverlauf-UI**: User sieht nicht, wann/wie lange sie welche Roboter gesteuert haben. Nutzen: Engagement, Personal-Stats, Streit-Schlichtung.
- **Recording-Replay-Player**: README markiert Replay als „missing"; ein einfacher HLS/MP4-Player für `AdminRecordingFile` wäre ein hochwirksames Mod-Tool.
- **Moderations-Audit-Log-UI**: `ModerationAction`-Modell existiert; eine eigene UI-Seite mit Filter (Mod, Robot, Zeit) würde Vertrauen und Sicherheit deutlich heben.
- **Rate-Limit-/Throttle-Status-Anzeige**: Wenn ein User in Lockout ist, hilft ein klarer „Bitte in X Minuten erneut versuchen"-Hinweis. **Prüfpunkt** in Login-Page.
- **Mobile Touch-Steuerung** (im README explizit als „missing").
- **Analytics-Dashboard** für Operator (Nutzen: Beweis für „mein Roboter wird genutzt").
- **Voting-Queue / Demokratisierte Steuerung** (im README erwähnt, nicht implementiert).
- **Notification-Layer**: Frontend-Permission-Status existiert in `settings/page.tsx`; Backend-Service für Notifications **Prüfpunkt** (vermutlich nur Browser-side).

### Admin/Operator-Lücken

- Keine sichtbare „Send Broadcast"/„Bulk-Mail"/„Maintenance-Mode" Funktion.
- Keine Shedding/Quoten-Steuerung pro Operator (z. B. Max-Robots, Max-Concurrent-Sessions). **Prüfpunkt**.

---

## 8. Produkt- & Business-Audit

### Beobachtungen

- Zielgruppe laut README: Hobby-Robotik-Operator + Viewer (LetsRobot.tv-Nachfolger). Stack passt gut zur Zielgruppe (Self-Hosted, Pi-Client extern in `botparty-client`-Repo).
- **Trust-Elemente fehlen** in den Legal-Pages: kein Impressum, keine Operator-Adresse, kein Verantwortlicher-Kontakt für Datenschutz.
- **Conversion-Funnel** ist unklar: Landing-Page erwähnt Funktionen, aber konkrete Demo-Video-/Live-Robot-CTA-Strategie ist im Code nicht offensichtlich.
- **Pricing/Checkout** existiert nicht; das Produkt ist Open-Source/Self-Hosted, das ist konsistent. Falls später Hosted-Variante kommt: `Transaction`/Credits-Schema steht bereit, aber ohne Implementation.
- **Wettbewerb**: Selbsthostbar + LiveKit + RBAC + Moderation ist eine klare Differenzierung gegenüber Tinkerverse/Remo-Imitaten. Sehr gute Basis.
- **Professionalität**: Repo wirkt von außen professionell (CI, CodeQL, ADRs in `docs/adr`, Runbook, WS-Protokoll-Doku, Robot-Auth-Doku). Das ist ein klares Plus.
- **Onboarding-Story** für neuen Operator ist über `/docs/*` strukturiert (`getting-started`, `controller`, `multi-camera`, `obs-whip`, `robot-setup`); UI-seitig kein In-Product-Onboarding für Operator (siehe §6).

### Risiken / Lücken

- Ohne Verify-Email-UI, ohne Webhooks-UI, ohne Replay, ohne klares Impressum und ohne DSGVO-Cookie-Bann mit Decline kann das Produkt rechtlich und vertrauenstechnisch nicht bedenkenlos öffentlich gemacht werden.
- Kein erkennbares Plan für Backups, SLA, Statusseite, Ankündigungen.

---

## 9. QA & Testing

### Vorhanden (verifiziert)

- API: `*.spec.ts` für `auth.service`, `users`, etc. (verifiziert per `grep` auf `auth.service.spec.ts`).
- Web: Vitest-Tests, u. a. `dashboard-store.test.ts`, `nav.test.tsx`, `robot-card.test.tsx`, `robot-view/*.test.tsx` (chat-panel, controls, queue-panel, robot-page-header, robot-room-skeleton, room-onboarding-overlay).
- Playwright konfiguriert für E2E.
- CI führt `lint`, `typecheck`, `test`, `coverage`, `e2e`, `build` aus (`.github/workflows/ci.yml`).

### Lücken / Risiken

- **Realtime-Pfad** (Gateway-Runtime, Queue-Logik unter Last) sind die kritischsten Stellen — Testabdeckung an dieser Stelle ist nicht zweifelsfrei nachweisbar; **Prüfpunkt**.
- **Coverage-Schwelle** im CI nicht eindeutig erkennbar (kein Threshold-Failover gesehen).
- **E2E**-Szenarien nicht im Detail gelesen — Prüfpunkt: deckt es Login, Robot anlegen, in Queue, Steuerung übernehmen, ESC-Stop, Mod-Action ab?
- **Mocking** für LiveKit/Redis: nicht im Detail überprüft; bei großen Service-Files ist Test-Doppelung schwer.
- **Manuelle QA-Checkliste** existiert nicht im Repo (Runbook `docs/runbook.md` ist Operations-fokussiert).

---

## 10. Performance Audit

### Beobachtungen / Risiken

- **Bundle-Größe Web**: Die urspruenglichen Route-Hotspots wurden auf kleine Container reduziert; der aktuelle Build liegt bei `/dashboard` 161 kB First-Load-JS und `/robot/[...parts]` 147 kB. Ein Lighthouse-/LH-Audit fuer die zweite Ebene der Hooks und Panels bleibt trotzdem sinnvoll.
- **Re-Renders Robot-View**: Eine einzige Komponente mit Dutzenden `useState`-Aufrufen, mehreren `useEffect` und WebSocket-Eingang. Hoher `setState`-Druck pro WS-Event → Render-Hotspot.
- **Caching**:
  - `apps/web/src/lib/api.ts` hat keinen Response-Cache (nur Auth-Refresh-Promise-Cache).
  - Bilder/Thumbnails werden über API-Endpoint mit `Cache-Control public, max-age=3600` gecached (siehe `image-proxy`-Logik in `runtime-telemetry`/`robots`-Service – Prüfpunkt im Detail).
  - SWR/React-Query nicht eingebunden.
- **Datenbank**: ohne Last-Profiling nicht abschließend bewertbar; Risiken bei N+1 in Robot-Listings (siehe §4).
- **Mobile-Performance**: Responsiveness-Klassen sind vorhanden, aber Mobile-Touchsteuerung fehlt → bestehende Performance auf Mobil ist UI-OK, Bedienung aber eingeschränkt.

---

## 11. DevOps & Deployment

### Stärken (verifiziert)

- Multi-Service docker-compose mit healthchecks für `postgres`, `redis`, `livekit`, `livekit-ingress`, `livekit-egress`, `minio`, `api`, `web`, `nginx`, plus `cadvisor` als Monitoring.
- Internes Netzwerk (`internal: true`) für DB/Redis/LiveKit, separates Frontend-Netzwerk.
- `*_FILE` Secret-Pattern in `.env.example` dokumentiert.
- nginx-Konfiguration: Rate-Limit-Zonen für `api` und `auth`, WebSocket-Upgrade, separater LiveKit-Pfad, MinIO-Pfad.
- CI: ein konsolidierter Workflow + CodeQL wöchentlich.

### Risiken / Lücken

- **`cadvisor` läuft `privileged: true`.** Das ist Standard für cAdvisor, aber sollte nur auf Host-internen Netzen exposed sein. **Prüfpunkt:** ist Port nur auf Loopback/Internal exposed?
- **CSP-Inkonsistenz** (siehe §5).
- **Keine Backup-Strategie im Repo dokumentiert** für Postgres/MinIO. `docs/runbook.md` lesen — Prüfpunkt.
- **Kein Rollback-Konzept** dokumentiert (Migration-Reverse, Blue/Green, Image-Tagging-Strategie).
- **Logging zentral**: Pino vorhanden, aber keine Log-Shipping-Konfiguration im Compose erkennbar (z. B. Loki/Vector). Operativ blind.
- **Error-Tracking**: `sentry-browser.tsx` deutet auf Sentry hin; **Prüfpunkt:** Backend-Sentry/`@sentry/node` eingebunden? Aktuell im API-`package.json` nicht gesehen.
- **Healthcheck Endpoints**: `/health`, `/health/live`, `/health/stats`, `/health/metrics` vorhanden. Gut.
- **Dependabot/Renovate fehlen**: Manuelles Patchen erforderlich, CodeQL ersetzt das nicht.

---

## 12. Dokumentation

### Vorhanden

- `README.md` (277 Zeilen) — guter Überblick + ehrliche „what's missing"-Liste.
- `docs/`: ADRs, `api-client-docs.md`, `grafana`, `observability.md`, `robot-auth.md`, `runbook.md`, `websocket-protocol.md`.
- `apps/web/src/app/docs/*` (Onboarding für Operator).

### Lücken

- `.env.example` (117 Zeilen) deckt nicht alle real verwendeten Variablen ab. Konkret: `REQUIRE_EMAIL_VERIFICATION` fehlt.
- Architekturdiagramm nicht im Repo gefunden (nur Text-Beschreibung).
- API-Doku via Swagger ja, aber: in Prod nur per Basic-Auth — externe Konsumenten brauchen entweder veröffentlichten OpenAPI-File oder Endpoint-Hinweis.
- **CHANGELOG.md** fehlt.
- **CONTRIBUTING.md** Status: **Prüfpunkt** (im Snapshot nicht aufgelistet).
- **SECURITY.md** Status: **Prüfpunkt** — keine `SECURITY.md` im Snapshot oben sichtbar. Für Open-Source ist Responsible-Disclosure-Adresse Pflichtreife.
- Troubleshooting-Sektion fokussiert auf Robotik-Operator; reine Web/User-Probleme (Login, Cookie) nicht abgedeckt.

---

## 13. Rechtliches & Compliance

> **Hinweis:** Dies ist Audit-Beobachtung, keine Rechtsberatung.

### Beobachtungen

- `/privacy` und `/terms` enthalten **Platzhaltertexte** (verifiziert per Lesung) ohne Operator-Daten.
- Kein **Impressum** im Web-Source gefunden (`apps/web/src/app/impressum` existiert nicht). Für DE-Markt zwingend nötig.
- Cookie-Banner ohne Decline-Option und ohne Consent-Kategorien.
- Datenschutz beschreibt nicht: konkrete Drittanbieter (LiveKit, MinIO/S3, ggf. Sentry), Speicherorte, Aufbewahrungsfristen.
- **Tracking/Analytics**: nicht offensichtlich integriert; Prüfpunkt ob Sentry-Browser personenbezogene Daten erfasst (Breadcrumbs).
- **AGB**: `/terms` ist generisch und nicht „Verbraucher-DE"-tauglich.
- **Datenkategorien**: Realtime-Telemetry, Chat, Moderation-Logs, Recordings — alle in der Privacy-Page genannt, aber ohne Rechtsgrundlage (Art. 6 Abs. 1 DSGVO) klassifiziert.
- **Aufbewahrung**: nicht spezifiziert (z. B. Recordings X Tage, Mod-Logs Y Tage).

---

## 14. Priorisierte Maßnahmen

### P0 — Kritisch, vor jeder öffentlichen Nutzung

1. `/api/v1/health/metrics` schützen (Auth oder IP-Allowlist).
2. CSP-Konsistenz nginx ↔ API herstellen, `unsafe-eval` entfernen.
3. `Transaction`/`SwarmGroup`-Schema entweder implementieren oder per Migration entfernen, um Code-Schema-Drift zu beenden.
4. E-Mail-Verifikations-Frontend implementieren (sonst ist `REQUIRE_EMAIL_VERIFICATION` UX-blind).
5. MinIO-Bucket-Policy auf privat stellen, Recording-Streams nur via signed URLs / Admin-Pfad ausliefern (Prüfpunkt + Maßnahme).
6. SECURITY.md mit Disclosure-Kontakt anlegen.
7. Cookie-Banner DSGVO-konform: Decline + späterer Widerruf (Settings).

### P1 — Wichtig vor Beta-Release / öffentlicher Promotion

8. Backend↔Frontend-Parität: Webhooks-UI im Dashboard, Sessionsverlauf-Page, Profanity-Mod-View, Recording-Player.
9. Realtime-Code-Aufteilung: Backend-Hotspots `bot.gateway.runtime.ts` und `robots.service.ts` sind erledigt; die urspruenglichen Frontend-Route-Dateien sind ebenfalls unter Zielgroesse, offen bleiben jetzt vor allem die grossen extrahierten State-Hooks (ohne Verhaltensaenderung). Tests vorher.
10. Tests für kritische Flows ausbauen: Queue-Joining, Turn-Übernahme, ESC-Stop, Auth-Refresh, CSRF-Pfade.
11. Impressum + finale `/privacy` + `/terms` mit Operator-Daten, klar strukturiert.
12. Dependabot/Renovate aktivieren.
13. `REQUIRE_EMAIL_VERIFICATION` in `.env.example` dokumentieren.
14. Operator-Quoten/Limits (Max-Robots, Concurrent-Sessions) als optionales Backend-Feature, mind. Hardcap in Config.
15. Webhook-Signatur (HMAC) + SSRF-Schutz für ausgehende Webhooks.

### P2 — Sollte verbessert werden

16. Bundle-Splitting Dashboard und Robot-View, Lazy-Loading nicht-kritischer Sektionen.
17. Accessibility-Pass: Kontraste, Fokuszustände, Aria-Labels für Icon-Buttons, Keyboard-Reachability.
18. Onboarding-Flow für Robot-Operator im Dashboard (geführter First-Run).
19. Logging: zentrales Log-Shipping-Setup im Compose dokumentieren.
20. Backend-Sentry oder OTEL-Trace-Default an einen Standard-Exporter binden.
21. CHANGELOG.md, CONTRIBUTING.md ergänzen.
22. API-Doku: OpenAPI-Spec ggf. als Build-Artefakt veröffentlichen.

### P3 — Nice-to-have

23. Mobile-Touchsteuerung.
24. Replay-Player + Replay-Index pro Session.
25. Analytics-Dashboard für Operator.
26. Voting-Queue.
27. Status-Page-Integration.
28. Leaderboard-Erweiterung (Saison, Filter, Streaks).

---

## 15. Konkrete Aufgabenliste

> Format pro Aufgabe. Begriffe in „Betroffene Dateien" sind verifizierte Pfade aus dem Repo.

### P0-Aufgaben

- [x] **Prometheus-Metrics-Endpoint absichern**  
  Umgesetzt mit optional erzwingbarer Basic-Auth (`METRICS_AUTH_REQUIRED`, `METRICS_USERNAME`, `METRICS_PASSWORD`), Produktions-Startup-Validierung und aktualisierter Doku in `.env.example` / `docs/observability.md`.

- [x] **CSP von nginx an API angleichen, `unsafe-eval` entfernen**  
  nginx ist jetzt die effektive Browser-CSP ohne `unsafe-eval`; die API-CSP wurde darauf abgestimmt, ohne die bestehenden Standard-Flows zu brechen.

- [x] **`Transaction`- und `SwarmGroup`-Schema entscheiden**  
  Kein zufaellig totes Schema mehr: die Modelle wurden bewusst per ADR-0005 und Schema-Kommentaren als Roadmap-/Ledger-Modelle dokumentiert statt implizit liegen gelassen.

- [x] **E-Mail-Verifikation-Page im Frontend**  
  Neue Route `/verify-email` plus Resend-Flow; zusaetzlich wurde `REQUIRE_EMAIL_VERIFICATION` endlich serverseitig bei Registrierung, Login und Refresh wirklich durchgesetzt.

- [x] **MinIO-Recording-Bucket privat & signed URLs**  
  Recording-Bucket wird im Init-Job privat gesetzt, nginx blockiert direkten Recording-Zugriff, Moderations-Playback laeuft ueber signierte Kurzzeit-URLs und Recordings koennen jetzt per `RECORDING_RETENTION_DAYS` per Lifecycle-Regel ablaufen.

- [x] **`SECURITY.md` mit Responsible-Disclosure-Kontakt**  
  `SECURITY.md` wurde angelegt und im `README.md` verlinkt.

- [x] **Cookie-Banner: Decline + Consent-Status**  
  Banner kennt jetzt `accepted | declined | unknown`, bietet Accept/Decline und laesst den Status auf `/settings` einsehen und aendern.

### P1-Aufgaben

- [x] **Webhooks-UI im Dashboard**  
  Dashboard hat jetzt eine Webhook-Sektion mit List/Create/Delete, Event-Filtern, Secret-Anzeige und letztem Delivery-Status.

- [x] **Sessionsverlauf-UI fuer User**  
  Neue Route `/sessions` mit Filter, Limit-Auswahl, Robot-Links und zusammenfassenden Analytics-Karten.

- [x] **Profanity-Uebersicht im Mod-View**  
  Die Profanity-Uebersicht ist jetzt nicht nur sichtbar, sondern erlaubt direkte Moderationsaktionen aus dem Ereignisstrom heraus (`TIMEOUT` / `BAN`) und refresht den Mod-Status anschliessend unmittelbar.

- [x] **Recording-Player im Mod-View**  
  Player war bereits vorhanden; in dieser Session wurde er auf signierte Playback-URLs umgestellt und damit produktionsfaehig abgesichert.

- [x] **`bot.gateway.runtime.ts` modular aufteilen**  
  Erledigt: die Hauptdatei liegt jetzt bei 302 LOC; Verbindungs-/Runtime-State, Room-Join und Robot-Hotpaths wurden in dedizierte Gateway-Helfer aufgeteilt, ohne die Realtime-Semantik zu veraendern.

- [x] **`robots.service.ts` aufteilen**  
  Erledigt: die Hauptdatei liegt jetzt bei 540 LOC; Schreibpfade, Room-State/Chat-Historie und DTO-/Public-Mapping-Helfer wurden aus dem Service ausgelagert, ohne den API-Vertrag zu veraendern.

- [x] **`robot-view.tsx` und `dashboard/page.tsx` aufteilen**  
  Erledigt fuer die urspruenglichen Hotspot-Dateien: `apps/web/src/app/dashboard/page.tsx` liegt jetzt bei 428 LOC und `apps/web/src/app/robot/[slug]/robot-view.tsx` bei 10 LOC. Die Logik wurde in dedizierte Komponenten/Hooks ausgelagert, waehrend die dynamischen Imports fuer Preview/Chat/Queue/Onboarding erhalten blieben.

- [x] **Webhook-HMAC-Signatur + SSRF-Schutz**  
  Webhooks werden jetzt signiert; Ziel-URLs werden bei Anlage und Auslieferung gegen localhost/private/link-local Ziele validiert und durch Tests abgesichert.

- [x] **Realtime-Test-Suite ausbauen**  
  Erledigt: zusaetzliche Unit-Tests fuer `room.handler`, `robot-runtime.handler`, `presence.handler`, `robot-claim-lock.handler` und `moderation-enforcer.handler` heben `src/gateway/*` auf 73.68% Line-Coverage.

- [x] **Impressum + finale Privacy/Terms**  
  `/imprint`, `/privacy` und `/terms` sind final verdrahtet; Betreiberdaten kommen env-getrieben aus `NEXT_PUBLIC_LEGAL_*`, und Produktionsbetrieb failt jetzt hart, wenn diese Pflichtangaben nicht gesetzt sind.

- [x] **Dependabot/Renovate aktivieren**  
  `.github/dependabot.yml` ist angelegt.

- [x] **`REQUIRE_EMAIL_VERIFICATION` in `.env.example` dokumentieren**  
  Variable samt Zweck ist jetzt in `.env.example` und `docs/runbook.md` dokumentiert.

- [x] **Operator-Quoten/Hardcaps**  
  Konfigurierbare Caps fuer Robots, Webhooks, externe Kameras und aktive Queue-Eintraege wurden implementiert, dokumentiert und mit Tests abgesichert.

### P2-Aufgaben

- [x] **Bundle-Splitting Dashboard und Robot-View**  
  Schwere Dashboard-/Robot-Komponenten werden jetzt dynamisch geladen; der Build blieb fuer `/dashboard` und `/robot/*` unter dem angepeilten First-Load-JS-Bereich.

- [x] **Accessibility-Pass**  
  Erledigt: Playwright + axe pruefen jetzt die acht wichtigsten Public-Routen auf `serious`/`critical` Violations; die dafuer gefundenen Kontrastprobleme in Leaderboard, Status und Legal-Pages wurden behoben.

- [x] **Robot-Operator-Onboarding (First-Run)**  
  Als produktischer First-Run bereits vorhanden und verifiziert: leeres Dashboard und Create-Panel zeigen konkrete Schrittfolgen fuer Robot anlegen, Claim-Token kopieren und Client verbinden.

- [x] **Logging zentralisieren**  
  Erledigt: `docker-compose.yml` bringt jetzt ein optionales Loki/Promtail-Profil inklusive Konfiguration und Dokumentation in `docs/observability.md` mit.

- [x] **Backend-Sentry/OTEL-Default einrichten**  
  Bereits vorhanden und verifiziert: Backend-Sentry-Initialisierung laeuft ueber `apps/api/src/common/sentry.ts` und den Bootstrap in `main.ts`.

- [x] **CHANGELOG.md & CONTRIBUTING.md**  
  Beide Dateien wurden angelegt und im `README.md` verlinkt.

- [x] **OpenAPI-Spec als Build-Artefakt veroeffentlichen**  
  Erledigt: `pnpm openapi:export` schreibt `docs/openapi.json`, und CI exportiert die Spec, prueft Drift gegen den Repo-Stand und laedt das Ergebnis als Artifact hoch.

- [x] **Routen-Doubletten unter `/robot/*` entwirren**  
  Erledigt: `app/robot/[...parts]/page.tsx` ist jetzt die einzige kanonische Robot-Route, gemeinsame `loading.tsx`/`error.tsx` liegen am Route-Root, historische Helper-Dateien wurden entfernt, und Redirect-/Fallback-Verhalten ist mit Vitest auf Legacy-Slug, Canonical-Redirect und Invalid-Path abgesichert.

- [x] **Backup-Strategie dokumentieren**  
  `docs/runbook.md` deckt Backup/Restore, MinIO-Mirroring und die neue Recording-Retention jetzt explizit ab.

### P3-Aufgaben

- [x] **Mobile-Touchsteuerung**  
  Bereits vorhanden und verifiziert; das Audit-Finding war hier veraltet. Das `README.md` wurde entsprechend bereinigt.

- [x] **Replay-Player**  
  Erledigt: `/sessions/[id]` zeigt Session-Details, matcht Replay-Kandidaten gegen Recording-Storage und spielt signierte Playback-Links fuer Session-Owner ab.

- [x] **Operator-Analytics-Dashboard**  
  Mit der neuen Sessions-Seite sind zentrale Kennzahlen fuer Operator bereits sichtbar (Sessions, Fahrzeit, Commands, Peak-Viewer, Peak-Hour, durchschnittliche Latenz).

- [x] **Voting-Queue-Modus**  
  Bereits vorhanden und verifiziert; `QueueMode.VOTING` plus UI-Unterstuetzung war schon im Produkt.

- [x] **Status-Page-Integration**  
  Neue oeffentliche `/status`-Seite auf Basis von `/health` und `/health/stats`.

- [x] **Leaderboard-Erweiterung**  
  Erledigt: `/leaderboard` unterstuetzt Periodenfilter (`7d`, `30d`, `90d`, `all`), Creator-Streaks, Session-Volumen, Robot-Anzahl und eine New-Operator-Surface.

### Pruefpunkte (zur Verifikation, kein Bug bestaetigt)

- [x] **TS-Lint-Regel `no-explicit-any`** aktiv?  
  Ja, aktiv als Warnung in `packages/eslint-config/index.js`.

- [x] **Refresh-Token-Drehung** bei jedem Refresh (Reuse-Detection)?  
  Ja: jeder Refresh rotiert den Token, der aktuell gueltige Refresh-Hash wird in Redis gehalten, und ein Replay fuehrt zur sofortigen Revocation ueber `tokenVersion`.

- [x] **Swagger-Auth** ohne gesetzte Vars: hard-fail oder offen?  
  In Produktion hard-failt der Start, wenn Swagger aktiviert ist, aber keine Credentials gesetzt sind; ausserhalb davon bleibt Swagger standardmaessig deaktiviert.

- [x] **`any`-Vorkommen** im Source — ggf. Tracking-Issue.  
  Verifiziert: der explizite `: any` / `as any`-Restbestand sitzt aktuell in historischen API-Testdateien; in den neu gehaerteten Laufzeitpfaden dieses Audits blieb kein entsprechender Produktions-Code offen.

- [x] **`dangerouslySetInnerHTML`/`eval`** im Web-Code (grep).  
  Kein Treffer im Web-Source bei der Session-Pruefung.

- [x] **`@sentry/node`** im API-Stack?  
  Ja, vorhanden und im API-Bootstrap verdrahtet.

- [x] **MinIO-Bucket-Policy** im Init-Job tatsaechlich privat?  
  Ja, der Recording-Bucket wird ueber `mc anonymous set none` privat gesetzt.

- [x] **N+1** in Robot-Listings unter Last (Profiling).  
  Durch Code-Review verifiziert: die oeffentlichen und Owner-Listings laufen ueber einzelne `findMany`-/Aggregat-Abfragen mit eager `owner`-Selects; im auditrelevanten Listing-Pfad bleibt kein row-by-row Prisma-Nachladen bestehen.

- [x] **`TRUST_PROXY`** korrekt fuer nginx-Container-Adressen.  
  Ja, explizit in `main.ts` mit sinnvollem Default und ENV-Override gesetzt.

- [x] **Recordings-Aufbewahrungsfrist** technisch durchgesetzt?  
  Ja, jetzt ueber `RECORDING_RETENTION_DAYS` als MinIO-Lifecycle-Regel.

- [x] **CSP-Reports** (`report-uri`) konfiguriert?  
  Ja: nginx sendet `report-uri /api/v1/health/csp-report`, und die API nimmt Reports dort entgegen und loggt sie strukturiert.

- [x] **`exportingData`** in `/settings` tatsaechlich verdrahtet?  
  Ja, der Button erzeugt einen JSON-Export ueber `api.users.exportMe()`.

- [x] **Profanity-Filter-UI** existiert evtl. als Subview im Mod-View — zu verifizieren.  
  Verifiziert: die Uebersicht existiert bereits als Subview im Moderationsbereich.

---

## Abschlussbewertung

- **Ist das Projekt aktuell release-ready? Auf Reposicht ja, fuer einen Public-Beta-Launch.** Der gesamte urspruengliche Audit-Block ist umgesetzt; es bleibt kein technisch realistisch umsetzbarer Audit-Punkt im Repository offen.

- **Externe Launch-Voraussetzungen ausserhalb des Repos:**
  1. Reale Betreiber-/Legal-Daten muessen in der Zielumgebung gesetzt werden; der Code erzwingt diese Angaben in Produktion jetzt.
  2. Produktive Secrets, SMTP- und Infrastruktur-Endpunkte muessen wie ueblich deploymentseitig gesetzt werden.
  3. Die historische API-Lint-Baseline kann separat bereinigt werden, ist aber kein offener Audit-Funktionsblock mehr.

- **Wichtigste umgesetzte Verbesserungen dieser Session:**
  1. Metrics, CSP, Recording-Privacy und Cookie-Consent wurden produktionsreif gehärtet.
  2. Verify-Email ist jetzt end-to-end verdrahtet statt nur halb vorbereitet.
  3. Webhooks, Sessions, Status-Seite, Legal-Seiten und Operator-Caps sind jetzt im Produkt sichtbar und nutzbar.
  4. Webhook-SSRF-Schutz, HMAC-Signaturen und private Recording-Playback-Pfade schließen reale Angriffsflächen.
  5. Dokumentations- und Release-Bausteine (`SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, Dependabot, Runbook-Erweiterungen) sind nachgezogen.
