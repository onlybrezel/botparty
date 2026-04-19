# BotParty Platform – Vollständiges Projekt-Audit

> **Datum:** 2026-04-17
> **Scope:** Alle drei Repositories – `botparty` (API + Web Monorepo), `botparty-client` (Python Robot Client), `botparty-streamer` (Go Video Streamer)
> **Zweck:** Strukturiertes Audit mit priorisierten Action Items für KI-gestützte Weiterbearbeitung

---

## Inhaltsverzeichnis

1. [Projekt-Übersicht](#1-projekt-übersicht)
2. [Audit: botparty (API + Web Monorepo)](#2-audit-botparty-api--web-monorepo)
3. [Audit: botparty-client (Python Robot Client)](#3-audit-botparty-client-python-robot-client)
4. [Audit: botparty-streamer (Go Video Streamer)](#4-audit-botparty-streamer-go-video-streamer)
5. [Priorisierte Gesamtliste aller offenen Punkte](#5-priorisierte-gesamtliste-aller-offenen-punkte)
6. [Konkrete Action Items](#6-konkrete-action-items)

---

## 1. Projekt-Übersicht

| Projekt | Sprache | Framework | LoC (ca.) | Zweck |
|---|---|---|---|---|
| `botparty` (API) | TypeScript | NestJS + Fastify | ~13.300 | REST API, WebSocket Gateway, Auth, Queue, Moderation |
| `botparty` (Web) | TypeScript/React | Next.js 15 + Tailwind | ~17.100 | Frontend: Homepage, Dashboard, Robot-View, Explore |
| `botparty` (Packages) | TypeScript | Prisma, Zod, shared types | ~2.000 | Geteilte Schemas, DB-Schema, ESLint/TS-Configs |
| `botparty-client` | Python 3.10+ | aiohttp, LiveKit SDK, Pydantic | ~7.650 | Robot-Hardware-Client: Kamera, Steuerung, TTS |
| `botparty-streamer` | Go 1.24 | LiveKit Server SDK, pion/webrtc | ~1.890 | Low-Latency H.264 Video-Publisher für LiveKit |

### Architektur-Überblick

```
┌─────────────┐     ┌────────────┐     ┌─────────────────┐
│   Browser    │◄───►│   nginx    │◄───►│  Next.js (Web)  │
│  (Viewer)    │     │  (reverse  │     │  (SSR + Client) │
└──────┬───────┘     │   proxy)   │     └────────┬────────┘
       │             └─────┬──────┘              │
       │ WebSocket         │ HTTP                │ SSR fetch
       ▼                   ▼                     ▼
┌──────────────────────────────────────────────────┐
│              NestJS API (Fastify)                 │
│  Auth │ Robots │ Queue │ Sessions │ Moderation    │
│  WebSocket Gateway (ws)  │  Health │ Controls     │
└───┬──────────┬───────────┬───────────────────────┘
    │          │           │
    ▼          ▼           ▼
┌────────┐ ┌───────┐ ┌──────────┐
│Postgres│ │ Redis │ │ LiveKit  │
│  (DB)  │ │(Cache)│ │  (SFU)   │
└────────┘ └───────┘ └────┬─────┘
                          │
               ┌──────────┴──────────┐
               │                     │
    ┌──────────┴─────┐    ┌──────────┴──────┐
    │ botparty-client │    │botparty-streamer│
    │  (Python/Robot) │    │   (Go/Video)    │
    │  Hardware + WS  │    │  H.264→LiveKit  │
    └────────────────┘    └─────────────────┘
```

---

## 2. Audit: botparty (API + Web Monorepo)

### 2.1 Codequalität

| Aspekt | Bewertung | Details |
|---|---|---|
| **TypeScript Strictness** | ✅ Gut | `strict: true` in allen tsconfigs |
| **Linting** | ✅ Gut | ESLint konfiguriert, Prettier vorhanden, CI prüft |
| **Validation** | ✅ Gut | Zod-Schemas im shared-Package, NestJS `ValidationPipe` mit `whitelist + forbidNonWhitelisted` |
| **Modularität (API)** | ⚠️ Mittel | Feature-Module gut getrennt, aber `robots.service.ts` ist ein God Object (1.532 Zeilen, ~47 KB). `bot.gateway.runtime.ts` ebenso (1.539 Zeilen, ~52 KB) |
| **Modularität (Web)** | ✅ Gut | API-Client sauber in Sub-Module aufgeteilt (AuthApi, RobotsApi, etc.). Zustand-Store minimal |
| **Fehlerbehandlung** | ✅ Gut | Globaler `AllExceptionsFilter`, konsistente NestJS-Exceptions |
| **Code-Duplikation** | ⚠️ Mittel | `updateByStaff` vs `update` in robots.service.ts haben erhebliche Duplikation. Metadata-Parsing wiederholt sich |
| **Type Safety** | ⚠️ Mittel | Häufige `as`-Casts auf `metadata` (JSON-Spalte). Kein runtime-validiertes Schema für Robot-Metadata |

**Befunde:**

- **B-API-01** (P2): `robots.service.ts` ist mit 1.532 Zeilen ein God Object. Verantwortlichkeiten: CRUD, Slug-Management, Profanity-Filter, Access-Policy, Stream-Policy, Thumbnails, Chat, Telemetry, Invite-Codes, Device-Binding, Actions. Sollte in ≤5 fokussierte Services aufgeteilt werden.
- **B-API-02** (P2): `bot.gateway.runtime.ts` ist mit 1.539 Zeilen ebenfalls zu groß. Turn-Handling, Chat, Control-Forwarding, Presence-Management und Redis pub/sub sind vermischt. Die Handler-Extraktion (PresenceHandler, TurnHandler, etc.) ist begonnen aber unvollständig.
- **B-API-03** (P3): `metadata`-Feld der Robot-Tabelle ist `Json` (Prisma) — kein Zod-Schema zur Laufzeit-Validierung. Typisierung über `as`-Casts ist fehleranfällig.
- **B-API-04** (P3): `updateByStaff()` dupliziert ~80% der Logik von `update()`. Refactoring in gemeinsame private Methode sinnvoll.
- **B-WEB-01** (P3): API-Client-Klasse hat ~70 Flat-Method-Delegations (Zeilen 233–304), die nur an Sub-Module weiterleiten. Kann durch direkten Zugriff auf `api.robots.xyz()` ersetzt werden.

---

### 2.2 Architektur

| Aspekt | Bewertung | Details |
|---|---|---|
| **Monorepo-Setup** | ✅ Gut | Turborepo + pnpm workspaces, saubere Package-Grenzen |
| **API Framework** | ✅ Gut | NestJS + Fastify (performant), modulare Struktur |
| **WebSocket** | ✅ Gut | Raw `ws` statt socket.io (weniger Overhead), Redis pub/sub für Multi-Instance |
| **Database** | ✅ Gut | Prisma ORM, sauberes Schema mit Indizes, Cascade-Deletes |
| **Caching** | ⚠️ Mittel | Redis für Session-State, aber kein systematisches Cache-Invalidation-Pattern |
| **Multi-Instance** | ⚠️ Mittel | Redis pub/sub für Cross-Instance-Events vorhanden, aber Claim-Lock nur soft (TTL-basiert) |
| **Frontend State** | ✅ Gut | Zustand für Auth-State, sessionStorage-Persistenz, Cross-Tab-Logout |

**Befunde:**

- **B-ARCH-01** (P2): Kein Message-Queue-System (z.B. BullMQ). Webhook-Delivery, Email-Versand, Chat-Persistence laufen fire-and-forget mit `.catch()`. Bei Last-Spitzen gehen Events verloren.
- **B-ARCH-02** (P2): Keine DB-Migrations vorhanden — nur `prisma db push`. Für Production fehlt ein reversibles Migrations-System (`prisma migrate deploy`).
- **B-ARCH-03** (P3): WebSocket-Gateway speichert alle State (rooms, activeTurns, turnTimeouts, controlCooldowns) in-memory. Bei Restart geht alles verloren. Reconciliation bei Startup (`endAllActiveSessions`) ist ein Workaround.
- **B-ARCH-04** (P3): Kein API-Versionierung-Konzept über `/api/v1` hinaus. Breaking Changes haben keinen Migrationspfad.
- **B-ARCH-05** (P3): Frontend fetcht SSR-seitig mit `fetch()` direkt — kein shared API-Client für Server-Components. Fehlerbehandlung ist `catch { return [] }`.

---

### 2.3 Security

| Aspekt | Bewertung | Details |
|---|---|---|
| **Authentication** | ✅ Gut | JWT (access + refresh), Argon2id Hashing, Token-Versioning für Revocation |
| **Authorization** | ✅ Gut | Role-based (ADMIN, MOD, USER), Ownership-Checks, Staff-Guards |
| **Rate Limiting** | ✅ Gut | Global ThrottlerGuard + granulare WS per-Event-Type Limits |
| **CORS** | ✅ Gut | Strict Origin-basiert, konfigurierbar |
| **CSP / Helmet** | ✅ Gut | Helmet mit detaillierter CSP, frame-ancestors: 'none' |
| **Input Validation** | ✅ Gut | Zod-Schemas + NestJS ValidationPipe mit whitelist/forbidNonWhitelisted |
| **CSRF** | ✅ Gut | CSRF-Token-Endpunkt, X-CSRF-Token Header für Auth-Mutations |
| **Secrets** | ✅ Gut | File-backed Secrets Support (_FILE), Startup-Assertions mit Min-Length und Banned-Values |
| **SQL Injection** | ✅ Gut | Prisma ORM, keine Raw-Queries gefunden |
| **Brute Force** | ✅ Gut | Login-Lockout nach 10 Versuchen (15 Min), Redis-basiert |
| **Password Reset** | ✅ Gut | Hash-Token in Redis, Single-Use, TTL |

**Befunde:**

- **B-SEC-01** (P1): `accessToken` wird im Zustand-Store in `sessionStorage` gespeichert. Bei XSS ist der Token direkt auslesbar. Besser: Access-Token nur im Speicher halten, Refresh über HttpOnly-Cookie (ist bereits teilweise implementiert via Cookie-basiertem Refresh).
- **B-SEC-02** (P1): `ROBOT_JWT_SECRET` wird für Robot-Auth-Tokens verwendet, aber es gibt separate `claimToken`-basierte Auth. Diese zwei Authentifizierungs-Pfade sollten klar dokumentiert und das weniger sichere Verfahren phased-out werden.
- **B-SEC-03** (P2): Redis-Healthcheck (`nc -z`) prüft nur TCP-Erreichbarkeit, nicht AUTH. Ein fehlkonfiguriertes Passwort wird erst zur Laufzeit bemerkt.
- **B-SEC-04** (P2): Swagger-Docs sind in Production nur opt-in (`SWAGGER_DOCS=true`), aber der Pfad `/docs` ist nicht hinter Auth. Wenn aktiviert, ist die gesamte API-Dokumentation öffentlich.
- **B-SEC-05** (P2): WebSocket-Verbindungen haben keinen Origin-Check auf Protokollebene. CORS ist nur für HTTP konfiguriert; die WS-CORS-Config in `@WebSocketGateway` wird von `ws` nicht enforced.
- **B-SEC-06** (P3): `cadvisor` läuft mit `privileged: true` — notwendig, aber ein Angriff auf cadvisor gibt vollen Host-Zugriff. Sollte in ein isoliertes Monitoring-Network.
- **B-SEC-07** (P3): Thumbnail-Upload akzeptiert Data-URLs ohne Größenlimit auf Server-Seite. Nur `FASTIFY_BODY_LIMIT` (5 MB) schützt.

---

### 2.4 UX / Nutzerfreundlichkeit

| Aspekt | Bewertung | Details |
|---|---|---|
| **Design System** | ✅ Gut | CSS Custom Properties, Dark-Mode-First, konsistentes Theming |
| **Responsiveness** | ✅ Gut | Mobile-optimierte Layouts, flex/grid-basiert |
| **Navigation** | ✅ Gut | Klar strukturierte Nav mit Auth-State, Mobile-Menu |
| **Robot-View** | ✅ Gut | Live-Video, Chat, Queue, Controls in einer Ansicht |
| **Onboarding** | ⚠️ Mittel | Kein interaktiver Setup-Wizard für Robot-Hosts |
| **Error States** | ⚠️ Mittel | Globaler Error-Boundary, aber wenig kontextuelle Fehlermeldungen |
| **Loading States** | ⚠️ Mittel | Root `loading.tsx` vorhanden, aber keine Skeleton-Screens |
| **Accessibility** | ⚠️ Mittel | Semantisches HTML, aber keine ARIA-Labels auf interaktiven Controls |
| **Internationalisierung** | ❌ Fehlt | Komplett Englisch, kein i18n-Framework |

**Befunde:**

- **B-UX-01** (P2): Kein Onboarding-Flow für neue Robot-Hosts. Nach Login → Dashboard → "Create Robot" gibt es keinen geführten Prozess zum Einrichten des ersten Robots.
- **B-UX-02** (P2): Robot-Controls (`controls.tsx`, 11.8 KB) sind komplex aber haben keine Tastaturnavigation-Hints oder Accessibility-Labels. Screen-Reader-Nutzer können Controls nicht bedienen.
- **B-UX-03** (P2): Keine Skeleton-Loading-States. Beim Navigieren flasht die Seite kurz leer.
- **B-UX-04** (P3): Cookie-Banner vorhanden, aber kein Consent-Management für Analytics/Tracking.
- **B-UX-05** (P3): Kein Dark/Light-Mode-Toggle für User (hardcoded `dark` in `<html>`).
- **B-UX-06** (P3): Explore-Seite hat keine Pagination — nur `limit/offset` Parameter. Bei vielen Robots fehlt Infinite-Scroll oder Load-More.

---

### 2.5 Performance

| Aspekt | Bewertung | Details |
|---|---|---|
| **SSR/ISR** | ✅ Gut | `revalidate: 10` für Homepage, Server-Components |
| **WebSocket Effizienz** | ✅ Gut | Raw `ws`, JSON-Serialisierung, Rate-Limiting per Event-Type |
| **DB Queries** | ⚠️ Mittel | Einige N+1-Muster bei `findAll` mit includes |
| **Caching** | ⚠️ Mittel | `findByIdCached` mit 30s TTL – Einziger Redis-Cache für Robot-Lookups |
| **Bundle Size** | ⚠️ Unbekannt | Keine Bundle-Analyse konfiguriert |
| **Image Optimization** | ⚠️ Mittel | Thumbnails als Data-URLs, keine next/image Optimierung |

**Befunde:**

- **B-PERF-01** (P2): `getPublicOverview()` lädt ALLE public Robots aus der DB, iteriert mehrfach (statusBreakdown, topTags, queueEntries). Bei vielen Robots wird das langsam. Sollte aggregiert/cached werden.
- **B-PERF-02** (P2): WebSocket-Gateway hält alle Clients, Rooms, Active-Turns in Maps im Speicher. Keine Memory-Bounds. Ein DDoS mit vielen Connections kann den Prozess OOM-killen.
- **B-PERF-03** (P3): `findAll` für Robots hat keine DB-Level-Aggregation für viewerCount und Status. Jeder Robot wird einzeln normalisiert.
- **B-PERF-04** (P3): Chat-Persistence ist async-batched (`ChatPersistenceService`), aber Writes gehen direkt in Prisma – kein Bulk-Insert.

---

### 2.6 Dokumentation

| Aspekt | Bewertung | Details |
|---|---|---|
| **README** | ✅ Gut | Umfangreiches README (9.1 KB) mit Setup-Anleitung |
| **API Docs** | ✅ Gut | Swagger/OpenAPI in Dev, Tags für alle Domains |
| **Code Comments** | ⚠️ Mittel | Wichtige Stellen kommentiert, aber Service-Methoden ohne JSDoc |
| **Shared Package** | ✅ Gut | README mit Schema-Dokumentation |
| **Architektur-Docs** | ⚠️ Mittel | Docker-Compose gut kommentiert, aber kein ADR-System |
| **WebSocket Events** | ⚠️ Mittel | `WS_EVENTS` Konstanten im shared-Package, aber kein Protokoll-Dokument |

**Befunde:**

- **B-DOC-01** (P2): Kein WebSocket-Protokoll-Dokument. Die ~20 Events (`room:join`, `robot:claim`, `control:command`, etc.) sind nur im Code definiert. Drittentwickler können das Protokoll nicht nachvollziehen.
- **B-DOC-02** (P3): Keine Architecture Decision Records (ADRs). Design-Entscheidungen (warum `ws` statt socket.io, warum Fastify statt Express, etc.) sind nicht dokumentiert.
- **B-DOC-03** (P3): `.env.example` ist gut gepflegt. Aber einige Variablen (`WEBHOOK_SECRET_ENCRYPTION_KEY`, `ROBOT_STREAM_KEY_MAX_AGE_DAYS`) sind undokumentiert.

---

### 2.7 Testing

| Aspekt | Bewertung | Details |
|---|---|---|
| **API Unit Tests** | ⚠️ Mittel | 8 Spec-Dateien vorhanden: auth, gateway, turn-handler, queue, moderation, robots, env-file, prisma-redis-integration |
| **Web Unit Tests** | ⚠️ Schwach | Nur 3 Tests: `nav.test.tsx`, `robot-card.test.tsx`, `queue-panel.test.tsx` |
| **E2E Tests** | ⚠️ Schwach | Playwright konfiguriert aber `tests/e2e/` Verzeichnis existiert (unbekannter Umfang) |
| **CI Pipeline** | ✅ Gut | GitHub Actions: Lint → Typecheck → Unit Tests → E2E → Build |
| **Test Coverage** | ❌ Fehlt | Kein Coverage-Reporting konfiguriert |

**Befunde:**

- **B-TEST-01** (P1): `robots.service.spec.ts` ist nur 1.218 Bytes — für den größten Service (47 KB) sind das höchstens 2-3 Tests. Kritische Logik (Slug-Management, Access-Policies, Profanity-Filter) ist ungetestet.
- **B-TEST-02** (P2): Kein Test-Coverage-Reporting. Weder in CI noch lokal konfiguriert.
- **B-TEST-03** (P2): WebSocket-Gateway hat einen Spec (`bot.gateway.spec.ts`, 7.3 KB), aber die 1.539-Zeilen-Runtime hat viele ungetestete Pfade.
- **B-TEST-04** (P2): Web-Frontend hat nur 3 Tests für ~17.000 Zeilen Code. Dashboard, Robot-View, Auth-Flows sind ungetestet.
- **B-TEST-05** (P3): Keine Integration-Tests die API + DB + Redis zusammen testen (außer `prisma-redis.integration.spec.ts`).

---

### 2.8 DevOps / Infrastruktur

| Aspekt | Bewertung | Details |
|---|---|---|
| **Docker** | ✅ Gut | Multi-Stage Dockerfiles, Docker-Compose mit Health-Checks |
| **Networking** | ✅ Gut | Internal/Frontend Network-Isolation, DB nicht von außen erreichbar |
| **Setup Script** | ✅ Gut | `setup-env.sh` (13.7 KB) für automatisiertes Environment-Setup |
| **CI/CD** | ⚠️ Mittel | CI vorhanden, aber kein CD (kein automatisches Deployment) |
| **Monitoring** | ⚠️ Mittel | cAdvisor für Container-Metriken, Health-Endpoints, aber kein Prometheus/Grafana |
| **Logging** | ⚠️ Mittel | Pino-Logger mit structured output, Sentry optional — aber kein Log-Aggregation |

**Befunde:**

- **B-OPS-01** (P2): Kein automatisches Deployment (CD). Nur CI ist konfiguriert. Deployment ist manuell.
- **B-OPS-02** (P2): Keine Backup-Strategie für PostgreSQL/Redis dokumentiert.
- **B-OPS-03** (P2): Kein Alerting. Health-Checks existieren, aber niemand wird benachrichtigt wenn ein Service ausfällt.
- **B-OPS-04** (P3): Kein Blue/Green oder Rolling-Deployment-Strategie. `docker compose up` hat Downtime.
- **B-OPS-05** (P3): `docker-compose.dev.yml` existiert separat, aber kein klar dokumentierter Dev vs Prod Workflow.

---

### 2.9 Observability

**Befunde:**

- **B-OBS-01** (P2): Keine strukturierten Metriken (Prometheus-Format) vom API-Server. Nur Health-Endpoints.
- **B-OBS-02** (P2): WebSocket-Verbindungsmetriken (connected clients, rooms, queue depth) sind nur in-memory und nicht exportiert.
- **B-OBS-03** (P3): `x-correlation-id` Header ist implementiert — gutes Foundation, aber kein distributed tracing (kein OpenTelemetry).

---

## 3. Audit: botparty-client (Python Robot Client)

### 3.1 Codequalität

| Aspekt | Bewertung | Details |
|---|---|---|
| **Type Hints** | ✅ Gut | `py.typed` Marker, Pydantic-Models, MyPy strict |
| **Linting** | ✅ Gut | Ruff konfiguriert mit umfangreichen Rule-Sets |
| **Modularität** | ✅ Gut | Client aufgeteilt via Mixins (ClientLifecycleMixin, ClientMediaMixin, etc.) |
| **Konfiguration** | ✅ Gut | Pydantic-Config-Models mit Validation |
| **Error Handling** | ⚠️ Mittel | Gateway hat broad `except Exception` catches |
| **Legacy-Compat** | ✅ Gut | Drei sorgfältige Legacy-Config-Adapter für v0.x Configs |

**Befunde:**

- **C-CODE-01** (P2): Mixin-Architektur (`ClientLifecycleMixin`, `ClientOpsMixin`, etc.) ist ungewöhnlich. Alle Mixins greifen auf `self.config`, `self._room`, `self._gateway` etc. zu — keine Interface-Trennung. Diamond-Inheritance-Probleme sind möglich.
- **C-CODE-02** (P3): `client_ops.py` ist mit 27.8 KB sehr groß. Enthält LiveKit-Connection, Camera-Restart, Telemetry-Reporting, Remote-Actions-Handling — zu viele Concerns.
- **C-CODE-03** (P3): `publisher.py` (22 KB) hat sehr viel ffmpeg-Log-Parsing-Logik. Könnte in ein separates Modul extrahiert werden.

### 3.2 Architektur

| Aspekt | Bewertung | Details |
|---|---|---|
| **Hardware-Abstraktion** | ✅ Gut | 20+ Hardware-Adapter (L298N, GoPiGo, Cozmo, NavQ, etc.) mit gemeinsamer Base-Class |
| **Video-Pipeline** | ✅ Gut | Pluggable Video-Profiles (ffmpeg, opencv, botparty_streamer, libcamera) |
| **Gateway** | ✅ Gut | Persistent WebSocket mit Exponential-Backoff-Reconnect |
| **TTS** | ✅ Gut | Pluggable TTS-System (espeak, festival, etc.) |
| **Multi-Camera** | ✅ Gut | Multi-Camera-Support mit Per-Camera Device/Resolution/FPS Override |

**Befunde:**

- **C-ARCH-01** (P2): Client hat keinen Plugin-Loader für Hardware-Adapter. Alle 20+ Adapter sind im Package eingebaut. Nutzer müssen das Projekt forken statt ein Plugin zu installieren (außer `custom.py` + `hardware_custom.py`).
- **C-ARCH-02** (P3): `camera.py` (20.5 KB) managt den OpenCV-basierten Capture-Loop. Eng gekoppelt mit dem Client-Lifecycle.

### 3.3 Security

**Befunde:**

- **C-SEC-01** (P1): `claim_token` wird im Klartext in `config.yaml` gespeichert. Kein Hinweis auf Dateirechtebeschränkung (nur `device_key` bekommt `0o600`).
- **C-SEC-02** (P2): WebSocket-Verbindung zum Gateway sendet `robot_auth_token` als JSON-Payload, nicht als Header. Das Token erscheint in Logs wenn Debug-Logging aktiv ist.
- **C-SEC-03** (P3): `.botparty-device-key` wird automatisch generiert und mit `0o600` geschützt — gut. Aber der Pfad ist hartcodiert im CWD, nicht im Home-Verzeichnis.

### 3.4 Testing

**Befunde:**

- **C-TEST-01** (P2): Nur 4 Test-Dateien für ~7.650 Zeilen Code. Kernlogik (LiveKit-Publishing, Camera-Management, Hardware-Commands) ist ungetestet.
- **C-TEST-02** (P2): Kein CI-Pipeline für botparty-client. Tests laufen nicht automatisch.
- **C-TEST-03** (P3): Kein Mocking-Framework für Hardware-Adapter-Tests konfiguriert.

### 3.5 Performance

**Befunde:**

- **C-PERF-01** (P2): Camera-Capture im OpenCV-Profil erstellt für jeden Frame ein neues aiohttp POST (Thumbnail-Upload). Kein Batching.
- **C-PERF-02** (P3): Gateway-Reconnect hat Exponential-Backoff aber kein Connection-Pooling für aiohttp-Sessions. Neue Session pro Reconnect-Versuch.

### 3.6 Dokumentation

**Befunde:**

- **C-DOC-01** (P2): `config.example.yaml` (11 KB) ist umfangreich, aber die ~20 Hardware-Adapter haben keine individuelle Dokumentation. Nutzer müssen den Source-Code lesen.
- **C-DOC-02** (P3): README ist vorhanden (3.5 KB) mit Setup-Anleitung, aber API-Reference fehlt.
- **C-DOC-03** (P3): Kein Changelog/Release-Notes-System.

### 3.7 Offene Bugs / Technische Schulden

- **C-DEBT-01** (P2): Legacy-Config-Adapter (`_apply_legacy_hardware_defaults`, `_apply_legacy_video_defaults`, `_apply_legacy_tts_defaults`) sind ~120 Zeilen Code für Backward-Compatibility. Sollte deprecation-logged und nach v1.0 entfernt werden.
- **C-DEBT-02** (P3): `version = "0.1.2b"` — Beta-Suffix in pyproject.toml. Kein klarer Versioning-Workflow.

---

## 4. Audit: botparty-streamer (Go Video Streamer)

### 4.1 Codequalität

| Aspekt | Bewertung | Details |
|---|---|---|
| **Code-Stil** | ✅ Gut | Idiomatisches Go, klare Fehlerbehandlung |
| **Modularität** | ✅ Gut | Klare Trennung: main.go (Control-Loop), config.go, publisher.go, health.go, annexb_reader.go |
| **Error Handling** | ✅ Gut | Go-Standard error-returns, keine panics |
| **Concurrency** | ✅ Gut | Sauberer Goroutine-Einsatz mit context.Context und channels |
| **Memory Safety** | ✅ Gut | Atomic-Operationen für Stats, Mutex für SPS/PPS-Cache |

**Befunde:**

- **S-CODE-01** (P3): `main.go` enthält sowohl Business-Logik (pumpFrames, sendFrame) als auch Metrics-Reporting und Persistence. Könnte in separate Dateien aufgeteilt werden.
- **S-CODE-02** (P3): `sendFrame()` hat eine busy-loop mit `runtime.Gosched()` für Queue-Management. Funktioniert, aber unelegant.

### 4.2 Architektur

| Aspekt | Bewertung | Details |
|---|---|---|
| **Input Pipeline** | ✅ Gut | TCP-Server akzeptiert H.264 Annex-B-Stream von ffmpeg |
| **Frame Assembly** | ✅ Gut | NAL-Unit-Assembler mit SPS/PPS-Cache über Reconnects |
| **LiveKit Publishing** | ✅ Gut | Saubere Session-Management mit Disconnect-Detection |
| **Reconnect** | ✅ Gut | Exponential-Backoff mit Jitter, Token-Refresh |
| **Health/Metrics** | ✅ Gut | Prometheus-Format Metriken, Auth-protected |

### 4.3 Security

**Befunde:**

- **S-SEC-01** (P2): Input-Listener bindet standardmäßig auf `127.0.0.1:5004` — gut. Aber `ALLOW_REMOTE_INPUT=true` erlaubt Binding auf alle Interfaces ohne zusätzliche Auth. Ein Angreifer im Netzwerk könnte eigene Video-Frames injizieren.
- **S-SEC-02** (P3): Health-Endpoint Auth ist optional (`HEALTH_AUTH_TOKEN`). Ohne Token sind Metriken öffentlich.

### 4.4 Testing

**Befunde:**

- **S-TEST-01** (P2): Gute Test-Coverage für `annexb_reader_test.go` (8.7 KB) und `health_test.go`. Aber `publisher.go` und `main.go` haben keine Tests.
- **S-TEST-02** (P3): Keine CI-Pipeline für botparty-streamer. Tests laufen nicht automatisch.

### 4.5 Performance

| Aspekt | Bewertung | Details |
|---|---|---|
| **Latency** | ✅ Gut | Low-Latency-Design: Channel-basiertes Frame-Passing, Stale-Frame-Drop, Keyframe-Waiting |
| **Backpressure** | ✅ Gut | `MaxPublishStale` droppt alte Frames, `FrameChanSize` begrenzt Queue |
| **Write Timeout** | ✅ Gut | 200ms WriteSample-Timeout verhindert Blocking bei Netzwerk-Congestion |
| **Metrics Persistence** | ✅ Gut | Atomic-Write mit Temp-File + Rename |

### 4.6 Dokumentation

**Befunde:**

- **S-DOC-01** (P3): README ist umfangreich (9.9 KB) mit Deployment-Guide, aber Architektur-Diagramm fehlt.
- **S-DOC-02** (P3): Kein GoDoc für exportierte Typen/Funktionen.

### 4.7 Feature-Gaps

- **S-FEAT-01** (P3): Kein Support für mehrere Tracks/Cameras pro Instanz. Für Multi-Camera braucht man mehrere Streamer-Prozesse.
- **S-FEAT-02** (P3): Kein H.265/AV1 Support. Nur H.264.

---

## 5. Priorisierte Gesamtliste aller offenen Punkte

### P1 – Kritisch (Sofort adressieren)

| ID | Projekt | Kategorie | Beschreibung |
|---|---|---|---|
| B-SEC-01 | botparty/web | Security | Access-Token in sessionStorage bei XSS auslesbar |
| B-SEC-02 | botparty/api | Security | Duale Robot-Auth-Mechanismen (JWT + claimToken) unkonsolidiert |
| B-TEST-01 | botparty/api | Testing | `robots.service.ts` (47 KB, Kernlogik) hat quasi keine Tests |
| C-SEC-01 | botparty-client | Security | claim_token in config.yaml ohne Rechte-Warnung |

### P2 – Wichtig (Nächste Iteration)

| ID | Projekt | Kategorie | Beschreibung |
|---|---|---|---|
| B-API-01 | botparty/api | Codequalität | robots.service.ts ist God Object (1.532 Zeilen) |
| B-API-02 | botparty/api | Codequalität | bot.gateway.runtime.ts zu groß (1.539 Zeilen) |
| B-ARCH-01 | botparty/api | Architektur | Kein Message-Queue für async Tasks (Webhooks, Email) |
| B-ARCH-02 | botparty/api | Architektur | Keine DB-Migrations (nur prisma db push) |
| B-SEC-03 | botparty/api | Security | Redis-Healthcheck prüft nicht AUTH |
| B-SEC-04 | botparty/api | Security | Swagger-Docs in Production ohne Auth |
| B-SEC-05 | botparty/api | Security | WebSocket Origin-Check nicht enforced |
| B-UX-01 | botparty/web | UX | Kein Onboarding-Flow für neue Robot-Hosts |
| B-UX-02 | botparty/web | UX | Robot-Controls ohne Accessibility-Labels |
| B-UX-03 | botparty/web | UX | Keine Skeleton-Loading-States |
| B-PERF-01 | botparty/api | Performance | getPublicOverview() lädt alle public Robots |
| B-PERF-02 | botparty/api | Performance | WebSocket-Gateway ohne Memory-Bounds |
| B-TEST-02 | botparty/api | Testing | Kein Test-Coverage-Reporting |
| B-TEST-03 | botparty/api | Testing | WebSocket-Gateway unzureichend getestet |
| B-TEST-04 | botparty/web | Testing | Web-Frontend mit nur 3 Tests |
| B-DOC-01 | botparty | Dokumentation | Kein WebSocket-Protokoll-Dokument |
| B-OPS-01 | botparty | DevOps | Kein CD-Pipeline (nur CI) |
| B-OPS-02 | botparty | DevOps | Keine Backup-Strategie dokumentiert |
| B-OPS-03 | botparty | DevOps | Kein Alerting bei Service-Ausfall |
| B-OBS-01 | botparty/api | Observability | Keine Prometheus-Metriken vom API-Server |
| B-OBS-02 | botparty/api | Observability | WebSocket-Metriken nicht exportiert |
| C-CODE-01 | botparty-client | Codequalität | Mixin-Architektur ohne Interface-Trennung |
| C-ARCH-01 | botparty-client | Architektur | Kein Plugin-System für Hardware-Adapter |
| C-SEC-02 | botparty-client | Security | robot_auth_token in JSON-Payload statt Header |
| C-TEST-01 | botparty-client | Testing | Nur 4 Tests für ~7.650 Zeilen Code |
| C-TEST-02 | botparty-client | Testing | Keine CI-Pipeline |
| C-PERF-01 | botparty-client | Performance | Kein Batching bei Frame/Thumbnail-Upload |
| C-DOC-01 | botparty-client | Dokumentation | 20+ Hardware-Adapter undokumentiert |
| C-DEBT-01 | botparty-client | Tech Debt | Legacy-Config-Adapter (120+ Zeilen) |
| S-SEC-01 | botparty-streamer | Security | Remote-Input ohne Auth bei ALLOW_REMOTE_INPUT |
| S-TEST-01 | botparty-streamer | Testing | publisher.go und main.go ohne Tests |
| S-TEST-02 | botparty-streamer | Testing | Keine CI-Pipeline |

### P3 – Optional (Backlog / Nice-to-have)

| ID | Projekt | Kategorie | Beschreibung |
|---|---|---|---|
| B-API-03 | botparty/api | Codequalität | Robot-Metadata ohne Zod-Runtime-Validierung |
| B-API-04 | botparty/api | Codequalität | updateByStaff() dupliziert update()-Logik |
| B-WEB-01 | botparty/web | Codequalität | ~70 API-Flat-Method-Delegations unnötig |
| B-ARCH-03 | botparty/api | Architektur | WS-Gateway State in-memory (verloren bei Restart) |
| B-ARCH-04 | botparty/api | Architektur | Keine API-Versionierung über v1 hinaus |
| B-ARCH-05 | botparty/web | Architektur | SSR fetches ohne shared API-Client |
| B-SEC-06 | botparty | Security | cadvisor mit privileged: true |
| B-SEC-07 | botparty/api | Security | Thumbnail-Upload ohne Server-Side-Größenlimit |
| B-UX-04 | botparty/web | UX | Kein Cookie-Consent-Management |
| B-UX-05 | botparty/web | UX | Kein Dark/Light-Mode-Toggle |
| B-UX-06 | botparty/web | UX | Explore ohne Pagination/Infinite-Scroll |
| B-PERF-03 | botparty/api | Performance | findAll ohne DB-Level-Aggregation |
| B-PERF-04 | botparty/api | Performance | Chat-Persistence ohne Bulk-Insert |
| B-DOC-02 | botparty | Dokumentation | Keine Architecture Decision Records |
| B-DOC-03 | botparty | Dokumentation | Einige Env-Vars undokumentiert |
| B-TEST-05 | botparty/api | Testing | Keine Integration-Tests (API+DB+Redis) |
| B-OPS-04 | botparty | DevOps | Kein Zero-Downtime-Deployment |
| B-OPS-05 | botparty | DevOps | Dev vs Prod Workflow unklar dokumentiert |
| B-OBS-03 | botparty/api | Observability | Kein OpenTelemetry/Distributed Tracing |
| C-CODE-02 | botparty-client | Codequalität | client_ops.py zu groß (27.8 KB) |
| C-CODE-03 | botparty-client | Codequalität | publisher.py ffmpeg-Log-Parsing auslagern |
| C-ARCH-02 | botparty-client | Architektur | camera.py eng gekoppelt mit Client-Lifecycle |
| C-SEC-03 | botparty-client | Security | device_key im CWD statt Home-Verzeichnis |
| C-PERF-02 | botparty-client | Performance | Kein aiohttp Connection-Pooling |
| C-DOC-02 | botparty-client | Dokumentation | Keine API-Reference |
| C-DOC-03 | botparty-client | Dokumentation | Kein Changelog |
| C-DEBT-02 | botparty-client | Tech Debt | Beta-Version ohne Versioning-Workflow |
| S-CODE-01 | botparty-streamer | Codequalität | main.go mischt Business- und Metrics-Logik |
| S-CODE-02 | botparty-streamer | Codequalität | sendFrame() Busy-Loop-Pattern |
| S-SEC-02 | botparty-streamer | Security | Health-Auth optional |
| S-DOC-01 | botparty-streamer | Dokumentation | Kein Architektur-Diagramm |
| S-DOC-02 | botparty-streamer | Dokumentation | Kein GoDoc für exportierte Typen |
| S-FEAT-01 | botparty-streamer | Feature-Gap | Kein Multi-Track/Camera pro Instanz |
| S-FEAT-02 | botparty-streamer | Feature-Gap | Kein H.265/AV1 Support |

---

## 6. Konkrete Action Items

### Sprint 1: Security & Critical Testing (P1)

```
ACTION-01: Access-Token nur im Memory halten
  Projekt: botparty/web
  Datei: apps/web/src/lib/store.ts
  Änderung: accessToken aus sessionStorage-Persistenz entfernen.
            Nur via HttpOnly-Cookie refresh. Auth-State (username, role)
            darf in sessionStorage bleiben, Token nicht.
  Aufwand: 2-4h
  Referenz: B-SEC-01
  Status: ✅ Erledigt (2026-04-17)

ACTION-02: Robot-Auth-Dokumentation und Konsolidierung
  Projekt: botparty/api
  Änderung: Dokument erstellen das die zwei Auth-Pfade (claimToken + JWT)
            erklärt. Langfristig: claimToken nur für Initial-Claim,
            danach device-bound JWT.
  Aufwand: 4-8h
  Referenz: B-SEC-02
  Status: ✅ Erledigt (2026-04-17)

ACTION-03: robots.service.ts Unit Tests erweitern
  Projekt: botparty/api
  Datei: apps/api/src/robots/robots.service.spec.ts
  Änderung: Tests für: create(), update(), findBySlug(), slugManagement,
            profanity-filter, access-policy, invite-code-generation,
            device-binding, status-normalization, viewerCount-normalization
  Aufwand: 8-16h
  Referenz: B-TEST-01
  Status: ✅ Erledigt (2026-04-17)

ACTION-04: config.yaml Sicherheitshinweis
  Projekt: botparty-client
  Datei: config.example.yaml, README.md
  Änderung: Warnung hinzufügen: "chmod 600 config.yaml" nach Erstellen.
            claim_token als sensitiv markieren.
  Aufwand: 1h
  Referenz: C-SEC-01
  Status: ✅ Erledigt (2026-04-17)
```

### Sprint 2: Code Quality & Architecture (P2)

```
ACTION-05: robots.service.ts aufteilen
  Projekt: botparty/api
  Änderung: Extrahiere in separate Services:
    - RobotCrudService (create, update, delete, findAll, findById)
    - RobotSlugService (generateSlug, buildSlugUpdate, reclaimSlugAlias)
    - RobotMetadataService (mergeMetadata, access/stream policy)
    - RobotInviteService (resolveInviteCode, generateUniqueInviteCode)
    - RobotDeviceService (validateOrBindDevice, claim-token mgmt)
  Aufwand: 16-24h
  Referenz: B-API-01
  Status: ✅ Erledigt (2026-04-19)

ACTION-06: Gateway-Runtime weiter modularisieren
  Projekt: botparty/api
  Änderung: Chat-Handling, Control-Forwarding und Metrics in eigene
            Handler-Klassen extrahieren (analog PresenceHandler, TurnHandler).
  Aufwand: 12-16h
  Referenz: B-API-02
  Status: ✅ Erledigt (2026-04-19)

ACTION-07: BullMQ für async Tasks hinzufügen
  Projekt: botparty/api
  Änderung: BullMQ (Redis-backed) Queue einführen für:
    - Webhook-Delivery (mit Retries)
    - Email-Versand
    - Chat-Persistence Batching
  Aufwand: 16-24h
  Referenz: B-ARCH-01
  Status: ✅ Erledigt (2026-04-17)

ACTION-08: Prisma Migrations einführen
  Projekt: botparty/packages/prisma
  Änderung: Von `prisma db push` auf `prisma migrate dev/deploy` umstellen.
            Initiales Migration-Baseline erstellen.
  Aufwand: 4-8h
  Referenz: B-ARCH-02
  Status: ✅ Bereits implementiert, verifiziert (2026-04-19)

ACTION-09: Redis-Healthcheck verbessern
  Projekt: botparty
  Datei: docker-compose.yml
  Änderung: Redis healthcheck von `nc -z` auf
            `redis-cli -a $REDIS_PASSWORD ping` umstellen.
  Aufwand: 30min
  Referenz: B-SEC-03
  Status: ✅ Erledigt (2026-04-17)

ACTION-10: WebSocket Origin-Validation
  Projekt: botparty/api
  Datei: apps/api/src/gateway/bot.gateway.runtime.ts
  Änderung: In handleConnection() den Origin-Header der WebSocket-
            Verbindung gegen CORS_ORIGIN prüfen. Ungültige Origins
            mit close(1008) ablehnen.
  Aufwand: 2-4h
  Referenz: B-SEC-05
  Status: ✅ Erledigt (2026-04-17)

ACTION-11: Skeleton-Loading-States (Web)
  Projekt: botparty/web
  Änderung: Skeleton-Komponenten für Robot-Cards, Dashboard, Robot-View
            erstellen. Next.js `loading.tsx` pro Route-Segment.
  Aufwand: 8-12h
  Referenz: B-UX-03
  Status: ✅ Bereits implementiert, verifiziert (2026-04-19)

ACTION-12: Test-Coverage-Reporting einrichten
  Projekt: botparty
  Datei: .github/workflows/ci.yml, vitest.config.ts
  Änderung: Vitest/Jest Coverage-Reporter hinzufügen, Coverage-Threshold
            definieren (Start: 30%, Ziel: 60%), in CI als Artifact speichern.
  Aufwand: 4h
  Referenz: B-TEST-02
  Status: ✅ Erledigt (2026-04-19)

ACTION-13: CI-Pipeline für botparty-client
  Projekt: botparty-client
  Datei: .github/workflows/ci.yml (neu)
  Änderung: GitHub Actions mit: ruff lint, mypy check, pytest run
  Aufwand: 2-4h
  Referenz: C-TEST-02
  Status: ✅ Bereits implementiert, verifiziert (2026-04-17)

ACTION-14: CI-Pipeline für botparty-streamer
  Projekt: botparty-streamer
  Datei: .github/workflows/ci.yml (neu)
  Änderung: GitHub Actions mit: go vet, go test ./..., go build
  Aufwand: 2-4h
  Referenz: S-TEST-02
  Status: ✅ Bereits implementiert, verifiziert (2026-04-17)

ACTION-15: getPublicOverview() cachen
  Projekt: botparty/api
  Datei: apps/api/src/robots/robots.service.ts
  Änderung: Overview-Response in Redis cachen (TTL: 30s).
            Invalidierung bei Robot-Status-Changes.
  Aufwand: 4h
  Referenz: B-PERF-01
  Status: ✅ Erledigt (2026-04-17)

ACTION-16: WebSocket-Protokoll dokumentieren
  Projekt: botparty
  Datei: docs/websocket-protocol.md (neu)
  Änderung: Alle WS_EVENTS dokumentieren mit: Event-Name, Payload-Schema,
            Direction (client→server / server→client), Auth-Requirements,
            Rate-Limits.
  Aufwand: 8h
  Referenz: B-DOC-01
  Status: ✅ Erledigt (2026-04-17)
```

### Sprint 3: Polish & Observability (P3)

```
ACTION-17: Robot-Metadata Zod-Schema
  Status: ✅ Erledigt (2026-04-19)
ACTION-18: API-Flat-Methods entfernen (api.robots.xyz() direkt nutzen)
  Status: ✅ Erledigt (2026-04-19)
ACTION-19: Prometheus-Metriken vom API-Server exportieren
  Status: ✅ Erledigt (2026-04-19)
ACTION-20: Hardware-Adapter-Dokumentation erstellen
  Status: ✅ Bereits implementiert, verifiziert (2026-04-19)
ACTION-21: Explore-Seite Pagination/Infinite-Scroll
  Status: ✅ Erledigt (2026-04-19)
ACTION-22: Dark/Light-Mode-Toggle
  Status: ✅ Erledigt (2026-04-19)
ACTION-23: Legacy-Config-Adapter deprecation-Warnings verschärfen
  Status: ✅ Erledigt (2026-04-19)
ACTION-24: OpenTelemetry für Distributed Tracing
  Status: ✅ Erledigt (2026-04-19)
ACTION-25: Backup-Strategie dokumentieren
  Status: ✅ Erledigt (2026-04-19)
ACTION-26: Zero-Downtime-Deployment dokumentieren
  Status: ✅ Erledigt (2026-04-19)
```

---

> **Hinweis für nachfolgende KI:** Diese Audit-Datei ist als Arbeitsdokument gedacht. Jedes Action Item hat eine eindeutige ID und referenziert den zugehörigen Befund. Arbeite die Items in Sprint-Reihenfolge ab (Sprint 1 → Sprint 2 → Sprint 3). Markiere erledigte Items mit ✅ und dem Datum der Umsetzung. Bei Unklarheiten referenziere die Befund-ID für Kontext.
