# BotParty Platform – Vollständiges Projekt-Audit

> **Audit-Datum:** 2026-04-17
> **Auditor:** Automatisiert (KI-gestütztes Code-Audit)
> **Scope:** Alle 3 Projekte – Monorepo (API + Web), Robot Client, Video Streamer

---

## Inhaltsverzeichnis

1. [Projektübersicht](#1-projektübersicht)
2. [Audit: botparty (Monorepo – API + Web)](#2-audit-botparty-monorepo)
3. [Audit: botparty-client (Python Robot Client)](#3-audit-botparty-client)
4. [Audit: botparty-streamer (Go Video Streamer)](#4-audit-botparty-streamer)
5. [Priorisierte Liste aller offenen Punkte](#5-priorisierte-liste)
6. [Konkrete Action Items](#6-action-items)

---

## 1. Projektübersicht

| Projekt | Sprache | Frameworks | LoC (ca.) | Tests | Zweck |
|---------|---------|-----------|-----------|-------|-------|
| **botparty** (Monorepo) | TypeScript | NestJS (API), Next.js 15 (Web), Prisma, Tailwind 4 | ~29.000 | 11 Testdateien (6 API, 5 Web) | Backend-API + Frontend-Webapp |
| **botparty-client** | Python 3.10+ | aiohttp, LiveKit SDK, Pydantic, OpenCV | ~7.600 | 2 Testdateien | Robot-Hardware-Client |
| **botparty-streamer** | Go 1.22+ | LiveKit Server SDK, Pion WebRTC | ~1.860 | 2 Testdateien | H264 Video-Publishing zu LiveKit |

### Architektur-Diagramm

```
┌──────────────┐     HTTPS/WSS     ┌──────────────┐     WebSocket     ┌─────────────────┐
│   Browser    │◄──────────────────►│   NGINX      │◄────────────────►│  NestJS API     │
│   (Next.js)  │                    │   Reverse    │                   │  (Fastify)      │
└──────────────┘                    │   Proxy      │                   └────────┬────────┘
                                    └──────────────┘                            │
                                                                    ┌───────────┼───────────┐
                                                                    ▼           ▼           ▼
                                                              ┌──────────┐ ┌─────────┐ ┌──────────┐
                                                              │PostgreSQL│ │  Redis  │ │ LiveKit  │
                                                              │   16     │ │   7     │ │  SFU     │
                                                              └──────────┘ └─────────┘ └────┬─────┘
                                                                                            │
                                                              ┌─────────────────────────────┤
                                                              ▼                             ▼
                                                        ┌──────────────┐           ┌──────────────┐
                                                        │ botparty-    │           │ botparty-    │
                                                        │ client       │           │ streamer     │
                                                        │ (Python)     │──────────►│ (Go)         │
                                                        └──────────────┘  TCP/H264 └──────────────┘
```

---

## 2. Audit: botparty (Monorepo)

### 2.1 Codequalität

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Typisierung** | ✅ Gut | Durchgängig TypeScript strict mode. Zod-Schemas für Runtime-Validierung. Shared Types zwischen API und Web. |
| **Konsistenz** | ✅ Gut | ESLint + Prettier konfiguriert. Einheitliche Code-Formatierung über Turborepo. |
| **Modularisierung** | ⚠️ Mittel | NestJS-Module sind sauber getrennt, aber `bot.gateway.ts` (1.447 Zeilen) und `robots.service.ts` (1.452 Zeilen) sind überdimensioniert. |
| **Error Handling** | ✅ Gut | Globaler `AllExceptionsFilter`, konsistente HTTP-Exceptions, Zod-Validierung auf WS-Ebene. |
| **Naming Conventions** | ✅ Gut | Einheitliches NestJS-Pattern (Module/Service/Controller). Klare Dateinamen. |
| **Code-Duplikation** | ⚠️ Mittel | Slug-Update-Logik in `update()` und `updateByStaff()` fast identisch. API-Client (`api.ts`) hat ~70 delegierende Einzeiler. |
| **Shared Package** | ✅ Gut | `@botparty/shared` enthält Zod-Schemas, Typen und Konstanten. Wird von API und Web konsumiert. |

**Kritische Befunde:**

- **GOD-Objects:** `bot.gateway.ts` (1.447 Zeilen) vereint Room-Management, Robot-Claim, Control-Forwarding, Chat, Moderation, Turn-Handling und Redis-Pub/Sub. Wurde bereits teilweise refactored (PresenceHandler, TurnHandler, etc.), aber der Kern ist noch zu groß.
- **GOD-Service:** `robots.service.ts` (1.452 Zeilen) umfasst CRUD, Access-Policies, Thumbnails, Telemetrie, Webhooks, Stream-Policies, Slug-Management, Invite-Codes. Teilweise ausgelagert (RobotAccessService, RobotTelemetryService, etc.), aber die Hauptdatei bleibt überladen.
- **API Client Proxy-Pattern:** `apps/web/src/lib/api.ts` hat ~70 Einzeiler-Methoden die nur an Sub-Clients delegieren. Ist backward-kompatibel, aber bläht die Datei unnötig auf.

---

### 2.2 Architektur

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Monorepo-Struktur** | ✅ Gut | Turborepo + pnpm Workspaces. Klare Trennung in `apps/` und `packages/`. |
| **API-Design** | ✅ Gut | RESTful mit globalem `/api/v1` Prefix. Swagger/OpenAPI-Dokumentation. |
| **WebSocket-Architektur** | ✅ Gut | Native `ws`-Bibliothek (nicht Socket.IO). Redis Pub/Sub für horizontale Skalierung. Per-Event Rate Limiting. |
| **Datenbank** | ✅ Gut | PostgreSQL mit Prisma ORM. Sauberes Schema mit Enums, Indexen und Cascading Deletes. |
| **Caching** | ✅ Gut | Redis für Session-Locks, Presence, Queue, Rate-Limiting, Heartbeats. |
| **Docker** | ✅ Gut | Multi-Service Compose mit internem Netzwerk. Health-Checks auf allen Services. Secrets-Management über File-Mounts. |
| **Horizontale Skalierung** | ⚠️ Mittel | Redis Pub/Sub für WS-Events ist vorbereitet, aber in-Memory Maps (`clients`, `rooms`, `activeTurns`) sind node-lokal. Multi-Instanz-Betrieb funktioniert nur eingeschränkt. |
| **State Management (Web)** | ✅ Gut | Zustand für Client-State. Server-Components für SSR-Daten. Klare Trennung. |

**Kritische Befunde:**

- **Single-Instance Bottleneck:** Die WS-Gateway Maps (`clients`, `rooms`, `robotClients`, `activeTurns`, `controlCooldowns`) sind in-Memory. Bei Multi-Instanz würde Turn-State inkonsistent. Redis Pub/Sub leitet Events weiter, aber der State selbst ist nicht shared.
- **Fehlende Queue-Workers:** BullMQ ist als Dependency vorhanden (`@nestjs/bullmq`, `bullmq`), aber es gibt kein dediziertes Worker-Setup. Alle Aufgaben laufen im API-Prozess.
- **Chat nicht persistent in Echtzeit:** Chat wird nur über WS-Broadcast verteilt. Die `ChatMessage`-Tabelle existiert, aber es gibt keine sichtbare Chat-Persistenz in der Gateway-Logik.
- **Fehlende API-Versionierung Migration:** Nur `/api/v1`. Keine Strategie für `/api/v2`.

---

### 2.3 Security

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Authentifizierung** | ✅ Gut | JWT + Refresh-Token mit Token-Version Rotation. Argon2id für Passwort-Hashing. |
| **CSRF-Schutz** | ✅ Gut | Double-Submit Cookie Pattern mit eigenem CsrfOriginGuard. |
| **Rate Limiting** | ✅ Gut | Globales ThrottlerGuard + per-Event WS Rate Limiting mit Typ-spezifischen Buckets. |
| **Helmet/CSP** | ✅ Gut | Fastify Helmet mit Content Security Policy. Frame-Ancestors `none`. |
| **CORS** | ✅ Gut | Strict Origin mit Credentials. Konfigurierbar über ENV. |
| **Input Validation** | ✅ Gut | Zod-Schemas auf WS-Ebene. Global ValidationPipe mit Whitelist + forbidNonWhitelisted. |
| **Secret Management** | ✅ Gut | File-backed Secrets Support. Startup-Validierung für JWT, LiveKit, etc. Bannliste für Placeholder-Werte. |
| **Account Lockout** | ✅ Gut | 10 Fehlversuche → 15 Min Lockout. Email-Benachrichtigung. |
| **Passwort-Reset** | ✅ Gut | Token wird SHA-256 gehasht in Redis gespeichert. TTL-basiert. Nur neuester Token gültig. |
| **Cookie Security** | ✅ Gut | HttpOnly, Secure (prod), SameSite. Separate Paths für Access/Refresh. |

**Kritische Befunde:**

- **P1 – WebSocket Auth ist optional für Viewer:** `room:join` akzeptiert unauthentifizierte Gäste (`isGuest = true`). Gast-IDs basieren auf der Socket-UUID – diese sind leicht spoofbar. Ein bösartiger Client könnte massenhaft Gast-Verbindungen öffnen.
- **P2 – Kein WebSocket TLS-Pinning:** Die Gateway CORS nutzt `process.env.CORS_ORIGIN`, aber die WS-Verbindung wird erst nach dem Handshake validiert. Origin-Header sind vom Client kontrolliert.
- **P2 – Redis-Passwort in Health-Check sichtbar:** `docker-compose.yml` Zeile 56: `redis-cli -a ${REDIS_PASSWORD}` – das Passwort ist in `docker inspect` und Prozesslisten sichtbar.
- **P3 – Swagger in nicht-Prod standardmäßig aktiv:** `SWAGGER_DOCS` ist in Development-Umgebungen aktiv. API-Oberfläche wird exponiert.
- **P3 – robotAuthToken wird als WS-Payload übertragen:** Im `robot:claim` Event wird der auth-Token als JSON-Payload gesendet. TLS schützt, aber Token-Logging in Intermediate-Proxies ist möglich.

---

### 2.4 UX / Nutzerfreundlichkeit

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Homepage** | ✅ Gut | Modernes Dark-Theme-Design. Gradient-Akzente. Live-Stats. Featured Robots. |
| **Navigation** | ✅ Gut | Responsive Nav mit Mobile-Menu. Klare Seitenstruktur. |
| **Robot-Karten** | ✅ Gut | Status-Indicator, Viewer-Count, Tags, Owner-Info. |
| **Dashboard** | ✅ Gut | Sidebar-Navigation. Robot-Management. Settings. |
| **Robot-View** | ✅ Gut | LiveKit-Player, Queue-Panel, Chat, Control-Buttons. |
| **Error States** | ⚠️ Mittel | `error.tsx` und `not-found.tsx` existieren, aber sind minimal. Keine granularen Error-Boundaries pro Feature. |
| **Loading States** | ⚠️ Mittel | Globales `loading.tsx` existiert, aber Feature-spezifische Skeleton-Loader fehlen. |
| **Accessibility** | ⚠️ Mittel | Semantic HTML wird verwendet, aber `aria-labels` fehlen auf vielen interaktiven Elementen. Keyboard-Navigation in Custom-Komponenten nicht getestet. |
| **Offline-Handling** | ❌ Fehlt | Service-Worker-Registration existiert, aber kein echtes Offline-Handling. Keine Offline-Banner oder Retry-UI. |
| **Internationalisierung** | ❌ Fehlt | Alle Texte sind hardcoded Englisch. Kein i18n-Framework. |

**Kritische Befunde:**

- **P2 – Keine Toast/Notification-Systematik:** `toast.ts` existiert als Stub (970 Bytes), aber es gibt kein durchgängiges Feedback-System für Aktionen (Robot erstellt, Queue beigetreten, Error, etc.).
- **P2 – Keine Skeleton-Loader:** Dashboard und Robot-View laden ohne visuelle Platzhalter. Springende Layouts bei langsamen Verbindungen.
- **P3 – Embed-View rudimentär:** `embed-robot-view.tsx` existiert, aber Embeddability (Iframe-Sizing, Theme-Overrides) ist nicht ausgebaut.

---

### 2.5 Performance

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **SSR** | ✅ Gut | Next.js 15 mit Server Components. Homepage revalidiert alle 10s. |
| **Bundle Size** | ✅ Gut | Nur essentielle Dependencies. Keine überflüssigen UI-Libraries. |
| **Database Queries** | ⚠️ Mittel | `findAll` in robots filtert Status NACH dem Fetch (`filter` statt `where`). Viewer-Count wird per Redis-SET + Prisma-Update gesynct. |
| **WebSocket Efficiency** | ✅ Gut | JSON.stringify wird pro Broadcast nur einmal aufgerufen. Server-side Ping alle 30s. |
| **Caching** | ⚠️ Mittel | Access-Policy hat in-Memory Cache mit Invalidation. Aber Robot-Queries werden bei jedem Control-Command einzeln gefetcht (`findById`). |
| **Docker Images** | ⚠️ Mittel | Multi-Stage Builds sind wahrscheinlich konfiguriert (Dockerfiles nicht geprüft), aber `node_modules` könnte in Prod-Images aufgebläht sein. |

**Kritische Befunde:**

- **P2 – N+1 Queries im Control-Flow:** Jeder `CONTROL_COMMAND` löst `robotsService.findById()` + `robotsService.getAccessPolicy()` + optional `moderationService.getActiveRestriction()` aus. Bei 30 Commands/Sekunde pro Robot = 90+ DB-Queries/s.
- **P2 – Status-Filter nach DB-Fetch:** `findAll()` Zeile 277: `.filter((robot) => !filters?.status || robot.status === filters.status)` – Status sollte als WHERE-Clause in die DB-Query.
- **P3 – controlCooldowns Memory-Leak Risiko:** Die Map wächst unbegrenzt. Cleanup passiert erst bei >4096 Einträgen. Kein periodischer Cleanup.

---

### 2.6 Dokumentation

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **README.md** | ✅ Gut | 9 KB, umfassend. Setup-Anweisungen, Architektur-Übersicht. |
| **CONTRIBUTING.md** | ✅ Gut | Vorhanden mit PR-Guidelines. |
| **CHANGELOG.md** | ✅ Gut | Vorhanden und gepflegt. |
| **API-Docs** | ✅ Gut | Swagger/OpenAPI über `/docs` verfügbar (Dev). Tags für alle Module. |
| **Inline-Comments** | ✅ Gut | Wichtige Entscheidungen sind kommentiert (Helm, CORS, Trust-Proxy). |
| **env.example** | ✅ Gut | 99 Zeilen, gut dokumentiert, alle Variablen erklärt. |
| **Shared Package** | ⚠️ Mittel | README existiert, aber keine JSDoc-Comments auf Typen/Schemas. |
| **Architecture Docs** | ❌ Fehlt | Kein ADR (Architecture Decision Record). Kein Diagramm im Repo. |

---

### 2.7 Offene Bugs / Technische Schulden

| ID | Typ | Beschreibung | Schwere |
|----|-----|-------------|---------|
| TD-01 | God Object | `bot.gateway.ts` mit 1.447 Zeilen | P2 |
| TD-02 | God Service | `robots.service.ts` mit 1.452 Zeilen | P2 |
| TD-03 | Duplikation | Slug-Update Logik zwischen `update()` und `updateByStaff()` | P3 |
| TD-04 | Proxy Pattern | 70+ Einzeiler-Delegationen in `api.ts` | P3 |
| TD-05 | Test-Coverage | Nur 6 API-Testdateien für ~12.000 LoC (~0.5% Coverage geschätzt) | P1 |
| TD-06 | Test-Coverage | Nur 5 Web-Testdateien für ~17.000 LoC | P1 |
| TD-07 | Type Safety | `isStaffRole()` in `robot-access.ts` vs. inline Check in `findPrivateByUsernameAndSlugForUser` (Zeile 660) – inkonsistente Staff-Erkennung | P2 |
| TD-08 | Memory | `controlCooldowns` Map wächst ohne periodischen Cleanup | P3 |
| TD-09 | Chat | Chat-Nachrichten werden nicht in DB persistiert (nur WS-Broadcast) | P2 |
| TD-10 | Scheduled Features | `SwarmGroup`, `Transaction`, `AnalyticsEvent` DB-Tabellen existieren, aber haben keine API-Endpoints | P3 |
| TD-11 | Unused Fields | `aiAssistEnabled`, `ros2Enabled`, `balance`, `credits` in Schema ohne Implementation | P3 |

---

### 2.8 Feature-Gaps / Verbesserungsideen

| ID | Feature | Beschreibung | Priorität |
|----|---------|-------------|-----------|
| FG-01 | Test-Suite | Vollständige Unit- und Integration-Tests für Auth, Gateway, Queue, Moderation | P1 |
| FG-02 | E2E-Tests | Playwright E2E-Tests für kritische User-Flows (Login, Robot erstellen, Queue-Join, Control) | P1 |
| FG-03 | Chat-Persistenz | Chat-Nachrichten in DB speichern für History beim Room-Join | P2 |
| FG-04 | Monitoring/Alerting | Sentry-Integration (DSN ist vorbereitet, aber nicht implementiert), Prometheus-Metriken | P2 |
| FG-05 | Email-Templates | HTML-Email-Templates für Verification, Password-Reset, Lockout (aktuell plain text) | P3 |
| FG-06 | i18n | Internationalisierung für mindestens EN/DE | P3 |
| FG-07 | Offline-UX | Banner bei Verbindungsverlust, Auto-Reconnect-Indicator | P2 |
| FG-08 | OAuth | Social Login (GitHub, Google, Discord) | P3 |
| FG-09 | User-Avatare | Upload und Anzeige von User-Avataren | P3 |
| FG-10 | Analytics-Dashboard | Nutzung der AnalyticsEvent-Tabelle für Insights | P3 |
| FG-11 | Robot-Scheduling | Nutzung der `scheduleStart`/`scheduleEnd` Felder für geplante Sessions | P3 |
| FG-12 | Webhook-Management UI | Frontend für Robot-Webhook-Konfiguration | P3 |

---

## 3. Audit: botparty-client

### 3.1 Codequalität

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Typisierung** | ✅ Gut | Pydantic-Models für Config-Validierung. Type-Hints durchgängig. `py.typed` Marker. |
| **Architektur** | ✅ Gut | Mixin-Pattern für Client-Dekomposition (ClientCommandsMixin, ClientMediaMixin, ClientOpsMixin, ClientLifecycleMixin). |
| **Error Handling** | ✅ Gut | Graceful Shutdown mit Timeout. Retry-Logik mit Backoff. Supervisor für Task-Recovery. |
| **Config-Management** | ✅ Gut | YAML-basiert mit Pydantic-Validierung. Legacy-Config-Migration. Env-Var Override. |
| **Logging** | ✅ Gut | Strukturiertes Logging. Log-Level konfigurierbar. PlannedReconnectNoiseFilter. |
| **Code-Organisation** | ⚠️ Mittel | `client_ops.py` (589 Zeilen) ist ein Mix aus Auth, Git-Ops, Telemetrie, OTA-Updates. |

**Kritische Befunde:**

- **P2 – Mixin Anti-Pattern:** Die Mixin-Klassen (`ClientCommandsMixin`, `ClientMediaMixin`, etc.) greifen alle auf `self`-Attribute zu, die in `BotPartyClient.__init__` definiert werden. Das ist funktional, aber nicht typsicher – Mypy kann die Cross-Mixin-Referenzen nicht validieren.
- **P2 – OTA-Update via `os.execv`:** `_restart_process_after_update()` (Zeile 588) nutzt `os.execv()` für Process-Replace nach `git pull`. Kein Rollback bei fehlerhaftem Update. Keine Signatur-Verifizierung.
- **P3 – Hardware-Abstraction inkomplett:** Das Hardware-Plugin-System (`create_hardware()`) ist vorhanden, aber die Custom-Hardware-Datei (`hardware_custom.py`) ist nur 240 Bytes groß.

---

### 3.2 Security

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Device Key** | ✅ Gut | Auto-generiert, lokal gespeichert mit 0o600 Permissions. SHA-256 Hash wird serverseitig gebunden. |
| **Claim Token** | ✅ Gut | 32 Byte Entropy. Max-Age konfigurierbar. Token-Rotation bei Regeneration. |
| **Auth Token Handling** | ⚠️ Mittel | Robot-Auth-Token wird im Speicher gehalten und über WS gesendet. Kein Token-Refresh-Mechanismus. |
| **TLS** | ✅ Gut | WebSocket-URLs werden automatisch auf `wss://` umgeschrieben. |
| **Update-Mechanismus** | ❌ Kritisch | `git pull --ff-only` + `pip install` ohne Signatur-Verifizierung. Remote-URL kann über Env-Var injiziert werden. |

**Kritische Befunde:**

- **P1 – Unsicherer OTA-Update-Pfad:** `_perform_client_update()` führt `git pull` und `pip install` aus und startet den Prozess neu – alles remote auslösbar über die `robot:actions` Schnittstelle. Ein kompromittierter Server könnte beliebigen Code auf dem Robot ausführen.
- **P2 – Kein Certificate Pinning:** aiohttp nutzt die System-CA-Kette. MITM-Angriffe auf die API-Verbindung sind in unsicheren Netzwerken möglich.

---

### 3.3 Performance

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Async I/O** | ✅ Gut | Vollständig asyncio-basiert. Non-blocking Camera Pipeline. |
| **Reconnect-Logik** | ✅ Gut | Exponentieller Backoff mit Jitter. Server-Shutdown mit Retry-Override. |
| **Resource Management** | ✅ Gut | Telemetrie liest direkt aus `/proc/stat`, `/proc/meminfo`, `/sys/class/thermal` – kein psutil Overhead wenn nicht verfügbar. |
| **Camera Pipeline** | ✅ Gut | CameraManager mit Restart-Logic. Max 5 Restart-Versuche pro Kamera. |
| **Memory** | ⚠️ Mittel | Diagnostics-Buffer `deque(maxlen=400)` ist grobkörnig. TTS-Queue `maxsize=20` könnte bei hohem Chat-Aufkommen droppen. |

---

### 3.4 Dokumentation

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **README.md** | ✅ Gut | 3.5 KB. Setup-Anleitung, Config-Erklärung. |
| **config.example.yaml** | ✅ Gut | 11 KB – ausführlich mit allen Optionen dokumentiert. |
| **Docstrings** | ⚠️ Mittel | Modul-Level-Docstrings vorhanden, aber Funktionen oft undokumentiert. |
| **API-Referenz** | ❌ Fehlt | Keine generierte API-Dokumentation (Sphinx, pdoc). |

---

### 3.5 Offene Bugs / Technische Schulden

| ID | Typ | Beschreibung | Schwere |
|----|-----|-------------|---------|
| TD-C01 | Security | OTA-Updates ohne Signatur-Verifizierung | P1 |
| TD-C02 | Architecture | Mixin-Pattern ohne typsichere Protokolle | P2 |
| TD-C03 | Test-Coverage | Nur 2 Testdateien für ~7.600 LoC | P1 |
| TD-C04 | Large File | `client_ops.py` (589 Zeilen) mischt Auth, Git, Telemetrie, Updates | P3 |
| TD-C05 | Deprecated Config | Legacy-Config-Migration-Code (`_apply_legacy_*`) wird immer ausgeführt | P3 |
| TD-C06 | Mypy | `strict = false` in mypy Config | P3 |

---

### 3.6 Feature-Gaps

| ID | Feature | Beschreibung | Priorität |
|----|---------|-------------|-----------|
| FG-C01 | Tests | Unit-Tests für Camera-Pipeline, Command-Handling, Auth-Flow | P1 |
| FG-C02 | Update Rollback | Versionierung + Rollback bei fehlerhaften Updates | P1 |
| FG-C03 | Health Endpoint | Lokaler HTTP-Health-Endpoint für Systemd/Docker-Monitoring | P2 |
| FG-C04 | Plugin System | Dokumentiertes Plugin-Interface für Hardware-Adapter | P3 |
| FG-C05 | Configuration Validation | Frühzeitiger Startup-Check ob Hardware/Video-Dependencies installiert sind | P3 |
| FG-C06 | Metrics Export | Prometheus-Metriken für Camera-FPS, Command-Latenz, etc. | P3 |

---

## 4. Audit: botparty-streamer

### 4.1 Codequalität

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Code-Stil** | ✅ Gut | Idiomatic Go. Klare Package-Struktur (single package `main`). |
| **Error Handling** | ✅ Gut | Konsequentes Error-Return-Pattern. `log.Fatalf` nur bei nicht-wiederherstellbaren Fehlern. |
| **Concurrency** | ✅ Gut | Channels für Frame-Pipelining. Atomics für Stats. sync.Once für Disconnect. |
| **Config Validation** | ✅ Gut | Comprehensive Validation in `LoadConfig()` mit klaren Fehlermeldungen. Bounds-Checks auf allen Zahlen. |
| **Logging** | ✅ Gut | Strukturierte Log-Nachrichten mit Kontext. Microsecond-Timestamps. |
| **Code Size** | ✅ Gut | ~1.860 Zeilen total. Gut fokussiert. |

**Kritische Befunde:**

- **P3 – Single-Package:** Alles ist im `main`-Package. Bei wachsender Komplexität sollte ein `internal/`-Package-Layout eingeführt werden.
- **P3 – WriteSample Goroutine pro Frame:** `WriteFrame()` spawnt eine Goroutine pro Frame für ein 200ms Timeout. Bei 30 FPS = 30 Goroutines/Sekunde. Funktional korrekt, aber nicht ideal.

---

### 4.2 Security

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Input Binding** | ✅ Gut | Standardmäßig `127.0.0.1:5004`. Remote-Binding erfordert explizites `ALLOW_REMOTE_INPUT=true`. Loopback-Validierung. |
| **Token Handling** | ✅ Gut | 3 Token-Provider (Static, File, HTTP). Token-TTL konfigurierbar. |
| **Health Endpoint** | ⚠️ Mittel | Health-Server exposed auf konfiguriertem Port. Keine Authentifizierung. |
| **Metrics Persistence** | ✅ Gut | Atomic Write mit tmp+rename Pattern. Kein direktes Überschreiben. |

**Kritische Befunde:**

- **P2 – Health Endpoint unauthentifiziert:** Der Health-Server unter `HEALTH_ADDR` exponiert Runtime-Stats (Dropped Frames, Reconnects, etc.). Keine Auth. Sollte nur auf Loopback gebunden sein.
- **P3 – Token im Env/File:** LiveKit-Token als ENV-Variable oder Datei. Standard-Praxis, aber bei langlebigen Tokens ist Rotation schwierig.

---

### 4.3 Performance

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **Frame Pipeline** | ✅ Excellent | Zero-Copy Channel-basiert. Stale-Frame-Dropping. Keyframe-Gating. |
| **Reconnect** | ✅ Gut | Exponentieller Backoff mit ±10% Jitter. Queue-Drain bei Reconnect. |
| **SPS/PPS Caching** | ✅ Gut | Parameter-Sets werden über ffmpeg-Neustarts gecacht für sofortige Decodierbarkeit. |
| **Memory** | ✅ Gut | Bounded Channel (`FrameChanSize` 1-32). Controlled Buffer-Sizes. |
| **CPU** | ✅ Gut | Minimal Processing. NAL-Unit Parsing ist Byte-Level-effizient. |

---

### 4.4 Dokumentation

| Aspekt | Bewertung | Details |
|--------|-----------|---------|
| **README.md** | ✅ Gut | 9.9 KB. Ausführlich mit Build-Anleitung, Config-Referenz, Deployment. |
| **env.example** | ✅ Gut | Alle ENV-Vars dokumentiert. |
| **Code-Comments** | ✅ Gut | Wichtige Design-Entscheidungen kommentiert (SPS/PPS Cache, Frame-Dropping-Logik). |
| **Inline Docs** | ⚠️ Mittel | Keine GoDoc-Comments auf exportierten Typen. |

---

### 4.5 Offene Bugs / Technische Schulden

| ID | Typ | Beschreibung | Schwere |
|----|-----|-------------|---------|
| TD-S01 | Goroutine | WriteSample-Goroutine pro Frame (30/s) | P3 |
| TD-S02 | Package Layout | Single `main` package, kein `internal/` | P3 |
| TD-S03 | Health Auth | Health-Endpoint ohne Authentifizierung | P2 |

---

### 4.6 Feature-Gaps

| ID | Feature | Beschreibung | Priorität |
|----|---------|-------------|-----------|
| FG-S01 | Multi-Track | Unterstützung für mehrere Video-Tracks (Multi-Camera) | P3 |
| FG-S02 | Audio-Passthrough | Audio-Track-Forwarding von ffmpeg | P3 |
| FG-S03 | Prometheus | `/metrics` Endpoint für Prometheus-Scraping | P3 |
| FG-S04 | Graceful Drain | Warten auf laufende Frame-Writes bei Shutdown | P3 |
| FG-S05 | Dynamic Bitrate | Adaptives Bitrate-Tuning basierend auf Netzwerk-Feedback | P3 |

---

## 5. Priorisierte Liste aller offenen Punkte

### P1 – Kritisch (sofortiger Handlungsbedarf)

| # | Projekt | ID | Beschreibung |
|---|---------|-----|-------------|
| 1 | Client | TD-C01 | **OTA-Update ohne Signatur-Verifizierung** – Remote-Codeausführung auf Robotern möglich |
| 2 | Monorepo | TD-05 | **API Test-Coverage ~0.5%** – Nur 6 Testdateien für 12.000 LoC |
| 3 | Monorepo | TD-06 | **Web Test-Coverage minimal** – Nur 5 Testdateien für 17.000 LoC |
| 4 | Client | TD-C03 | **Client Test-Coverage minimal** – Nur 2 Testdateien für 7.600 LoC |
| 5 | Monorepo | FG-01 | **Unit-Tests** – Auth, Gateway, Queue, Moderation brauchen Tests |
| 6 | Monorepo | FG-02 | **E2E-Tests** – Playwright für kritische Flows |
| 7 | Client | FG-C02 | **Update Rollback** – Kein Rollback bei fehlerhaften Updates |

### P2 – Wichtig (sollte zeitnah adressiert werden)

| # | Projekt | ID | Beschreibung |
|---|---------|-----|-------------|
| 8 | Monorepo | TD-01 | `bot.gateway.ts` God Object (1.447 Zeilen) – Chat, Moderation-Enforcement weiter auslagern |
| 9 | Monorepo | TD-02 | `robots.service.ts` God Service (1.452 Zeilen) – CRUD, Policies, Slug-Mgmt trennen |
| 10 | Monorepo | SEC-01 | WebSocket Gast-Rate-Limiting verschärfen – Massenhaft unauthentifizierte Connections möglich |
| 11 | Monorepo | SEC-02 | Redis Health-Check Passwort in docker-compose exposed |
| 12 | Monorepo | PERF-01 | N+1 Queries im Control-Command-Flow (~90+ DB-Queries/s bei Last) |
| 13 | Monorepo | PERF-02 | Status-Filter nach DB-Fetch statt als WHERE-Clause |
| 14 | Monorepo | TD-09 | Chat-Nachrichten werden nicht in DB persistiert |
| 15 | Monorepo | TD-07 | Inkonsistente Staff-Role-Erkennung (`isStaffRole` vs. Inline-Check) |
| 16 | Monorepo | FG-04 | Sentry-Integration fehlt (DSN ist vorbereitet) |
| 17 | Monorepo | FG-07 | Offline-UX – Kein Reconnect-Indicator im Frontend |
| 18 | Monorepo | UX-01 | Keine Toast/Notification-Systematik |
| 19 | Monorepo | UX-02 | Fehlende Skeleton-Loader für Dashboard/Robot-View |
| 20 | Client | TD-C02 | Mixin-Pattern ohne typsichere Protokolle |
| 21 | Client | SEC-C01 | Kein Certificate Pinning auf API-Verbindung |
| 22 | Client | FG-C03 | Kein lokaler Health-Endpoint |
| 23 | Streamer | TD-S03 | Health-Endpoint ohne Authentifizierung |
| 24 | Monorepo | ARCH-01 | Single-Instance Bottleneck – In-Memory WS-State nicht Redis-backed |

### P3 – Optional (Verbesserungen, Low Priority)

| # | Projekt | ID | Beschreibung |
|---|---------|-----|-------------|
| 25 | Monorepo | TD-03 | Slug-Update Duplikation refactoren |
| 26 | Monorepo | TD-04 | API-Client Proxy-Pattern aufräumen |
| 27 | Monorepo | TD-08 | controlCooldowns Memory-Leak Risiko (periodischer Cleanup) |
| 28 | Monorepo | TD-10 | Unused DB-Tabellen (SwarmGroup, Transaction, Analytics) |
| 29 | Monorepo | TD-11 | Unused Schema-Felder (aiAssistEnabled, ros2Enabled, balance, credits) |
| 30 | Monorepo | FG-05 | HTML Email-Templates |
| 31 | Monorepo | FG-06 | Internationalisierung (i18n) |
| 32 | Monorepo | FG-08 | OAuth / Social Login |
| 33 | Monorepo | FG-09 | User-Avatar Upload |
| 34 | Monorepo | FG-10 | Analytics Dashboard |
| 35 | Monorepo | FG-11 | Robot Scheduling |
| 36 | Monorepo | FG-12 | Webhook-Management UI |
| 37 | Monorepo | SEC-03 | Swagger in Dev standardmäßig aktiv |
| 38 | Monorepo | DOC-01 | Architecture Decision Records fehlen |
| 39 | Client | TD-C04 | `client_ops.py` aufteilen |
| 40 | Client | TD-C05 | Legacy-Config-Migration-Code separieren |
| 41 | Client | TD-C06 | Mypy strict mode aktivieren |
| 42 | Client | FG-C04 | Dokumentiertes Plugin-Interface |
| 43 | Client | FG-C05 | Startup Dependency-Check |
| 44 | Client | FG-C06 | Prometheus Metrics Export |
| 45 | Streamer | TD-S01 | WriteSample-Goroutine pro Frame optimieren |
| 46 | Streamer | TD-S02 | `internal/` Package-Layout |
| 47 | Streamer | FG-S01 | Multi-Track Support |
| 48 | Streamer | FG-S02 | Audio-Passthrough |
| 49 | Streamer | FG-S03 | Prometheus Endpoint |
| 50 | Streamer | FG-S04 | Graceful Frame-Drain bei Shutdown |
| 51 | Streamer | FG-S05 | Dynamic Bitrate Adaptation |

---

## 6. Konkrete Action Items

### Sprint 1: Sicherheit & Stabilität (P1)

- [x] **OTA-Update absichern (TD-C01):**
  - Signatur-Verifizierung für Git-Commits einführen (GPG-signed Tags)
  - Update-Whitelist für erlaubte Remote-URLs
  - Pre-Update Snapshot für Rollback
  - Kill-Switch: `BOTPARTY_DISABLE_REMOTE_UPDATE=true` als ENV
  - **Owner:** Client-Team | **Aufwand:** 3-5 Tage

- [x] **Test-Suite aufbauen (TD-05, TD-06, TD-C03):**
  - API: Unit-Tests für AuthService, RobotsService, QueueService, ModerationService, BotGateway
  - API: Integration-Tests mit Testcontainers (Postgres + Redis)
  - Web: Vitest-Tests für API-Client, Stores, Key-Components
  - Client: Pytest-Tests für Gateway, Config-Parsing, Command-Handling
  - **Owner:** Alle Teams | **Aufwand:** 2-3 Wochen

- [x] **E2E-Tests (FG-02):**
  - Playwright-Tests für: Register → Login → Create Robot → Dashboard → Robot-View → Queue
  - CI-Integration
  - **Owner:** Web-Team | **Aufwand:** 1 Woche

### Sprint 2: Performance & Architektur (P2)

- [x] **Control-Command Performance (PERF-01):**
  - Robot-Daten in Redis cachen (TTL 30s)
  - `findById()` durch Cache-First-Lookup ersetzen
  - Access-Policy Cache nutzen (existiert bereits teilweise)
  - **Owner:** API-Team | **Aufwand:** 2-3 Tage

- [x] **Gateway Refactoring (TD-01):**
  - Chat-Handler in eigene Datei extrahieren
  - Control-Command-Handler in eigene Datei extrahieren
  - Redis-Message-Handler in eigene Datei extrahieren
  - Ziel: `bot.gateway.ts` < 600 Zeilen
  - **Owner:** API-Team | **Aufwand:** 3-5 Tage

- [x] **DB-Query Optimierung (PERF-02):**
  - Status-Filter in `findAll()` als Prisma WHERE-Clause
  - Pagination-Counts über `count()` statt In-Memory
  - **Owner:** API-Team | **Aufwand:** 1 Tag

- [x] **Chat-Persistenz (TD-09):**
  - WebSocket-Chat in `ChatMessage`-Tabelle schreiben (async über BullMQ-Worker)
  - History-API für die letzten N Nachrichten beim Room-Join
  - **Owner:** API-Team | **Aufwand:** 2-3 Tage

- [x] **Frontend UX (UX-01, UX-02, FG-07):**
  - Toast-System mit Animationen implementieren
  - Skeleton-Loader für Dashboard, Robot-View
  - Offline-Banner mit Reconnect-Countdown
  - **Owner:** Web-Team | **Aufwand:** 3-4 Tage

### Sprint 3: Security Hardening (P2)

- [x] **Redis Health-Check (SEC-02):**
  - `redis-cli --no-auth-warning` verwenden oder healthcheck über TCP
  - **Owner:** DevOps | **Aufwand:** 30 Min

- [x] **Guest Rate-Limiting (SEC-01):**
  - IP-basiertes Rate-Limit für unauthentifizierte WS-Connections
  - Limit auf max. 5 gleichzeitige Gast-Sockets pro IP
  - **Owner:** API-Team | **Aufwand:** 1 Tag

- [x] **Monitoring Setup (FG-04):**
  - Sentry-Integration für API und Web
  - Structured Logging mit Correlation-IDs
  - **Owner:** API-Team + Web-Team | **Aufwand:** 2-3 Tage

- [x] **Staff-Role Konsistenz (TD-07):**
  - Einheitliche `isStaffRole()` Utility durchgängig verwenden
  - **Owner:** API-Team | **Aufwand:** 1 Stunde

### Sprint 4: Nice-to-Have (P3)

- [x] Code-Duplikation in robots.service.ts bereinigen
- [x] API-Client Proxy-Pattern in Web-App aufräumen
- [x] controlCooldowns periodischer Cleanup (setInterval)
- [x] Mypy strict mode für botparty-client aktivieren
- [x] GoDoc-Comments auf exportierten Typen im Streamer
- [x] Architecture Decision Records starten
- [x] Unused DB-Tabellen/Felder evaluieren (behalten oder entfernen)

---

## Zusammenfassung

### Stärken der Plattform

1. **Solide Sicherheits-Grundlage:** JWT + Refresh-Tokens, CSRF, Rate-Limiting, Helmet/CSP, Argon2id – die Auth-Schicht ist gut durchdacht.
2. **Saubere Monorepo-Struktur:** Turborepo + pnpm mit geteilten Packages funktioniert gut.
3. **WebSocket-Architektur:** Redis Pub/Sub, per-Event Rate Limits, Zod-Validierung – die Echtzeit-Schicht ist production-ready.
4. **Robot-Client Resilienz:** Graceful Shutdown, Supervisor, Auto-Reconnect, Hardware-Safety-Timeouts.
5. **Video-Streamer Performance:** Zero-Copy Pipelines, SPS/PPS Caching, Keyframe-Gating.

### Größte Risiken

1. **🔴 OTA-Updates ohne Signatur** – Remote-Code-Execution auf Robotern.
2. **🔴 Minimale Test-Coverage** – Regressions sind wahrscheinlich.
3. **🟡 God Objects** – Gateway und RobotsService sind Wartungs-Hotspots.
4. **🟡 N+1 Queries** – Performance-Degradation unter Last.
5. **🟡 Single-Instance WS-State** – Horizontale Skalierung eingeschränkt.

### Gesamtbewertung

| Projekt | Qualität | Security | Performance | Dokumentation |
|---------|----------|----------|-------------|---------------|
| **botparty (Monorepo)** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **botparty-client** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **botparty-streamer** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

> Die Plattform ist architektonisch solide und hat eine gute Sicherheits-Grundlage. Die dringendsten Maßnahmen sind die Absicherung des OTA-Update-Pfads, der Ausbau der Test-Coverage und die Performance-Optimierung der Echtzeit-Kontrollschicht.
