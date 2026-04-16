# BotParty – Vollständiger Projekt-Audit

> Stand: 2026-04-15 · Betrifft alle drei Repositories:
> `botparty` (Monorepo), `botparty-client` (Python), `botparty-streamer` (Go)

---

## Zusammenfassung

BotParty ist ein beeindruckend durchdachtes Projekt: ein modernes, self-hosted Roboter-Teleoperations-System mit WebRTC-Video, Queue-basierter Steuerung, Chat, Moderation, und einem ausgereiften Deployment-Stack. Die Architektur ist solide, das Feature-Set ist umfangreich, und die Developer-Experience (Monorepo, Turborepo, Prisma) ist professionell.

Dennoch gibt es klare offene Punkte in **Codequalität**, **Testabdeckung**, **Sicherheit**, **Nutzerfreundlichkeit**, **Performance** und **Feature-Vollständigkeit**, die in diesem Audit katalogisiert werden.

---

## Inhaltsverzeichnis

1. [Kritische Probleme](#1-kritische-probleme)
2. [Codequalität & Architektur](#2-codequalität--architektur)
3. [Testabdeckung](#3-testabdeckung)
4. [Sicherheit](#4-sicherheit)
5. [Nutzerfreundlichkeit (UX/UI)](#5-nutzerfreundlichkeit-uxui)
6. [Performance](#6-performance)
7. [DevOps & Deployment](#7-devops--deployment)
8. [Dokumentation](#8-dokumentation)
9. [Feature-Lücken & Ideen](#9-feature-lücken--ideen)
10. [Pro-Projekt-Detailbefunde](#10-pro-projekt-detailbefunde)
11. [Erweitertes Audit – Deep-Dive](#11-erweitertes-audit--deep-dive-april-2026)
12. [Erweiterte Prioritäten-Empfehlung](#erweiterte-prioritäten-empfehlung)
13. [Datei-Größen-Übersicht](#datei-größen-übersicht-refactoring-targets)

---

## 1. Kritische Probleme

### 1.1 Keine Testabdeckung in keinem der drei Projekte
- [x] **botparty**: Keine einzige Test-Datei (`*.test.ts`, `*.spec.ts`) im `apps/` oder `packages/` Verzeichnis
- [x] **botparty-client**: Null Python-Tests (`test_*`, `*_test.py`) gefunden
- [x] **botparty-streamer**: Null Go-Tests (`*_test.go`) gefunden
- **Risiko**: Jede Änderung kann unbemerkt Regressionen verursachen. Besonders kritisch bei Auth, Queue, Gateway, Moderation

### 1.2 Monolithische Dateien mit extremer Größe
- [x] `dashboard/page.tsx` → von **3.409 Zeilen / 155 KB** auf **1.297 Zeilen** reduziert, Kernbereiche in dedizierte Dashboard-Komponenten extrahiert
- [x] `robots.service.ts` → **2.032 Zeilen** — God-Object-Antipattern
- [x] `bot.gateway.ts` → **1.633 Zeilen** — WebSocket-Gateway mit zu vielen Verantwortlichkeiten
- [x] `livekit-player.tsx` → **1.221 Zeilen** — zu viel Logik in einer Komponente
- [x] `api.ts` (Frontend API Client) → **1.050 Zeilen** — sollte modular aufgeteilt werden

### 1.3 Node.js-Version unrealistisch hoch
- [x] `package.json` erfordert `node >= 24.0.0` — Node.js 24 ist aktuell nicht stabil released. Das blockiert neue Entwickler sofort

---

## 2. Codequalität & Architektur

### 2.1 Backend (NestJS API)

- [x] **`robots.service.ts` ist ein God Object**: CRUD, Slug-Management, Thumbnails (Filesystem-Ops!), Profanity-Filter, Access-Policies, Streaming-Config, Invite-Codes, Telemetry-Ingest, Log-Ingest, Actions-Queue — alles in einer Datei. Aufteilen in:
  - `RobotCrudService`
  - `RobotAccessService` (Policies, Invite-Codes, Allowed Users)
  - `RobotMediaService` (Thumbnails, Streaming-Config)
  - `RobotTelemetryService`
  - `RobotContentModerationService`
- [x] **`bot.gateway.ts` vereint zu viele Bereiche**: Room-Management, Presence, Queue-Turns, Chat, Control-Commands, Emergency-Stop, Moderation, Redis-PubSub. Aufteilen in Mixins oder Sub-Handler
- [x] **Profanity-Wordlist hardcoded in Service**: `SLUG_PROFANITY_TERMS` Array direkt im `robots.service.ts` — gehört in eine konfigurierbare Datei oder separate Moderation-Utility
- [x] **`body as never` Casts im Controller**: `robots.controller.ts` Zeile 109, 121, 133 — statt typisierter DTOs werden `Record<string, unknown>` genommen und unsicher gecastet
- [x] **Fehlende DTOs**: Controller nutzen `@Body() body: Record<string, unknown>` statt typisierter DTO-Klassen mit class-validator Dekoratoren (obwohl class-validator installiert ist)
- [x] **`ValidationPipe` mit `forbidNonWhitelisted: false`**: Unbekannte Felder werden still ignoriert statt abgelehnt — kann zu verwirrendem Verhalten führen
- [x] **Duplicate Error-Handling in Controller**: `getLogs()` Zeile 486-491 catchet `ForbiddenException` nur um es wieder zu werfen — nutzloser Code
- [x] **Keine einheitliche Error-Response-Struktur**: Manche Endpoints liefern `{ message: string }`, manche `{ ok: boolean }`, manche nur HTTP-Status
- [x] **`void username` Pattern**: `findByUsernameAndSlug()` und `findPrivateByUsernameAndSlugForUser()` nehmen `username` als Parameter, ignorieren ihn aber komplett mit `void username`. Entweder korrekt verwenden oder aus der Signatur entfernen
- [x] **Redis-Operationen ohne Pipeline-Batching** an mehreren Stellen: einzelne `redis.get()`/`redis.set()` Calls statt Pipelines in hot paths (z.B. Presence)
- [x] **Event-Strings nicht als Enum/Map konsolidiert**: `WS_EVENTS` existiert zwar im shared Package, aber Gateway konstruiert JSON-Strings manuell an vielen Stellen
- [x] **Keine Graceful-Shutdown-Garantie für laufende Sessions**: Aktive Steuerungs-Sessions und Queue-Einträge werden beim API-Shutdown nicht sauber abgeräumt

### 2.2 Frontend (Next.js)

- [x] **Dashboard ist nicht mehr kaputt-groß**: `page.tsx` von 3.409 auf 1.297 Zeilen reduziert, zentrale Bereiche in Subkomponenten extrahiert:
  - `CreateRobotPanel`
  - `DashboardSidebar`
  - `DashboardPreview`
  - `DashboardSettingsSection`
  - `DashboardTokenSection`
  - `DashboardOperationsSection`
  - `DashboardAllowlistSection`
  - `ControlButtonEditor`
  - `MonitoringSection`
- [x] **Dashboard-State-Management konsolidiert**: zentraler Zustand für Auswahl-, Formular- und Editor-Flow liegt jetzt in einem dedizierten Zustand-Store statt verteilt in vielen lokalen `useState`-Blöcken
- [x] **Kein Error-Boundary**: Keine React Error Boundaries implementiert — ein Fehler in einem Submodule crasht die ganze Seite
- [x] **Keine Loading-States/Skeleton-Screens** für die meisten Seiten (außer Nav hat einen `animate-pulse` Platzhalter)
- [x] **API URL-Resolution über `window.location.origin`**: Funktioniert für Single-Domain-Setups, aber bricht bei separater API-Domain. Der Fallback-Mechanismus in `resolveApiUrl()` ist fragil
- [ ] **Keine Internationalisierung (i18n)**: Alle Strings sind hardcoded Englisch — für ein Projekt mit deutschem Autor bemerkenswert
- [x] **Dropdown-Menu schließt nicht bei Klick außerhalb**: `onBlur` auf dem Dropdown-Container funktioniert nicht zuverlässig bei nicht-fokussierbaren Elementen
- [x] **TailwindCSS v4 ohne Config-Datei**: `apps/web/tailwind.config.ts` ergänzt und Theme-Tokens explizit hinterlegt
- [x] **UI-Komponenten-Bibliothek minimal**: UI-Layer um `badge`, `switch`, `dialog` erweitert und direkt in Nav/Settings verwendet

### 2.3 Python Robot Client

- [ ] **Mixin-basierte Architektur schwer zu navigieren**: `BotPartyClient` erbt von 4 Mixins (`ClientLifecycleMixin`, `ClientMediaMixin`, `ClientOpsMixin`, `ClientCommandsMixin`). Der Code ist über 5+ Dateien mit shared State verstreut — Reihenfolge der Method-Resolution ist nicht offensichtlich
- [x] **`__main__.py` mit 220 Zeilen Legacy-Mapping**: Sehr viel Code nur für die Rückwärtskompatibilität mit alten Config-Formaten. Sollte mit klarer Versionierung und Deprecation-Warnings gelöst werden
- [x] **Keine Type-Stubs für externe Dependencies**: Keine `py.typed` Marker, keine `mypy` Konfiguration — keine statische Type-Checking
- [x] **Keine `pyproject.toml`**: Projekt nutzt noch `requirements.txt`. Moderne Python-Projekte sollten `pyproject.toml` mit `[project]` Sektion verwenden
- [x] **Hardcoded `config.yaml` Pfad**: `config_path = Path("config.yaml")` ohne Override-Möglichkeit über CLI-Argument oder Env-Variable
- [x] **Kein Lock-File für Dependencies**: `requirements.txt` ohne Pinned Versions — nicht reproduzierbare Builds

### 2.4 Go Streamer

- [x] **Keine `go.work`-Integration**: Obwohl in der README als "plattformneutral" beschrieben, fehlt eine CI/CD-Build-Matrix
- [x] **Metrics nur per Log**: `botparty-streamer` exponiert zusätzlich `/metrics` im Prometheus-Format über `health.go`
- [x] **Kein Health-Endpoint**: Keine HTTP-Healthcheck-Route für Container-Orchestrierung
- [x] **Hardcoded Backoff-Formel**: `1.8^attempt` Exponential Backoff ohne Jitter — bei mehreren Streamern gleichzeitig können Reconnect-Thunders entstehen

---

## 3. Testabdeckung

- [x] **Backend Unit Tests**: Auth-Service, Queue-Service, Gateway-Handler haben Tests (`auth.service.spec.ts`, `queue.service.spec.ts`, `turn.handler.spec.ts`)
- [ ] **Backend Integration Tests**: 0% — Prisma + Redis in einem Testcontainer
- [x] **Frontend Component Tests**: Vitest + React Testing Library eingerichtet, Tests für `Nav`, `RobotCard`, `RobotQueuePanel` ergänzt
- [x] **Frontend E2E Tests**: Playwright-Setup mit erstem Smoke-Test (`apps/web/tests/e2e/smoke.spec.ts`) ergänzt
- [x] **Python Tests**: Hardware-Common-Utils Tests in `tests/test_hardware_common.py` (normalize_command, command_matches, get_int/float/str/pin_list)
- [x] **Go Tests**: `annexb_reader_test.go` mit Tests für NAL-Parser, Access Unit Assembler, IDR/SPS/PPS-Injection, RBSP-Decoding
- [x] **CI Pipeline**: `.github/workflows/ci.yml` in botparty und botparty-client vorhanden — Lint, Type-Check, und Test-Steps konfiguriert

---

## 4. Sicherheit

### 4.1 Bestehende Security-Maßnahmen (Positiv)
- ✅ JWT Access + Refresh Token Pattern mit Token-Versioning
- ✅ Argon2id Password Hashing
- ✅ RBAC (Admin → Mod → User)
- ✅ Rate Limiting (NestJS + Nginx)
- ✅ Helmet Security Headers
- ✅ CORS Origin Whitelist
- ✅ Zod Schema Validation
- ✅ Password-Reset-Tokens sind one-time, hashed, TTL-basiert
- ✅ Redis-basierter Robot-Claim-Lock gegen Duplicate-Sessions
- ✅ Input-Bind-Schutz im Streamer (Loopback-Only Default)

### 4.2 Offene Security-Punkte

- [x] **JWT Secret in `.env.example` ist unsicher**: `CHANGE_ME_IN_PRODUCTION_min_32_chars_long!!` steht als Default — Setup-Wizard generiert hoffentlich einen echten, aber .env.example hat Klartext-Defaults
- [x] **Seed-Passwörter leaken in Logs**: `console.log(`Password: ${adminPasswordPlain}`)` in `seed.ts` Zeile 127-128 — auch wenn nur in Dev, sollten Credentials nie in Logs stehen
- [x] **Kein CSRF-Schutz aktiv**: `@fastify/csrf-protection` ist als Dependency installiert aber wird in `main.ts` nicht registriert
- [x] **Cookie-basierte Auth ohne Double-Submit-Cookie**: Refresh-Token wird als HttpOnly Cookie gesendet, aber es gibt keinen CSRF-Token-Mechanismus — potentiell anfällig für CSRF auf dem `/auth/refresh` Endpoint
- [x] **Content-Security-Policy deaktiviert**: `contentSecurityPolicy: false` in Helmet-Config (Zeile 41) — sollte mindestens eine restriktive Policy haben
- [x] **Thumbnail-Upload akzeptiert Data-URLs**: `saveRobotThumbnail()` parst Base64 Data-URLs und schreibt direkt auf Disk — kein Virus-Scan, keine Content-Type-Validierung jenseits Extension, kein Größen-Limit explizit dokumentiert
- [x] **Chat-Profanity-Filter ist einfacher String-Match**: Leicht umgehbar mit Unicode-Substitution, Leerzeichen, Zero-Width-Characters
- [x] **Robot Auth Token ohne Expiry-Default**: `ROBOT_JWT_EXPIRES_IN` ist optional und hat keinen Fallback → Token ohne Expiry ist theoretisch möglich
- [x] **Kein Account-Lockout**: Keine Begrenzung der Login-Versuche pro Account (nur allgemeines Rate-Limiting)
- [x] **WebSocket-Verbindung sendet keine Origin-Prüfung**: CORS ist konfiguriert, aber WebSocket-Upgrades überprüfen den Origin nicht immer zuverlässig
- [x] **`trustProxy: true` ohne Einschränkung**: Fastify vertraut allen Proxy-Headern — sollte auf bekannte Proxy-IPs eingeschränkt werden

---

## 5. Nutzerfreundlichkeit (UX/UI)

### 5.1 Positiv
- ✅ Sauberes Dark-Mode-Design mit durchdachter Farbpalette
- ✅ Inter Font, CSS Custom Properties, konsistentes Design-System-Ansatz
- ✅ Mobile-Responsive Nav mit Hamburger-Menu
- ✅ Guest-Modus ermöglicht Zuschauer ohne Account
- ✅ Real-time Stats auf der Startseite
- ✅ "Stats for Nerds" Overlay im Video-Player — professionell
- ✅ Multi-Kamera-Support mit Drag-and-Drop Preview-Tray

### 5.2 Offene UX-Punkte

- [x] **Kein Onboarding-Flow**: Neue Benutzer bekommen keine Anleitung — Dashboard öffnet und man muss alles selbst herausfinden
- [x] **Keine Bestätigungs-Dialoge**: Delete, regenerate token, regenerate invite code — alle nutzen `window.confirm()` in dashboard/page.tsx
- [ ] **Registrierung nur über E-Mail/Passwort**: Kein Social Login (GitHub, Google, Discord) — für eine Community-Plattform ungewöhnlich
- [x] **Kein "Vergessen" von E-Mail-Adresse im Login-Form**: Passwort-Vergessen funktioniert, aber E-Mail-Adresse wird nicht für Autocomplete gespeichert
- [x] **Leaderboard-Page existiert in der Nav, aber Funktionalität unklar**: Route existiert (`/leaderboard`), aber keine sichtbare Implementierung analysiert
- [x] **Explore-Seite hat keinen Realtime-Refresh**: Roboter-Karten werden statisch geladen — wenn ein Robot online geht, muss man manuell refreshen
- [x] **Toast-Nachrichten fehlen bei vielen Aktionen**: Das Toast-System existiert, wird aber nur sparsam genutzt
- [x] **Mobile Touch Controls fehlen**: Touch-fähige D-Pad-/Button-Steuerung und mobile Quick-Actions sind im Robot-Room vorhanden
- [x] **Kein Fullscreen-Modus für den Video-Player**: Fullscreen-Button in video-renderer.tsx mit `requestFullscreen`/`exitFullscreen` API hinzugefügt
- [x] **Queue-Position wird nicht als Notification gezeigt**: Browser-Notifications für Queue-Positionswechsel und Turn-Start ergänzt
- [x] **Settings-Seite hat 6.6 KB** — Settings um Theme-Auswahl, Queue-Notifications, lokale Dashboard-Präferenzen und sauberen Delete-Dialog erweitert
- [x] **404-Seite fehlt**: Kein Custom 404-Layout im `app/` Verzeichnis
- [x] **Docs-Seite existiert als Route** (`/docs`) aber vermutlich nur ein Redirect zur externen GitHub-Docs — kein integriertes Docs-System
- [x] **Kein Dark/Light Mode Toggle**: System/Dark/Light-Umschaltung via Preferences-Store + `ThemeController` ergänzt
- [x] **Accessibility-Audit umgesetzt**: zusätzliche ARIA-Labels an Dashboard-Aktionen ergänzt und Keyboard-Navigation im Dashboard mit Komponententest abgesichert
- [x] **Kein Feedback wenn Robot offline ist beim Betreten eines Raums**: Nutzer sieht nur ein leeres Video — kein klarer "Robot ist offline"-Hinweis

---

## 6. Performance

- [x] **`force-dynamic` auf der Startseite**: `page.tsx` Zeile 6 erzwingt SSR für jede Request. ISR mit `revalidate: 10` wäre besser
- [x] **Dashboard lädt alles auf einmal**: 155 KB Page-Component ohne Code-Splitting, Lazy Loading, oder Suspense Boundaries
- [x] **Bildoptimierung für Robot-Thumbnails**: Upload-Pfad normalisiert serverseitig auf skalierte WebP-Thumbnails statt Raw-Dateien ungefiltert zu speichern
- [x] **Thumbnail-Cache nur 5 Minuten**: `Cache-Control: public, max-age=300` — für selten wechselnde Bilder zu kurz
- [x] **LiveKit Player initialisiert immer alle Tracks**: Kein Lazy-Track-Subscription — bei vielen Kameras potentiell problematisch
- [x] **Redis Policy-Cache hat kein TTL-Management sichtbar**: `policyCache` Map in `robots.service.ts` wächst unbegrenzt während der Prozess-Lebensdauer (kein LRU, kein Max-Size)
- [x] **Gateway broadcastet JSON.stringify bei jeder Message**: Für High-Frequency Events (Crowd Input Echo) sollte die serialisierte Message gecacht werden
- [x] **`findAll()` in Robots-Service hat keine Pagination**: Lädt ALLE public Robots in einer Query — skaliert nicht bei hunderten/tausenden Robots
- [x] **Keine DB-Connection-Pooling-Config sichtbar**: Prisma Default Pool-Size könnte für Production zu klein sein

---

## 7. DevOps & Deployment

### 7.1 Positiv
- ✅ Vollständiger Docker Compose Stack mit separaten Netzwerken (internal/frontend)
- ✅ Health-Checks auf allen Services
- ✅ Setup-Wizard (`setup-env.sh`) für Ersteinrichtung
- ✅ Multi-Stage Docker Builds
- ✅ LiveKit + Ingress + Egress vollständig integriert
- ✅ cAdvisor für Container-Monitoring (Mod-Dashboard)
- ✅ Nginx Reverse Proxy mit SSL-Support
- ✅ systemd Services für Robot-Client und Streamer

### 7.2 Offene Punkte

- [x] **`.env` Datei ist im Repository** (1.837 Bytes! — und `.env.bak`): `.env` enthält wahrscheinlich echte Secrets → **SOFORT aus Git entfernen und History bereinigen**
- [x] **Keine CI/CD Pipeline sichtbar**: `.github/` existiert, aber keine Workflow-Files analysiert — Build, Lint, Test, Deploy automatisieren
- [x] **Kein `docker-compose.dev.yml`**: Dev und Prod teilen sich eine Compose-Datei — sollten getrennt sein
- [x] **Kein Container-Image-Tagging**: Keine Version-Tags für API/Web Images — nur `latest` implied
- [x] **LiveKit Image `latest` Tag**: `livekit/livekit-server:latest` ist nicht reproduzierbar — Version pinnen
- [x] **Postgres Port auf 5433 gemappt**: Nicht-Standard-Port kann verwirrend sein. Dokumentieren oder auf 5432 setzen
- [x] **Redis Port exponiert (localhost:6379)**: Auch bei Localhost-Binding — in Production sollte Redis nicht exponiert sein
- [x] **cAdvisor mit `privileged: true`**: Notwendig für Container-Metrics, aber Security-Risiko — in der Docs dokumentieren
- [x] **Backup-Strategie fehlt**: Kein pg_dump Cron, kein Volume-Backup-Script
- [x] **Kein Log-Aggregation**: Logs nur über `docker compose logs` — kein Loki/ELK/Sentry
- [x] **Selektive Container-Builds vorhanden**: Root-Skripte für gezielte `docker compose build`-/`up`-Flows für API, Web, App und Core-Infrastruktur ergänzt
- [x] **Kein Rollback-Mechanismus**: Deployment ist `docker compose up -d --build` — bei Fehler kein einfacher Rollback

---

## 8. Dokumentation

### 8.1 Positiv
- ✅ Ausführliche READMEs in allen drei Repos
- ✅ Architektur-Diagramme im Haupt-README
- ✅ Bot-Client hat eigene Docs-Sektion mit Hardware/Video/TTS-Profilen
- ✅ Streamer-README mit plattformspezifischen ffmpeg-Beispielen
- ✅ Config-Referenz mit allen Env-Variablen
- ✅ Swagger/OpenAPI in Development

### 8.2 Offene Punkte

- [x] **Kein CONTRIBUTING.md**: Keine Contributor-Guidelines, Code-Style-Guide, PR-Template
- [x] **Kein CHANGELOG.md**: Keine Versions-Historie in keinem Repo
- [x] **API-Dokumentation nur in Dev**: Swagger ist in Production deaktiviert — eine öffentliche API-Docs-Seite wäre sinnvoll
- [x] **Shared Package undokumentiert**: `@botparty/shared` hat keine README — Typen, Schemas, Constants nicht erläutert
- [x] **`.env.example` unvollständig**: Mehrere Env-Variablen die in `docker-compose.yml` referenziert werden fehlen im Example (z.B. `APP_URL`, `SMTP_*`, `LIVEKIT_PUBLIC_URL`, `LIVEKIT_RECORDINGS_DIR`)
- [x] **Architecture Decision Records (ADRs) fehlen**: Warum WebSocket (ws) statt Socket.IO? Warum Fastify statt Express? Warum Pydantic statt dataclasses? Diese Entscheidungen sollten dokumentiert sein
- [x] **Hardware-Adapter-Dokumentation ist uneinheitlich**: 28 Hardware-Adapter existieren, aber nicht alle haben Docs
- [x] **Kein Runbook für Production-Incidents**: Was tun bei DB-Corruption? LiveKit-Ausfall? Redis-OOM?

---

## 9. Feature-Lücken & Ideen

### 9.1 Aus README bekannte offene Punkte
- [ ] Session Recording & Replay
- [ ] Analytics Dashboard für Robot Hosts
- [ ] Voting Queue Improvements
- [ ] ROS2 Integration
- [x] Mobile Touch Controls
- [x] Leaderboard / Community Features
- [ ] Credit/Priority System Implementation

### 9.2 Weitere Feature-Ideen

- [ ] **Audio-Bidirektional**: Aktuell nur Video + TTS → Voice-Chat zwischen Fahrer und Robot (Push-to-Talk)
- [ ] **Clip/Highlight-System**: Nutzer können 15-Sekunden-Clips speichern und teilen
- [ ] **Robot-Scheduling UI**: Schedule-Felder existieren im Schema, aber es gibt keine UI dafür
- [ ] **Swarm-Control UI**: SwarmGroup-Model existiert in Prisma, keine Frontend-Implementierung
- [ ] **Webhook-System**: Events bei Robot-Online/Offline, Session-Start/End für externe Integrationen (Discord-Bot, etc.)
- [ ] **APIv2 mit OpenAPI-First-Design**: Aktuelle API ist organisch gewachsen — ein sauberes API-Design mit Versionierung wäre langfristig besser
- [ ] **Plugin-System für Robot-Client**: Hardware-Adapter sind aktuell hard-coded Imports — ein echtes Plugin-System mit Discovery wäre flexibler
- [x] **OBS/Streaming-Integration**: WHIP Ingress dokumentiert, inklusive dedizierter OBS/WHIP-Setup-Guide unter `/docs/obs-whip`
- [x] **Gamepad-API-Support im Browser**: Robot-Room unterstützt Gamepad Left-Stick / D-Pad für Richtungssteuerung
- [x] **Latenz-Overlay im Video**: aktuelle RTT wird direkt als kleines Overlay im Video angezeigt
- [x] **Robot-Preview-Image Auto-Capture**: Dashboard erzeugt bei live verbundenen Robots ohne Thumbnail automatisch ein Snapshot-Thumbnail aus dem aktuellen Video-Feed
- [ ] **Spectator-Chat-Reactions**: Emoji-Reactions im Chat-Stream (floating emoji overlay)
- [ ] **Multi-Language TTS**: TTS-System aktuell nur eine Sprache — Auto-Detect wäre cool
- [x] **Robot-Fleet-Dashboard**: Dashboard zeigt jetzt eine Fleet-Übersicht mit Gesamtzahl, Live-/Busy-/Offline-Status, Viewern und aktueller Auswahl
- [ ] **Public API für Third-Party-Clients**: Aktuell nur interner API-Client — ein stabiles Public API wäre community-fördernd
- [ ] **PWA-Support**: Service Worker für Offline-Caching und Push-Notifications bei Queue-Turn
- [x] **Embed-Widget**: Embed-Route für Robot-Streams plus copybares `<iframe>`-Snippet im Dashboard vorhanden
- [ ] **Screen-Recording für Sessions**: Serverseitiges Recording des gesamten Steuerungs-Erlebnisses, nicht nur Video

---

## 10. Pro-Projekt-Detailbefunde

### 10.1 botparty (Monorepo)

#### Shared Package
- [x] Typen und Schemas sind sauber strukturiert (`types/`, `schemas/`, `constants/`)
- [x] Aber: kein `README.md`, keine Versionierung unabhängig vom Monorepo

#### Prisma Schema
- [x] **Gutes Schema-Design**: Klare Enums, gute Indexierung, sinnvolle Relationen
- [x] `RobotVisibility.UNLISTED` hat Frontend-UI im Dashboard/Create-Flow (`roomMode = UNLISTED`)
- [ ] `SwarmGroup` Model existiert, wird aber nirgends verwendet → Dead Feature oder Future Work
- [ ] `AnalyticsEvent` Tabelle existiert, aber es gibt keinen sichtbaren Analytics-Ingest
- [ ] `Transaction` Tabelle für Credits/Currency — Schema da, aber kein Feature implementiert
- [ ] `SessionStatus.RECORDING` Enum-Wert existiert, aber Recording ist als "coming soon" markiert
- [x] Fehlende Indexes: `ChatMessage` hat keinen Index auf `userId` allein — bei User-History-Abfragen problematisch

#### ESLint / Prettier
- [x] ESLint-Config existiert als Shared Package — gut
- [x] Prettier-Config vorhanden — gut
- [x] Aber: Kein Lint-CI-Check nachgewiesen

#### Turbo Config
- [x] Sauber konfiguriert mit Build/Dev/Lint/Typecheck Tasks
- [x] `db:generate` und `db:push` als separate Tasks — gut

### 10.2 botparty-client (Python)

- [x] **28 Hardware-Adapter** — beeindruckend breite Hardware-Unterstützung
- [x] **12 Video-Profile** — von FFmpeg über libcamera bis botparty-streamer
- [x] **13 TTS-Profile** — von espeak bis Google Cloud und Amazon Polly
- [x] **One-Command-Install-Script** (`install-botparty-client.sh`) — gute DX
- [x] **systemd Integration** — produktionsreif
- [x] **Multi-Camera Support** — fortschrittlich
- [x] `requirements.txt` hat 4 Dependencies — schlank und gut

#### Offene Punkte Client
- [x] **Kein `setup.py` / `pyproject.toml`**: Nicht als Python-Package installierbar
- [x] **`hardware_custom.py` im Root-Verzeichnis**: In `.gitignore` eingetragen (`# Your local hardware implementation - keep out of git`)
- [x] **`__pycache__` Ordner nicht in `.gitignore`**: `__pycache__/` und `*.py[cod]` sind in `.gitignore` eingetragen
- [x] **Kein Typing-Enforcement**: Keine mypy, pyright, oder ruff Type-Checking
- [x] **Kein Linter**: Kein ruff, flake8, oder black konfiguriert
- [ ] **`config.example.yaml` ist 10 KB**: Wahrscheinlich gut dokumentiert, aber die schiere Größe deutet auf Overengineering der Config hin
- [x] **Fehlende `__init__.py` Docstrings**: `botparty_robot/__init__.py` hat jetzt ein Paket-Docstring

### 10.3 botparty-streamer (Go)

- [x] **Architektur ist sauber**: Klare Trennung zwischen Input, Assembly, Publishing
- [x] **Low-Latency-Design durchdacht**: Frame-Dropping, Stale-Detection, Keyframe-Wait, Queue-Drain
- [x] **Token-Backend fail-closed**: Sicherheit by Default — gut
- [x] **Cross-Platform Build** via Build-Tags (`signals_unix.go`, `signals_windows.go`)
- [x] **Install-Script** mit `--arch` und `--version` Flags — produktionsreif

#### Offene Punkte Streamer
- [x] **README ist komplett auf Deutsch**: Inkonsistent mit den anderen (englischen) Repos
- [ ] **Kein Graceful-Shutdown Test**: Cleanup-Pfade sind implementiert, aber ungetestet
- [x] **`version = "dev"` Default**: CI-Build-Matrix setzt `main.version` via `-ldflags="-X main.version=..."` in `.github/workflows/ci.yml`
- [ ] **Token-Backend-Example** (`examples/token-backend-node/`) hat eigene Dependencies — separater Maintenance-Aufwand
- [ ] **Metrics ohne Retention**: Log-basierte Metrics gehen verloren beim Restart
- [x] **Annex-B Reader Bug-Potenzial**: `annexb_reader.go` ist jetzt vollständig durch `annexb_reader_test.go` abgedeckt (27 Tests: NextNALU, findStartCode, AccessUnitAssembler, IDR-Frames, SPS/PPS-Injection, RBSP-Decoding)
- [x] **Kein Build-Caching in CI**: `actions/setup-go@v5` nutzt `cache: true` in der Streamer-CI

---

## Prioritäten-Empfehlung

| Priorität | Bereich | Punkt |
|-----------|---------|-------|
| 🔴 P0 | Security | `.env` aus Git-History entfernen |
| 🔴 P0 | Testing | Mindestens Auth + Queue + Gateway Unit-Tests |
| 🔴 P0 | Code | Dashboard-Page aufteilen (3.409 Zeilen) |
| 🟡 P1 | Code | `robots.service.ts` in Sub-Services aufteilen |
| 🟡 P1 | Code | `bot.gateway.ts` in Sub-Handler aufteilen |
| 🟡 P1 | Security | CSP aktivieren, CSRF implementieren |
| 🟡 P1 | Security | Robot JWT Default-Expiry setzen |
| 🟡 P1 | DevOps | Node.js Version auf 22 LTS senken |
| 🟡 P1 | DevOps | CI Pipeline mit Lint + Type-Check + Test |
| 🟡 P1 | Performance | Pagination für Robot-Liste |
| 🟡 P1 | UX | Mobile Touch Controls |
| 🟡 P1 | UX | Error Boundaries + Loading States |
| 🟢 P2 | Testing | E2E Tests (Playwright) |
| 🟢 P2 | Testing | Python + Go Unit Tests |
| 🟢 P2 | Code | Frontend API Client aufteilen |
| 🟢 P2 | UX | Fullscreen Video + PWA |
| 🟢 P2 | Docs | CONTRIBUTING.md + CHANGELOG.md |
| 🟢 P2 | Features | Session Recording |
| 🟢 P2 | Features | Analytics Dashboard |
| ⚪ P3 | Features | Social Login |
| ⚪ P3 | Features | Gamepad API |
| ⚪ P3 | Features | Embed Widget |
| ⚪ P3 | Features | Webhook System |

---

> Dieses Audit wurde am 15.04.2026 erstellt und deckt den aktuellen Stand aller drei Repositories ab.
> Insgesamt ist BotParty ein technisch ambitioniertes Projekt mit solidem Foundation-Code.
> Die Hauptprobleme liegen in fehlender Testabdeckung, überdimensionierten Einzeldateien,
> und einigen Security-Härtungslücken — alles behebbar mit fokussiertem Aufwand.

---

## 11. Erweitertes Audit – Deep-Dive (April 2026)

Dieser Abschnitt enthält die Ergebnisse eines zweiten, tiefgehenden Reviews aller Quelldateien.

---

### 11.1 Backend (API) – Zusätzliche Befunde

#### 11.1.1 Moderation Service God-Object
- [x] **`moderation.service.ts` → 1.888 Zeilen** — ein zweites God-Object neben robots.service. Vereint:
  - Profanity-Filter (Regex-basiert, Multi-Sprach-Wordlists)
  - Ban/Timeout/Kick-Management
  - Redis-Profanity-Counters und Event-Logging
  - Admin-Runtime-Overview (LiveKit-Telemetry, cAdvisor, Queue-Snapshots)
  - Robot-Action-Enqueueing
  - Recording-Start/Stop (delegiert an LiveKit)
  - LiveKit Room-Runtime-Stats-Aggregation
  - cAdvisor Container-Metrics-Fetching
  - **Empfehlung**: Aufteilen in `ProfanityService`, `RestrictionService`, `RuntimeTelemetryService`, `RecordingAdminService`

#### 11.1.2 Mod-Dashboard Page (Frontend)
- [x] **`mod/page.tsx` → 1.965 Zeilen** — ein drittes Monster-File. Enthält:
  - 4 View-Modes (Moderation, Runtime, Robots, Users) in einer Datei
  - Robot-Draft-State-Management (Inline-Forms für CRUD)
  - User-Draft-State-Management (Inline-Forms für Accounts)
  - Recording File Management (Filter, Playback, Delete)
  - 30+ `useState` Hooks in einer Komponente
  - **Empfehlung**: Jeder View-Mode wird eine eigene Komponente (`ModerationView`, `RuntimeView`, `RobotAdminView`, `UserAdminView`)

#### 11.1.3 Robot-View Page (Frontend)
- [x] **`robot/[slug]/robot-view.tsx` → 2.741 Zeilen** — ebenfalls massiv. Enthält:
  - WebSocket-Lifecycle (Connect, Reconnect, Message-Handling)
  - Keyboard-Steuerung (WASD + Custom-Hotkeys)
  - Queue-State, Turn-Countdown, Vote-Management
  - Chat (Send, Receive, Scroll, History-Persistence)
  - Widget-System (Slider, XY-Pad) mit komplexem Config-Parsing
  - Recording-Controls für Admins
  - Access-Gate (Password, Invite-Code, Allowlist)
  - Guest-Session-Management
  - **Empfehlung**: Mindestens 6 Subcomponenten extrahieren: `ChatPanel`, `ControlPanel`, `QueueOverlay`, `WidgetRenderer`, `AccessGate`, `RecordingControls`

#### 11.1.4 API Error Handling
- [x] **Kein globaler Exception-Filter**: `AllExceptionsFilter` in `src/filters/all-exceptions.filter.ts` implementiert und in `main.ts` via `useGlobalFilters()` registriert
- [x] **`BadRequestException` für alles**: Sowohl Validation- als auch Business-Logic-Fehler werfen `BadRequestException` — keine semantische Unterscheidung
- [x] **`_assertStaffOrOwner()` Pattern wiederholt**: Autorisation-Checks sind private Methoden, die in jedem Service dupliziert werden, statt ein zentrales Guard/Decorator-Pattern

#### 11.1.5 Controls Service
- [x] **In-Memory Button-Cache ohne Eviction**: `enabledButtonsCache` (Map) hat TTL pro Key (5s), aber Keys werden nie entfernt (nur überschrieben) — langsames Memory-Leak bei tausenden Robots
- [x] **Default-Buttons bei keiner Konfiguration**: Wenn ein Robot keine Buttons hat, werden Default-WASD-Buttons zurückgegeben — aber gleichzeitig beim erstellen neuer Buttons automatisch 4 Default-Buttons erstellt. Potentielle Race-Condition

#### 11.1.6 Queue & Session Service
- [x] **Queue-Position Recomputation ist O(n) pro Vote**: `recomputeQueueVotes()` sortiert und updated alle Positionen bei jeder Vote-Änderung — skaliert schlecht bei großen Queues
- [x] **Session-Duration wird client-seitig berechnet**: `durationMs` in der Session-Tabelle wird erst beim Session-End gesetzt — bei Crash/Disconnect bleibt `null`
- [x] **Kein Session-Timeout-Enforcer**: `maxTurnTime` wird nicht serverseitig erzwungen — nur der Client zeigt einen Countdown

#### 11.1.7 Mail Service
- [x] **Password-Reset-Email ist Plaintext**: Keine HTML-Templates, keine Branding — unprofessionell für User-facing E-Mails
- [x] **Kein E-Mail-Verification bei Registrierung**: Registrierung unterstützt verifizierungsabhängigen Flow über `REQUIRE_EMAIL_VERIFICATION`, Mail-Versand und `/auth/verify-email`
- [x] **SMTP-Credentials nicht mehr nur Klartext in Docker-Env**: API unterstützt jetzt `SMTP_PASSWORD_FILE` und andere `*_FILE`-Secrets für Secret-Mounts

#### 11.1.8 Gateway WebSocket
- [x] **Kein WebSocket-Heartbeat vom Server**: Nur der Client sendet Heartbeats — der Server erkennt tote Verbindungen nur über TCP-Timeout
- [x] **Chat-History nicht persistent geladen**: Robot-Room lädt und speichert Chat-Verlauf clientseitig in `localStorage`, sodass Reconnects den Verlauf behalten
- [ ] **Crowd-Input-Aggregation im Client**: Crowd-Control-Daten werden pro-Client gesendet und per Redis-PubSub verteilt — bei hunderten Clients potentiell O(n²) Broadcasts
- [x] **Kein Rate-Limiting auf WebSocket-Level**: Ein Client kann theoretisch unlimitiert Events senden — nur HTTP-Endpoints sind rate-limited

---

### 11.2 Frontend – Zusätzliche Befunde

#### 11.2.1 LiveKit Player Component
- [x] **`livekit-player.tsx` → 1.221 Zeilen** mit eigenem Stats-Polling, NerdStats-Overlay, Draggable-Panel, Sparkline-Charts, Volume-Control, Multi-Camera-Switching — alles inline
- [x] **WebRTC-Stats-Polling alle 1000ms**: Potentiell performancekritisch auf schwachen Geräten — sollte konfigurierbar oder on-demand sein
- [x] **Reconnect-Handling bei track-unmute ergänzt**: LiveKit-Renderer überwacht `TrackUnmuted` und stößt aktiv Recovery an, wenn nach dem Unmute kein decodierbares Videobild zurückkommt

#### 11.2.2 API Client (`lib/api.ts`)
- [x] **1.050 Zeilen monolithischer API-Client**: Eine Klasse mit 60+ Methoden — sollte nach Domain aufgeteilt werden (`api/auth.ts`, `api/robots.ts`, `api/admin.ts`, etc.)
- [x] **Token-Refresh-Race-Condition**: `api.setToken()` wird global aufgerufen, aber bei parallelen Requests kann ein expired Token genutzt werden bevor der Refresh greift
- [x] **Kein automatisches Token-Refresh**: Token-Ablauf wird nicht proaktiv behandelt — erst wenn ein 401 zurückkommt
- [ ] **Error-Handling-Pattern inkonsistent**: Manche Methoden werfen, manche geben `null` zurück, manche haben Try/Catch — keine Konvention

#### 11.2.3 Auth Store (Zustand)
- [x] **Kein Persistence-Layer**: Auth-State (Token, User) wird nicht persistent gespeichert — bei Page-Reload geht der Login verloren (muss über Cookie-Refresh wiederhergestellt werden)
- [x] **Kein Token-Expiry-Tracking**: Store speichert den Token, aber nicht wann er abläuft — Client weiß nicht wann ein Refresh nötig ist

#### 11.2.4 Explore & Leaderboard Pages
- [x] **Server-Side-Rendering ohne Caching**: `cache: 'no-store'` auf allen Fetch-Calls — bei jeder Navigation wird die API aufgerufen
- [x] **Leaderboard hat kein Link zum Robot-Room**: Robot-Namen in der Tabelle sind nicht anklickbar — Man sieht Rankings, kann aber nicht direkt zum Room navigieren
- [x] **Explore-Seite Filter ist ein `<form method="get">`**: Voller Page-Reload bei jedem Filter-Change — sollte clientseitig mit URL-State-Sync sein
- [x] **Keine Pagination auf Explore**: Alle Robots werden in einem Call geladen

#### 11.2.5 SEO & Meta
- [x] **Robot-Pages haben gutes SEO**: OG Tags, Twitter Cards, Canonical URLs — ✅
- [x] **Aber: Keine `robots.txt`** sichtbar
- [x] **Keine `sitemap.xml`** generierung
- [x] **Explore/Leaderboard haben statische Metadata** ohne Dynamic Preview

---

### 11.3 Python Client – Tiefe Analyse

#### 11.3.1 Gateway Connection
- [x] **Reconnect-Delay ohne Jitter**: `min(2 ** min(attempt, 6), 30)` Backoff — bei mehreren Clients die gleichzeitig reconnecten entsteht ein Thundering-Herd
- [x] **WebSocket-Heartbeat Timing mismatch**: Client sendet Heartbeat nach 10s Timeout, aber sendet auch einen separaten HTTP-Heartbeat alle 15s — doppeltes Heartbeat-System
- [x] **`_pull_actions` Polling zusätzlich zum WebSocket**: Jede 2.5 Sekunden wird ein `robot:actions:pull` Event gesendet — redundant wenn Actions bereits per WebSocket gepusht werden

#### 11.3.2 Client Operations
- [x] **`os.execv()` für Client-Update**: Restart räumt vorher Media-Tasks, Room, HTTP-Session, Hardware-Stop und Gateway-Verbindung kontrolliert ab
- [ ] **`git pull --ff-only` ohne Auth**: Remote-Update über Git Pull funktioniert nur mit SSH-Key oder öffentlichem Repo — bei HTTPS mit Credentials scheitert es
- [x] **CPU-Messung ist Delta-basiert**: `_read_cpu_percent()` braucht zwei aufeinanderfolgende Samples — erster Call gibt immer `None` zurück
- [x] **Temperatur-Reading nur für Linux**: `/sys/class/thermal/` Pfade existieren nur auf Linux — auf macOS/Windows ist `temperatureC` immer `null`
- [x] **psutil Optional-Import im Hot-Path**: `import psutil` wird bei jedem Telemetry-Send versucht und gefangen — sollte einmalig beim Start geprüft werden

#### 11.3.3 Camera Pipeline
- [x] **Adaptive FPS-Throttling ist clever**: Performance-Cap mit automatischer Recovery — ✅
- [ ] **Aber: `418 Zeilen` für `_loop_ffmpeg()`**: Sehr lange Funktion mit 15+ lokalen Variablen — sollte in kleinere Methoden aufgeteilt werden
- [ ] **OpenCV Import auf Modul-Ebene fehlt**: `import cv2` geschieht erst in `_loop_cv2()` — gute Lazy-Loading-Praxis, aber der Import-Error-Pfad gibt nur eine Warnung und returned still (keine Exception)
- [x] **Camera-Warmup mit suppressed Exceptions**: Warmup-Frames werden mit `contextlib.suppress(Exception)` gelesen — jeder Startup-Fehler wird verschluckt

#### 11.3.4 Hardware Base Class
- [ ] **Thread-Safety nicht garantiert**: `on_command()` wird über `asyncio.to_thread()` aufgerufen — wenn Hardware-Adapter nicht threadsafe sind, gibt es Race-Conditions
- [ ] **Kein Hardware-Discovery**: Welcher Adapter aktiv ist, wird über Config bestimmt — kein Auto-Discovery von verbundener Hardware
- [x] **`command_context` ist mutable shared state**: `set_command_context()` kopiert eingehenden Kontext defensiv via `dict(context or {})`

#### 11.3.5 Video Profile Architecture
- [ ] **`botparty_streamer.py` spawnt Shell-Command**: `spawn_livekit_process()` baut einen 20-Zeilen Bash-Script-String zusammen und ruft es per `create_subprocess_shell()` auf — komplex, aber notwendig für ffmpeg+publisher Co-Process-Management
- [x] **Shell-Injection theoretisch möglich**: Obwohl `shlex.join()` für die Kommandos verwendet wird, könnte ein manipulierter `camera.device` Pfad per Config injiziert werden
- [x] **JWT-Token-Decode ohne Verification**: `_decode_token_payload()` in `botparty_streamer.py` decoded das JWT-Payload ohne Signatur-Prüfung — ist nur für Identity/Room-Extraction, aber trotzdem un-ideal
- [ ] **TCP Port Collision**: `_tcp_port()` berechnet den Port per CRC32 des Camera-IDs — bei Hash-Kollisionen binden zwei Cameras auf denselben Port

#### 11.3.6 TTS Architecture
- [ ] **13 TTS-Profile** mit sauberem Base-Class-Pattern — ✅
- [ ] **Aber: Google Cloud und Polly Profile haben Credentials im Config**: API-Keys/Secrets werden direkt aus der `config.yaml` geladen — kein Secrets-Management

---

### 11.4 Go Streamer – Tiefe Analyse

#### 11.4.1 Access Unit Assembler
- [x] **`annexb_reader.go` ist der kritischste Code des Streamers**: Vollständig durch `annexb_reader_test.go` abgedeckt (27 Tests)
- [ ] **Guard-Flush bei `max_au_bytes`/`max_au_nalus`**: Access-Units werden bei Limits geflusht — aber ob das resultierende Frame decodierbar ist, wird nicht validiert
- [x] **Kein SPS/PPS Caching**: `lastSPS`/`lastPPS` Felder im `AccessUnitAssembler` implementiert — SPS/PPS werden auf IDR-Frames vor-gepended wenn nicht bereits im AU enthalten. `SeedSPSPPS()` ermöglicht Carry-Over bei Reconnects

#### 11.4.2 Publisher Session
- [ ] **Kein Track-Unpublish bei Disconnect**: `Close()` ruft `Room.Disconnect()` auf, aber unpublisht den Track nicht vorher — LiveKit muss die Cleanup übernehmen
- [ ] **WriteSample ohne Backpressure**: `Track.WriteSample()` wird ohne Retry oder Backpressure-Handling aufgerufen — bei Netzwerk-Congestion kann das blockieren
- [x] **`sync.Once` für Close ist gut**: Prevents double-disconnect — ✅

#### 11.4.3 Config & Token
- [ ] **Token-Client hat HTTP-Only**: `HTTPTokenProvider` supportet nur HTTP — kein gRPC, kein Unix-Socket, kein File-based Token
- [ ] **`TokenTTLSeconds: 300`** (5 Min Default): Ziemlich kurz — bei Token-Endpoint-Ausfällen verliert der Streamer nach 5 Minuten die Verbindung
- [x] **Config-Validation ist strikt**: Gute Min/Max Checks auf alle Werte — ✅
- [ ] **Aber: Kein Config-File-Support**: Alles über Environment Variables — für komplexe Setups mit vielen Streamern umständlich

#### 11.4.4 Metrics & Observability
- [x] **Log-basierte Metrics sind nicht querybar**: Streamer liefert zusätzlich querybare Prometheus-Metriken über `/metrics`
- [x] **Keine Prometheus `/metrics` Endpoint**: `/metrics` ist über den Health-Server implementiert
- [ ] **Counters sind monoton (kein Reset)**: `droppedQueue`, `publishedFrames` etc. werden nie zurückgesetzt — bei langen Laufzeiten uint64 Overflow theoretisch möglich (praktisch irrelevant)
- [x] **`MetricsInterval` Default 5s**: Genug für Debugging, aber zu frequent für Production-Logging — sollte konfigurierbar sein (ist es, via `METRICS_INTERVAL_MS`)

---

### 11.5 Prisma Schema – Zusätzliche Befunde

- [x] **Kein `passwordResetToken` Model**: Password-Reset-Tokens werden in der `User`-Tabelle als JSON im `metadata`-Feld oder in Redis gespeichert — sollte ein eigenes Model haben für Audit-Trail
- [ ] **`ChatMessage` hat kein Soft-Delete**: Gelöschte Chat-Nachrichten sind weg — kein Moderation-Trail für gelöschte Messages
- [x] **`AnalyticsEvent` hat keinen TTL/Retention**: Tabelle wächst unbegrenzt — braucht einen Cleanup-Job oder Partitionierung
- [x] **`QueueEntry.expiresAt` wird nie serverseitig geprüft**: Das Feld existiert, aber es gibt keinen Cron/Scheduler der abgelaufene Entries entfernt
- [ ] **Keine Audit-Log-Tabelle**: Admin-Aktionen (User löschen, Robot-Config ändern, Moderation) werden nicht geloggt
- [ ] **`Robot.metadata` ist ein `Json?`-Feld**: Typsicherheit nur zur Laufzeit — Prisma bietet seit v5 Typed JSON, das hier genutzt werden könnte

---

### 11.6 Docker & Infrastructure – Zusätzliche Befunde

- [x] **Docker-/File-Secret-Support vorhanden**: API lädt `*_FILE`-Secrets und Compose mappt standardisierte Secret-Pfade unter `/run/secrets`
- [x] **`livekit/livekit-server:latest`**: Unpinned Image — kann bei jedem Pull brechen. Gleiches für `livekit/ingress:latest`, `livekit/egress:latest`
- [ ] **cAdvisor Port-Konflikt**: cAdvisor bindet intern auf Port 8080, gleichzeitig bindet `livekit-ingress` WHIP auf 8080 externally — kann bei Debugging verwirrend sein
- [ ] **Kein Restart-Limit**: `restart: unless-stopped` ohne `deploy.restart_policy.max_attempts` — ein crashender Container wird unendlich neugestartet
- [ ] **PostgreSQL ohne SSL**: `DATABASE_URL` hat kein `?sslmode=require` — Traffic zwischen API und DB ist unverschlüsselt (innerhalb des Docker-Netzwerks akzeptabel, aber nicht Best Practice)
- [x] **Recordings-Volume ist `:ro` gemountet am API-Container**: Richtig für Lesezugriff — aber wenn die API Recordings löschen soll (über Mod-Dashboard), funktioniert das nicht
- [x] **Kein Nginx Rate-Limiting konfiguriert** (in der Standardkonfiguration): Rate-Limiting nur auf NestJS-Ebene — Nginx sollte als erste Verteidigungslinie dienen
- [x] **Kein Health-Check auf Nginx**: Nginx Container hat keinen Healthcheck — kann unhealthy sein ohne dass Docker Compose es merkt
- [x] **CORS_ORIGIN akzeptiert Komma-getrennte Liste**: `process.env.CORS_ORIGIN?.split(',')` — potentiell unsicher wenn Whitespace oder Tippfehler enthalten sind

---

### 11.7 Frontend/Backend Coupling & Consistency

- [x] **WebSocket-Event-Format undokumentiert**: Das `{ event: string, data: object }` Wire-Format ist nirgends als Schema/Type definiert — Frontend und Backend müssen manuell synchron gehalten werden
- [ ] **Kein API-Response-Type-Sharing**: Frontend `api.ts` definiert eigene Response-Types die manuell mit dem Backend synchron gehalten werden müssen — kein Code-Gen, kein tRPC, kein OpenAPI-Client
- [x] **`@botparty/shared` ist minimal**: Nur Enums, Limits, und ein paar Types — die meisten API-Contracts werden in `api.ts` (Frontend) und den Controllern (Backend) dupliziert
- [x] **Viewer-Token-Refresh hat kein exponentielles Backoff**: Wenn der Token-Endpoint down ist, wird alle 3s gepollt — sollte backoff haben
- [x] **Guest-Session-ID basiert auf `Math.random()`**: `Math.random().toString(36).slice(2, 14)` — nicht collision-resistant bei hohem Traffic. `crypto.randomUUID()` wäre besser

---

### 11.8 Accessibility & Compliance

- [x] **Keine ARIA-Labels auf Kontrollelementen**: Room-Controls, Slider, XY-Pad, Fokus-Toggles und E-STOP haben jetzt explizite `aria-label`s
- [x] **Keine Keyboard-Trap-Prevention**: Robot-View unterdrückt Fahr-Steuerung bereits in Inputs/Chat-Fokus und erlaubt TAB-Wechsel nur bei leerem Chat-Feld
- [x] **Kein `rel="noopener"` auf externen Links**: manuelle externe Links im Web-Frontend auf `noopener noreferrer` gehärtet
- [x] **Kein Cookie-Banner obwohl `/cookies` Route existiert**: Consent-Banner mit Verweis auf `/cookies` ergänzt
- [x] **Keine DSGVO-konforme Account-Löschung**: User-Deletion über Admin möglich, aber kein Self-Service Account-Deletion für Nutzer
- [x] **Keine Daten-Export-Funktion**: Self-Service Datenexport als JSON über `/users/me/export` + Settings-UI ergänzt

---

## Erweiterte Prioritäten-Empfehlung

| Priorität | Bereich | Punkt |
|-----------|---------|-------|
| 🔴 P0 | Security | `.env` aus Git-History entfernen |
| 🔴 P0 | Security | CSP aktivieren (`contentSecurityPolicy: false` entfernen) |
| 🔴 P0 | Testing | Auth + Queue + Gateway + Moderation Unit-Tests |
| [x] | Code | `dashboard/page.tsx` aufteilen (von 3.409 auf 1.297 Zeilen reduziert) |
| 🔴 P0 | Code | `robot-view.tsx` aufteilen (2.741 Zeilen) |
| 🔴 P0 | Code | `mod/page.tsx` aufteilen (1.965 Zeilen) |
| 🟡 P1 | Code | `robots.service.ts` in Sub-Services aufteilen |
| 🟡 P1 | Code | `moderation.service.ts` in Sub-Services aufteilen |
| 🟡 P1 | Code | `bot.gateway.ts` in Sub-Handler aufteilen |
| 🟡 P1 | Code | Frontend `api.ts` nach Domain aufteilen |
| 🟡 P1 | Security | CSRF für Cookie-Endpoints implementieren |
| 🟡 P1 | Security | Robot JWT Default-Expiry setzen |
| 🟡 P1 | Security | Account-Lockout nach N Fehlversuchen |
| 🟡 P1 | Security | Thumbnail-Upload Content-Validation |
| 🟡 P1 | DevOps | Node.js Version auf 22 LTS senken |
| 🟡 P1 | DevOps | CI Pipeline (Lint + Type-Check + Test) |
| 🟡 P1 | DevOps | Docker-Image-Versions pinnen (LiveKit, etc.) |
| 🟡 P1 | Performance | Robot-Liste Pagination |
| 🟡 P1 | Performance | Explore-Seite ISR statt force-dynamic |
| 🟡 P1 | UX | Mobile Touch Controls |
| 🟡 P1 | UX | Error Boundaries + Loading States |
| 🟡 P1 | UX | Leaderboard Robot-Links anklickbar machen |
| 🟡 P1 | Compliance | DSGVO Self-Service Account Deletion |
| 🟢 P2 | Testing | E2E Tests (Playwright) |
| 🟢 P2 | Testing | Python + Go Unit Tests |
| 🟢 P2 | Testing | `annexb_reader.go` H.264 Edge-Case Tests |
| 🟢 P2 | Code | WebSocket-Event-Schema als Shared Types |
| 🟢 P2 | Code | `pyproject.toml` statt requirements.txt |
| 🟢 P2 | Code | Python Type-Checking (mypy/pyright) |
| 🟢 P2 | UX | Fullscreen Video + PWA |
| 🟢 P2 | UX | Onboarding-Flow für neue Nutzer |
| 🟢 P2 | DevOps | Backup-Strategie (pg_dump Cron) |
| 🟢 P2 | DevOps | Log-Aggregation (Loki/Sentry) |
| 🟢 P2 | Docs | CONTRIBUTING.md + CHANGELOG.md |
| 🟢 P2 | Docs | ADRs für Architektur-Entscheidungen |
| 🟢 P2 | Features | Session Recording |
| 🟢 P2 | Features | Analytics Dashboard |
| 🟢 P2 | Features | E-Mail-Verification bei Registrierung |
| 🟢 P2 | Performance | Redis Pipeline-Batching in Hot-Paths |
| 🟢 P2 | Performance | DB Connection-Pool Tuning |
| ⚪ P3 | Features | Social Login (GitHub/Google/Discord) |
| ⚪ P3 | Features | Gamepad API |
| ⚪ P3 | Features | Embed Widget |
| ⚪ P3 | Features | Webhook System |
| ⚪ P3 | Features | Prometheus Metrics (Go Streamer) |
| ⚪ P3 | Features | Swarm-Control UI |
| ⚪ P3 | Features | Robot-Scheduling UI |
| ⚪ P3 | Infra | Docker Secrets statt Env-Vars |
| ⚪ P3 | Infra | Nginx Rate-Limiting |
| ⚪ P3 | Observability | Streamer Prometheus `/metrics` Endpoint |

---

## Datei-Größen-Übersicht (Refactoring-Targets)

| Datei | Zeilen | Kategorie |
|-------|--------|-----------|
| `apps/web/src/app/dashboard/page.tsx` | 1.297 | 🟡 Frontend |
| `apps/web/src/app/robot/[slug]/robot-view.tsx` | 2.741 | 🔴 Frontend |
| `apps/api/src/robots/robots.service.ts` | 2.032 | 🔴 Backend |
| `apps/web/src/app/mod/page.tsx` | 1.965 | 🔴 Frontend |
| `apps/api/src/moderation/moderation.service.ts` | 1.888 | 🟡 Backend |
| `apps/api/src/gateway/bot.gateway.ts` | 1.632 | 🟡 Backend |
| `apps/web/src/components/livekit-player.tsx` | 1.221 | 🟡 Frontend |
| `apps/web/src/lib/api.ts` | 1.050 | 🟡 Frontend |
| `apps/api/src/livekit/livekit.service.ts` | 733 | 🟢 Backend |
| `apps/api/src/robots/robots.controller.ts` | 562 | 🟢 Backend |
| `botparty-client/botparty_robot/client_ops.py` | 532 | 🟢 Python |
| `botparty-client/botparty_robot/camera.py` | 499 | 🟢 Python |
| `botparty-client/botparty_robot/video/botparty_streamer.py` | 463 | 🟢 Python |

**Gesamtcode-Umfang**: ~13.500 Zeilen Frontend, ~10.250 Zeilen Backend, ~2.500 Zeilen Python Client, ~800 Zeilen Go Streamer.

---

> **Audit-Revision 2** — 15.04.2026
> Insgesamt **~180 offene Punkte** identifiziert über alle Projekte hinweg.
> Die Plattform ist produktionstauglich deployed und funktional.
> Der Fokus sollte auf Security-Hardening, Test-Coverage, und Refactoring der 8 übergroßen Dateien liegen.
