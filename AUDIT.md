# AUDIT.md

**Projekt:** BotParty

**Audit-Stichtag:** 17. Juli 2026

**Audit-Typ:** vollständiges statisches und dynamisches Fullstack-, Security-, Produkt-, UX/UI-, QA- und Betriebs-Audit mit isolierten Docker-Verifikationsläufen

**Release-Entscheidung am Audit-Stichtag:** **Nein – in der ursprünglich geprüften Fassung nicht release-ready**

## Sanierungsstand vom 18. Juli 2026

Die Abschnitte 1 bis 14 dokumentieren den historischen Ausgangsbefund vom Audit-Stichtag. Der aktuelle Umsetzungsstand und die verbindlichen Nachweise stehen in Abschnitt 15 und in dieser Statusübersicht; frühere Fehlermeldungen sind nicht als aktueller Projektzustand zu lesen.

Aktuell verifiziert:

- Fresh- und Upgrade-Migrationen auf PostgreSQL 16 einschließlich Drift- und Wiederholungstest: **grün**.
- API: **65/65 Suites / 608/608 Tests grün**, einschließlich aktiver Testcontainers-Integration.
- Web: **33/33 Testdateien / 109/109 Tests grün**.
- Playwright Chromium: **21/21 Tests grün**, einschließlich Auth, Host-Onboarding, CSP, Accessibility, Eigentümerisolation und Queue-/Control-Smokes.
- API- und Web-Coverage einschließlich der separaten 90-%-Schwellen für kritische Auth-, Finanz-, Control- und LiveKit-Dateien: **grün**.
- Produktions- und vollständiger Dependency-Audit: **keine bekannten Schwachstellen**.
- OpenAPI-/Referenz-Drift, ENV-Parität, Architekturgrenzen, Backup-/Restore-Drill, Queue-Benchmark und File-Secret-Smoke: **grün**.
- Fresh-Docker-E2E, Dev-Compose einschließlich Imagebuild, zwölf Migrationen, Healthchecks und Hot-Reload sowie die mobile Lighthouse-Matrix mit 18 Läufen auf sechs Kernrouten: **grün**.
- Zwei-API-Ausfall, DB-/Redis-/Storage-Ausfälle, fehlerhaftes Deployment, Rolling Update und echter Rollback wurden in der isolierten Compose-Umgebung praktisch bestanden. Das Rollout-/Rollback-/Rollforward-Triple lieferte auf allen beantworteten Requests HTTP 200; ungesunde Surge-Replikas blieben vollständig vom Traffic isoliert. Eine zusätzliche 150-Sekunden-Keep-alive-Probe des finalen Rollouts maß 146.191 HTTP-200-Antworten und sieben rohe Socket-Reconnects bei Nginx-Konfigurationswechseln (0,0048 %); die Single-Proxy-Grenze ist im Abschlussbericht ausgewiesen.
- Das HTTPS-Profil startete als UID 101 mit read-only Root-Dateisystem, gruppenbeschränktem TLS-Schlüssel, Capability-Drop und erfolgreichen HTTP-/HTTPS-Probes.
- Abschließende Shell-, Compose-, Diff-, Abschwächungs- und Hochkonfidenz-Secretsuche: **grün**; `git diff --check` Exit 0.

## Methodik, Evidenz und Grenzen

Dieses Audit wurde ausschließlich aus dem aktuellen Projektstand erstellt. Frühere Auditdateien wurden weder eingelesen noch als Quelle verwendet. Geprüft wurden die versionierten und lokal vorhandenen Quell-, Konfigurations-, Dokumentations-, Test-, Migrations-, Container- und Deployment-Dateien sowie frisch ausgeführte, nicht destruktive Prüfungen.

Die Befunde verwenden vier Evidenzklassen:

- **Gefunden:** direkt im Code, in Konfigurationen oder durch einen reproduzierbaren Lauf nachgewiesen.
- **Risiko:** aus der vorhandenen Implementierung konkret ableitbares Fehlerszenario; für einen Exploit oder Produktionseffekt fehlen jedoch Laufzeitdaten.
- **Prüfpunkt:** ohne Produktionskonfiguration, externe Konten, echte Hardware oder Rechtsprüfung nicht abschließend bewertbar.
- **Idee:** Produkt- oder Qualitätsverbesserung, kein bestehender Defekt.

Frische Verifikationen am 17.07.2026:

- Prisma-Schema mit gesetzter DATABASE_URL: **gültig**.
- Migration auf leerer, isolierter PostgreSQL-16-Datenbank: **fehlgeschlagen**; Migration 20260414_add_robot_slug_aliases endet mit P3018 / PostgreSQL 42P01, weil Relation "Robot" nicht existiert.
- API-Coverage: **fehlgeschlagen**; 41 Suites bestanden, 1 Suite mit 4 Fehlern, 1 Suite übersprungen; 252 von 257 Tests bestanden. Gesamt-Coverage: Statements 46,96 %, Branches 35,15 %, Functions 39,13 %, Lines 47,10 %; alle vier konfigurierten Schwellen unterschritten.
- Web-Coverage: **fehlgeschlagen**; 14 von 15 Testdateien und 26 von 27 Tests bestanden. Fehler in dashboard-sidebar.test.tsx bei der Tastatur-Fokusreihenfolge. Wegen des Testfehlers wurde keine belastbare Coverage-Gesamtsumme ausgegeben.
- Playwright-Testauflistung mit dem CI-Parameter --project=chromium: **fehlgeschlagen**; es ist kein Projekt namens chromium definiert.
- pnpm audit --prod --json: **85 bekannte Advisories** in der aufgelösten Produktionsabhängigkeit (44 hoch, 35 mittel, 6 niedrig, 0 kritisch; 804 Produktionspakete im Audit-Metadatenbestand).
- Ein vollständiger Lint-Lauf wurde beim Start abgebrochen, als eine fremde Volltestmatrix die Systemlast stark erhöhte. Dieses Ergebnis gilt ausdrücklich nicht als bestanden. Der endgültige Prüfstatus steht in Abschnitt 9.

Nicht abschließend prüfbar waren ein produktiver Stripe-/PayPal-Zahlungsfluss, ein echtes LiveKit-/Robotik-Setup, reale E-Mail-Zustellung, Browser- und Geräteabdeckung unter Produktionsdaten, Backup-Restore auf einem Produktionsabbild, externe Infrastruktur sowie die juristische Wirksamkeit der Rechtstexte. Das Audit ist keine Rechtsberatung.

## Historischer Ausgangsbefund (Abschnitte 1 bis 14)

## 1. Executive Summary

BotParty ist kein einfacher Prototyp mehr. Das Repository enthält eine umfangreiche Echtzeitplattform für öffentliche Roboter-Räume, Video, Warteschlangen, Chat, Moderation, Wallet, Zahlungen, Auszahlungen, Aufzeichnungen, Host-Dashboard und Betriebsansichten. Positiv sind die klare fachliche Modulbildung im NestJS-Backend, gemeinsame Zod-Verträge, Argon2-Passwort-Hashing, Refresh-Token-Rotation, strikte WebSocket-Payload-Schemas, Redis-basierte Echtzeitbausteine, private Recording-Speicherung, signierte Wiedergabelinks sowie eine beachtliche Zahl von API-Tests.

Der aktuelle Stand ist trotzdem nicht releasefähig. Die fünf größten Risikocluster sind:

1. **Installation und Release-Pipeline sind nicht verlässlich:** Eine leere Datenbank lässt sich aus der Migrationshistorie nicht erzeugen. Die lokalen GitHub-Workflows werden durch .gitignore vollständig ausgeschlossen und sind nicht versioniert. Der E2E-Aufruf ist zusätzlich falsch konfiguriert.
2. **Geld- und Ledger-Flows sind nicht transaktionssicher:** Donation-Idempotenz, Checkout-Gutschrift, Refund/Chargeback und Auszahlung können bei Parallelität oder Teilfehlern doppelt buchen, Geldzustände verlieren oder Status und Kontostand auseinanderlaufen lassen.
3. **Robotersteuerung erfüllt die dokumentierten Sicherheitszusagen nicht:** Alter und Notstopp-Schwellen von Steuerbefehlen werden nicht erzwungen. Kosten werden vor dem Versand ohne Geräte-Acknowledgement abgebucht. UI-Ereignisse können denselben Befehl doppelt senden.
4. **Mehrere konkrete Security-Lücken bestehen:** Gast-LiveKit-Tokens umgehen bei PASSWORD/ALLOWED_USERS die Raumprüfung, Webhook-Auslieferung ist über Redirect/DNS-Rebinding SSRF-gefährdet, Webhook-Secrets sind nicht authentifiziert verschlüsselt, Produktions-Dependencies enthalten 44 hohe Advisories.
5. **Produkt- und Rechtsversprechen sind nicht mit der Implementierung synchron:** Abonnements werden standardmäßig aktiviert, obwohl Renewal und Kündigung nicht funktionieren; Refunds werden als automatisch beschrieben, obwohl sie häufig nicht zugeordnet werden; Rechtstexte zeigen Vorlagen- und Konfigurationshinweise im sichtbaren Produkt.

**Release-Reife:** Alpha für kontrollierte interne Demos; nicht geeignet für öffentliche Nutzer, reale Zahlungen, Auszahlungen oder unbeaufsichtigte physische Roboter.

**Größte Chancen:** Die vorhandene Domänenbreite und die bereits angelegten Sicherheits-/Betriebsbausteine erlauben eine gezielte Stabilisierung statt eines Neustarts. Höchsten Nutzen liefern ein sauberer Installationspfad, eine transaktionale Finanz-State-Machine, eine serverseitig erzwungene Control-Safety-Schicht, eine belastbare CI-Gate-Kette und ein ehrlicher, geführter Host-Onboarding-Flow.

**Empfohlene Reihenfolge:** Zahlungen und Subscriptions bis zur Behebung deaktivieren; Datenbank-Baseline und CI reparieren; Steuerungs- und Zugriffsgrenzen schließen; Finanzbuchungen atomar machen; Rechtstexte und Produktclaims bereinigen; erst danach Performance, Skalierung und zusätzliche Features.

## 2. Projektüberblick

### 2.1 Technologien und Repository

- pnpm-9-Monorepo mit Turborepo 2; Root-Version 0.1.3.
- Runtime-Ziel Node 24 über .nvmrc, .node-version, Docker und CI-Dateien; package.json erlaubt zugleich Node >=22, CONTRIBUTING.md nennt 22+, README.md 24. Die Vorgabe ist damit nicht einheitlich.
- Etwa 18.558 Zeilen gepflegter API-TypeScript-Code und 21.798 Zeilen gepflegter Web-TypeScript/TSX-Code, jeweils ohne Tests. Generierte Ordner wurden nicht als Quellumfang gewertet.
- Packages: @botparty/api, @botparty/web, @botparty/prisma, @botparty/shared sowie gemeinsame ESLint- und TypeScript-Konfiguration.

### 2.2 Frontend

- Next.js 15.5.14, App Router, React 19.2, TypeScript, Tailwind CSS 4.
- Client-State über Zustand; persistente Präferenzen in localStorage, Auth-Profil in sessionStorage.
- LiveKit React-Komponenten und livekit-client für Video/Audio/DataChannel.
- Framer Motion, Lucide Icons, eigene UI-Komponenten.
- Öffentlich: Landingpage, Explore, Robot-Raum, Embed, Leaderboard, Pricing, Status, Dokumentation und Rechtstexte.
- Authentifiziert: Dashboard, Sessions/Replays, Wallet/Auszahlungen, Einstellungen.
- Staff: Moderation, Runtime, Nutzer/Roboter, Billing-Events und Payout-Review.
- Locale-Middleware für en/de ist vorhanden, die sichtbaren Inhalte sind jedoch faktisch nur Englisch.

### 2.3 Backend

- NestJS 11 mit Fastify 5, REST unter /api/v1 und nativen WebSockets über ws.
- Domänenmodule für Auth, Users, Robots, Controls, Queue, Sessions, Gateway, LiveKit, Wallet, Billing, Earnings/Payouts, Moderation, Health, Maintenance und Jobs.
- DTO-Validierung gemischt aus gemeinsamen Zod-Schemas und class-validator; einzelne Endpunkte nutzen any oder manuelle Prüfung.
- OpenAPI/Swagger-Export und ein eingechecktes docs/openapi.json sind vorgesehen.
- Pino-Logging, Prometheus-Metriken, optionale OpenTelemetry- und Sentry-Bootstraps.

### 2.4 Datenhaltung

- PostgreSQL über Prisma 6.19.2; Schema in packages/prisma/prisma/schema.prisma.
- Sieben inkrementelle Migrationen, aber keine vollständige Baseline.
- Redis/ioredis für Rate Limits, Presence, Queue-Fanout, Locks, Turn-State-Fallback und BullMQ.
- S3-kompatibler Object Storage/MinIO für Thumbnails und LiveKit-Aufzeichnungen.
- Ledger-Modell für Credits, BillingIntents, WebhookEvents, IdempotencyKeys und PayoutRequests.

### 2.5 Authentifizierung und Autorisierung

- Nutzerpasswörter mit Argon2.
- Access- und Refresh-JWTs; Access-Token per Bearer oder HttpOnly-Cookie, Refresh-Token gehasht/rotiert.
- tokenVersion invalidiert Refresh-Tokens und wird in bestimmten manuellen Prüfpfaden gegen die Datenbank validiert.
- Rollen USER, MOD und ADMIN; zusätzlich Eigentümer- und Raumzugriffslogik.
- Separate Robot-JWTs nach Claim-Flow.
- CSRF-Doppel-Submit-/Origin-Guard ist nur an Auth-Mutationsendpunkten angebracht, nicht global an cookie-authentifizierten Mutationen.

### 2.6 Externe Services

- LiveKit Server, Ingress und Egress.
- Stripe und PayPal für Credit-Checkout; Stripe-Abonnementcode ist teilweise vorhanden.
- SMTP/Nodemailer und BullMQ-Mailqueue.
- Frei konfigurierbare Robot-Webhooks.
- Optional Sentry und OpenTelemetry; die dynamisch importierten Sentry-Pakete sind nicht installiert.
- Prometheus, Grafana, Loki, Promtail und cAdvisor als optionale Betriebsprofile.

### 2.7 Build, Start, Test und Deployment

- Root: turbo run build/lint/typecheck/test:coverage.
- API: TypeScript-Build, Jest/ts-jest, Start aus dist/main.js.
- Web: next build/start, Vitest/RTL, Playwright.
- Mehrstufige, nicht als root laufende Produktionsimages für API und Web.
- Docker Compose für PostgreSQL, Redis, MinIO, LiveKit, API, Web und Nginx; zusätzliche Observability-Profile.
- Dev-Compose ist in der aktuellen Form nicht baubar, da nicht vorhandene dev-Stages und ein nicht vorhandenes API-Script referenziert werden.
- Lokale .github/workflows-Dateien existieren, sind aber über .gitignore ausgeschlossen und laut git ls-files nicht versioniert. Damit existiert im Repository effektiv kein ausgelieferter CI/CD-Gate.

## 3. Codequalität

### 3.1 Stärken

- **Gefunden:** Die API ist überwiegend nach Domänen statt technischen Schichten gegliedert. Services wie QueueService, BillingService und RobotAccessService bündeln fachliche Regeln nachvollziehbar.
- **Gefunden:** Gemeinsame Schemas und Konstanten in packages/shared reduzieren Drift bei WebSocket-Payloads und Kernlimits.
- **Gefunden:** Strikte Zod-Schemas für WebSocket-Eingaben, begrenzte Stringlängen, normalisierte Commands und explizite Access-Checks sind eine solide Basis.
- **Gefunden:** Sensible Pfade besitzen bereits Unit-Tests, etwa Auth, Wallet, Controls, Gateway, LiveKit, Queue, Moderation und Recordings.
- **Gefunden:** Fehlerzustände werden im UI häufig in Loading-, Empty- und Error-Komponenten abgebildet.

### 3.2 Struktur und Wartbarkeit

- **Gefunden:** Mehrere Dateien sind zu groß und bündeln zu viele Verantwortlichkeiten: apps/web/src/components/dashboard/use-dashboard-page.ts mit rund 1.578 Zeilen, use-robot-view-state.ts mit rund 1.361 Zeilen, apps/web/src/app/mod/page.tsx mit rund 1.032 Zeilen und video-renderer.tsx mit rund 978 Zeilen. Backend-Hotspots sind unter anderem livekit.service.ts, users.service.ts und auth.service.ts.
- **Auswirkung:** Änderungen an UI-Zustand, Netzwerk, Berechtigungen, Timerlogik und Rendering berühren dieselbe Datei. Das erhöht Regressionen und erklärt die geringe Abdeckung der wichtigsten Hooks.
- **Gefunden:** react-hooks/exhaustive-deps ist deaktiviert. Gerade in den großen Hooks können veraltete Closures und fehlende Abhängigkeiten unbemerkt bleiben.
- **Gefunden:** API-Typen sind in apps/web/src/lib/api-types.ts, apps/web/src/lib/api/types.ts, Feature-Dateien und Dashboard-Typen teilweise dupliziert. Das gemeinsame Package deckt die Verträge nicht vollständig ab.
- **Gefunden:** SessionsService.findByRobot und getActiveSession werfen sofort und enthalten danach unerreichbare Returns. Das ist Dead Code und verschleiert den tatsächlich erlaubten Aufrufpfad.
- **Gefunden:** BillingController.subscriptionCheckout verwendet dto: any, manuelle Validierung und generische Error-Objekte. Ungültige Nutzereingaben können als 500 statt 4xx erscheinen.
- **Gefunden:** Jest transformiert auch .js-Dateien über ts-jest, obwohl allowJs nicht gesetzt ist. Der frische Lauf erzeugte entsprechende Warnungen für Prisma- und Shared-Buildartefakte.
- **Gefunden:** @next/eslint-plugin-next 16 wird mit Next 15 verwendet; Jest 30 mit ts-jest 29. Diese Major-Kombinationen erhöhen Tooling-Drift und sind gezielt zu harmonisieren.
- **Gefunden:** @paypal/paypal-server-sdk ist installiert, der Provider nutzt jedoch fetch. Das ungenutzte SDK vergrößert Abhängigkeitsfläche und bringt unter anderem eine verwundbare Axios-Kette mit.

### 3.3 Fehlerbehandlung und Logging

- **Gefunden:** Mehrere kritische Fehler werden bewusst geschluckt: Billing-Reversal-Debits protokollieren nur und liefern danach einen erfolgreichen Refund-/Chargeback-Status; Event-Insert-Fehler werden mit catch(() => undefined) ignoriert.
- **Gefunden:** MailService protokolliert komplette Verifizierungs- und Passwort-Reset-Links, wenn SMTP fehlt. Gleichzeitig kehrt der Aufruf ohne Zustellfehler zurück.
- **Gefunden:** Der öffentliche CSP-Report-Endpunkt protokolliert fremdkontrollierte Inhalte und User-Agent-Daten. Mit dem globalen 5-MiB-Bodylimit entsteht ein Log-Flood-/Kostenrisiko.
- **Gefunden:** Sentry-Initialisierung fängt das Fehlen der nicht installierten Pakete ab und protokolliert nur eine Warnung. Ein gesetzter DSN vermittelt daher keine tatsächlich aktive Fehlererfassung.
- **Verbesserung:** Finanzielle State-Transitions müssen Fehler nicht nur loggen, sondern in einen expliziten, wiederholbaren Fehlerzustand überführen. Logs brauchen strukturierte IDs ohne Tokens, E-Mails oder freie Payloads.

### 3.4 Technische Schulden

- Fehlende Baseline-Migration und Schema-/Migrationsdrift.
- Unzuverlässige Finanz-State-Machines und fehlende DB-Invarianten.
- Veraltete oder widersprüchliche ADRs und Protokolldokumente.
- Lokale statt sauber ausgelieferte CI-Dateien.
- Große Client-Orchestratoren mit geringer Testtiefe.
- Unterschiedliche Validierungsstile und unvollständige Shared Contracts.

## 4. Architektur & Skalierbarkeit

### 4.1 Datenfluss und Modularität

Die Zielarchitektur ist nachvollziehbar: Next.js konsumiert REST und WebSockets, NestJS orchestriert PostgreSQL, Redis und LiveKit, während BullMQ asynchrone Mails/Webhooks verarbeitet. Die Domänengrenzen sind grundsätzlich brauchbar. Kritische Invarianten liegen jedoch verteilt zwischen UI, Gateway, Redis und Datenbank und sind nicht immer atomar.

- **Gefunden:** ControlHandler lädt Robot-/Access-/Buttonzustand, prüft Queue/Moderation, verbraucht Cooldown, bucht Wallet und sendet anschließend an den Robot-Socket. Es gibt keine einzige Transaktion oder Command-ID, die Buchung, Sendung und Robot-Acknowledgement verbindet.
- **Gefunden:** Controls werden pro API-Instanz für fünf Sekunden gecacht. Preis- und Access-Änderungen können in anderen Replikaten kurzfristig veraltet sein.
- **Gefunden:** Dieselbe Command-Zeichenfolge darf mehreren Buttons zugeordnet sein. Der Server wählt unter erlaubten Treffern den günstigsten Preis und den kleinsten Cooldown. Unterschiedliche Button-Semantik kann dadurch umgangen werden.
- **Gefunden:** Gast-Chat wird realtime übertragen, aber nicht wie authentifizierter Chat dauerhaft gespeichert. Reconnect/History verhalten sich damit je nach Nutzerart verschieden; diese Produktentscheidung ist nicht sichtbar dokumentiert.

### 4.2 Queue und Sessions

- **Gefunden:** Das globale Limit aktiver Queue-Einträge wird außerhalb der Serializable-Transaktion gezählt. Parallele Joins können das Limit überschreiten.
- **Risiko:** Serializable Join-Transaktionen besitzen keine Retry-Strategie. Konflikte führen zu Nutzerfehlern; position ist nicht pro Robot eindeutig abgesichert.
- **Gefunden:** Leave und Vote nummerieren Einträge mit vielen sequentiellen Updates neu. Aufwand und Lockdauer wachsen linear zur Queue.
- **Gefunden:** SessionsService.create beendet bestehende aktive Sessions und erzeugt danach eine neue, ohne DB-Constraint „höchstens eine aktive Session pro Robot“. Parallele Transaktionen können die Invariante brechen.
- **Gefunden:** BotGatewayRuntime.onModuleInit ruft endAllActiveSessions für die gesamte Datenbank auf. Beim Start einer zweiten API-Replik werden laufende Sessions der ersten Replik beendet.
- **Gefunden:** ActiveTurnStore nutzt Redis, aber clear löscht ohne Ownership-/Compare-and-set-Prüfung. Lokale Timer bleiben instanzgebunden. Das ADR 0006 beschreibt noch einen älteren, rein instanzaffinen Zustand.
- **Gefunden:** Beim Robot-Socket-Disconnect wird die komplette Queue des Robots geleert. Kurze Netzunterbrechungen vernichten damit Warteschlangen und Nutzerpositionen.

### 4.3 Realtime und horizontale Skalierung

- **Gefunden:** Redis Pub/Sub, Presence und Claim-Locks bilden eine gute Grundlage für mehrere Instanzen.
- **Gefunden:** Nginx reicht im /ws-Block kein X-Forwarded-For weiter. Im Standard-Deployment kann die API alle WebSocket-Clients als Nginx-IP sehen; IP-basierte Limits kollabieren dann auf einen gemeinsamen Schlüssel.
- **Risiko:** Wird die API direkt exponiert, vertraut die Gateway-IP-Auflösung X-Forwarded-For ohne nachgewiesene Trusted-Proxy-Grenze. Clients könnten IP-basierte Limits umgehen.
- **Gefunden:** viewerCount wird bei Join und Leave in PostgreSQL geschrieben. Mehrere Instanzen können sich überschreiben und erzeugen unnötige Schreiblast für flüchtigen Presence-Zustand.
- **Gefunden:** Redis verwendet allkeys-lru. Unter Speicherdruck dürfen Queue-, Lock-, Grant- und Rate-Limit-Schlüssel verschwinden. Für Steuerungs- und Autorisierungszustand ist diese Eviction-Policy ungeeignet.

### 4.4 Recording-Architektur

- **Gefunden:** Für Session-Replays wird bei jeder Abfrage der gesamte Recording-Bucket vollständig aufgelistet.
- **Gefunden:** Ohne explizite recordingUrl werden Dateien desselben Robots in einem Fenster von 15 Minuten vor bis 15 Minuten nach der Session akzeptiert; bei aktiven Sessions reicht das angenommene Fenster bis vier Stunden plus Puffer.
- **Risiko:** Nutzer mit Zugriff auf eine Session können eine zeitlich benachbarte Aufnahme desselben Robots erhalten, die nicht zu ihrer Session gehört.
- **Gefunden:** Das eigentliche signierte Playback ist zeitlich begrenzt und die Bucket-Konfiguration ist privat ausgelegt. Das ist positiv, ersetzt aber keine eindeutige Session-zu-Objekt-Relation.

### 4.5 Skalierbarkeitsurteil

Eine einzelne kontrollierte Instanz kann den Alpha-Betrieb tragen. Mehrere API-Replikate sind trotz Redis derzeit nicht sicher, weil Startup-Reconciliation, Timer-Ownership, Session-Invarianten, lokale Caches und IP-Auflösung nicht konsistent skaliert sind. Vor horizontaler Skalierung braucht es Eigentums-Leases, DB-Invarianten, replikenweite Invalidierung und Lasttests.

## 5. Security Audit

### 5.1 Kritische Zugriffskontrolle

- **Gefunden – P0:** POST /livekit/token/viewer-public/:robotId prüft eine Raumfreigabe nur bei LINK_ONLY. Bei PASSWORD und ALLOWED_USERS reicht visibility != PRIVATE sowie metadata.access.video = ALL. Ein Gast erhält dadurch ein Viewer-Token ohne Passwort oder Allowlist.
- **Gefunden – P1:** Controller-LiveKit-Tokens gelten vier Stunden und behalten canPublishData auch nach Ende des Turns. Robot-Tokens gelten 24 Stunden. Die Queue-Entziehung widerruft bestehende LiveKit-Grants nicht.
- **Gefunden – P1:** JwtStrategy validiert Signatur und Ablauf, lädt aber weder isActive noch tokenVersion noch die aktuelle Rolle. Logout-all, Deaktivierung oder Rollenänderung wirken für normale REST-Guards bis zum Access-Token-Ablauf verzögert. Manuelle Auth-/WS-Pfade prüfen die Datenbank teilweise, wodurch inkonsistente Semantik entsteht.
- **Gefunden – P1:** Robot-JWTs enthalten robot ID, Scope und deviceHash, aber keinen gegen die Datenbank geprüften Token-/Device-Versionszähler. Claim-Token-Regeneration ist nicht als sofortige Revocation bereits ausgestellter, bis zu 30 Tage gültiger Robot-JWTs erkennbar.

### 5.2 SSRF und Webhooks

- **Gefunden – P0:** assertSafeWebhookTarget prüft DNS vor fetch. fetch folgt Redirects standardmäßig; Redirectziele werden nicht erneut validiert. Zwischen DNS-Prüfung und Verbindung besteht außerdem ein DNS-Rebinding-/TOCTOU-Fenster.
- **Gefunden – P1:** Robot-Webhook-Secrets werden per XOR mit einem deterministischen HMAC-KeyStream transformiert. Es gibt keinen Nonce und keinen Authentizitäts-Tag; manipulierte Ciphertexte werden nicht erkannt. 64-stellige Hexwerte werden aus Kompatibilitätsgründen als Klartext akzeptiert.
- **Positiv:** URLs mit Credentials, localhost, lokale Hostsuffixe und viele private IPv4/IPv6-Bereiche werden vor dem ersten Request blockiert; Auslieferungen sind signiert, zeitbegrenzt und über BullMQ wiederholbar.

### 5.3 CSRF, Cookies und Sessions

- **Gefunden:** Auth-Mutationen verwenden Origin/Referer plus Doppel-Submit-CSRF-Token.
- **Gefunden – P1:** Andere POST/PUT/PATCH/DELETE-Endpunkte akzeptieren das Access-JWT aus dem Cookie, tragen aber keinen CsrfOriginGuard. Die aktuelle Default-Einstellung SameSite=Strict reduziert das Risiko, ist jedoch keine zentrale Invariante. Eine spätere Konfigurationsänderung auf Lax/None öffnet die übrigen Mutationen.
- **Gefunden:** AUTH_COOKIE_SAME_SITE=None erzwingt nicht automatisch Secure. Fehlkonfiguration kann Browser-Sessions unbrauchbar oder unsicher machen.
- **Gefunden – Risiko:** Login-Lockout wird auf E-Mail/Account angewendet. Angreifer können gezielt wiederholt fremde Konten sperren; IP- und Account-Schutz müssen getrennt balanciert werden.

### 5.4 Tokens, Secrets und sensible Daten

- **Gefunden:** E-Mail-Verifizierungstokens stehen im Klartext in users; Passwort-Reset-Tokens werden dagegen gehasht in Redis gehalten.
- **Gefunden – P0:** Fehlt SMTP, schreibt MailService vollständige Verifizierungs- und Passwort-Reset-Links inklusive Token in Logs. Produktion verlangt SMTP nicht zwingend und der Aufrufer erhält keinen Zustellfehler.
- **Gefunden:** Robot streamKey und claimToken werden im Klartext gespeichert.
- **Gefunden:** Payout destination kann PayPal-E-Mail oder IBAN enthalten und wird im Klartext gespeichert sowie in der UI-Historie angezeigt.
- **Gefunden:** Billing-Webhook-Payloads werden vollständig und ohne erkennbare Löschfrist gespeichert; sie können personenbezogene Providerdaten enthalten.
- **Gefunden:** setup-env.sh bietet HTTP als Standard, erzeugt einen Produktions-Seed mit admin123456 und gibt Demo-Zugangsdaten aus. Das ist kein sicherer Produktionsbootstrap.

### 5.5 Eingabevalidierung, XSS, Injection und Uploads

- **Positiv:** Prisma verhindert in den geprüften normalen Datenpfaden SQL-Stringkonkatenation; rohe SQL-Abfragen sind parametrisiert. Zod/class-validator und Längenlimits decken viele Eingaben ab.
- **Positiv:** React escaped Chat- und Metadatenstandardausgaben; E-Mail-Templates verwenden escapeHtml. Es wurde kein konkreter stored-XSS-Sink mit dangerouslySetInnerHTML gefunden.
- **Gefunden:** Die Content Security Policy erlaubt unsafe-inline für Scripts und Styles und connect-src erweitert sich um beliebige konfigurierte HTTPS-/WSS-Ursprünge. Das begrenzt XSS-Folgen weniger stark als eine Nonce-/Hash-CSP.
- **Gefunden:** CSP_EXTRA_IMG_ORIGINS wird eingelesen, landet aber nur in connect-src und nicht in img-src. Das ist ein Funktionsfehler der Sicherheitskonfiguration.
- **Gefunden:** Der globale Raw-Body-Modus gilt für alle API-Routen mit bis zu 5 MiB, obwohl nur Zahlungswebhooks Rohdaten benötigen. Das erhöht Speicher- und DoS-Fläche.
- **Prüfpunkt:** Thumbnail-Dateien werden über sharp verarbeitet und begrenzt; dennoch sind Dekompressionsbomben, Pixelgrenze, MIME-Sniffing und Malware-/Content-Policy mit realen Testdateien zu verifizieren.

### 5.6 Dependencies und Header

- **Gefunden – P0/P1:** pnpm audit meldet 44 hohe Advisories. Direkt relevant sind Next 15.5.14, @nestjs/platform-fastify/Fastify, ws und Nodemailer; weitere hohe Pfade betreffen OpenTelemetry/Prometheus, gRPC/protobuf und das ungenutzte PayPal-SDK.
- **Gefunden:** Die empfohlenen Fixbereiche umfassen unter anderem Next >=15.5.18, @nestjs/platform-fastify >=11.1.24, Fastify >=5.8.5, ws >=8.21.0 und eine aktuelle Nodemailer-Hauptversion. Upgrades müssen anhand des Lockfiles und der offiziellen Advisories erneut geprüft werden.
- **Gefunden:** Nginx, Next und Fastify setzen teils widersprüchliche Frame-/Security-Header, etwa SAMEORIGIN gegenüber DENY/frame-ancestors none. Doppelte Header erschweren die effektive Policy.
- **Gefunden:** Die HTTP-Nginx-Konfiguration blockiert /storage/recordings explizit, die SSL-Vorlage nicht. Der private Bucket bleibt Schutzschicht, die Proxy-Policy ist aber inkonsistent.

## 6. UX/UI Audit

### 6.1 Gesamteindruck und Konsistenz

Die UI besitzt ein konsistentes dunkles/helles Token-System, klare Karten, Statusbadges, responsive Grids, Skeletons, leere Zustände und erkennbare Primäraktionen. Mindesthöhen für Touch-Ziele, focus-visible-Stile und reduced-motion-Ansätze sind an vielen Stellen vorhanden. Landingpage und Explore kommunizieren den Robotik-/Crowd-Control-Nutzen schnell.

Der professionelle Eindruck wird durch unvollständige Flows, technische Interna im Sichttext und falsche Versprechen deutlich geschwächt.

### 6.2 Navigation und Klickwege

- **Gefunden – P1:** Explore-Empty-State und Host-Onboarding verlinken /dashboard/robots/new. Es gibt keine entsprechende Route; der Einstieg für neue Hosts endet auf 404.
- **Gefunden:** Sessionlisten verlinken eine Legacy-Robot-URL, die dauerhaft weiterleitet. Funktional, aber ein unnötiger Roundtrip.
- **Gefunden:** Mobile und Desktop Navigation sind umfangreich, jedoch ist der LocaleSwitcher dreimal auskommentiert. Die Sprachwahl ist für Nutzer nicht erreichbar.
- **Idee:** Host-Onboarding als geführte Checkliste von Robot anlegen, Claim, Video, Steuerungsprofil, Hardware-E-Stop-Test und Veröffentlichung ausbauen.

### 6.3 Internationalisierung und Verständlichkeit

- **Gefunden – P1:** Middleware und use-locale kennen de/en und setzen für /de html lang=de, alle geprüften Inhalte bleiben jedoch Englisch. Screenreader, Suchmaschinen und Nutzer erhalten eine falsche Sprachdeklaration.
- **Gefunden:** Sichtbare Texte wie command · access · cooldownMs in Control-Widgets zeigen interne Modellbegriffe statt nutzerorientierter Erklärungen.
- **Gefunden:** „Local preferences synced“ ist falsch; die Präferenzen werden nur lokal in Zustand/localStorage persistiert.
- **Gefunden:** Technische Deploy-Hinweise und Formulierungen wie „product-ready template“, „Suggested checkout consent text“ und NEXT*PUBLIC_LEGAL*\* sind öffentlich sichtbar.

### 6.4 Accessibility

- **Gefunden – P1:** Der Robot-Raum fängt Tab global ab und wechselt zwischen Controls und Chat. Außer in bestimmten nichtleeren Inputs ist die normale Fokusnavigation nicht möglich. Das blockiert Tastatur- und Assistive-Technology-Nutzer.
- **Gefunden:** Der frische Web-Test zur Fokusreihenfolge der DashboardSidebar schlägt fehl: Erwartet war Monitoring, fokussiert blieb Webhooks.
- **Gefunden:** XY-/Joystick-Interaktion ist drag-/pointerzentriert und als role=application umgesetzt, ohne gleichwertige dokumentierte Tastaturalternative.
- **Gefunden:** Video-Statistikpanel und verschiebbare UI-Elemente sind pointerzentriert.
- **Gefunden:** DonationDialog und die generische Dialog-Komponente implementieren keinen Fokusfang, kein Escape-Schließen und keine Fokusrückgabe. Der X-Button des DonationDialog hat keinen zugänglichen Namen.
- **Gefunden:** Die vorhandenen Axe-E2E-Tests prüfen nur acht öffentliche Routen und nur serious/critical. Robot-Raum, Dashboard, Wallet, Pricing, Mod, Dialoge und mobile Interaktionen fehlen.
- **Prüfpunkt:** Kontrastwerte, Zoom 200/400 %, Screenreader-Ausgabe, iOS/Android-Safe-Areas und High-Contrast-Mode müssen manuell geprüft werden; aus den Tokens allein folgt kein vollständiger WCAG-Nachweis.

### 6.5 Zustände und Interaktionssicherheit

- **Gefunden – P0:** Zusätzliche Control-Buttons senden sowohl onPointerDown als auch onClick. Ein Pointer-Klick kann denselben Befehl zweimal auslösen.
- **Gefunden:** Mobile und Desktop-E-Stop-Buttons binden ebenfalls PointerDown und Click an dieselbe Funktion; die Idempotenz ist nicht als durchgehende Invariante nachgewiesen.
- **Gefunden:** RobotQueuePanel erhält activeSession, verwendet es aber nicht und markiert immer den ersten Queue-Eintrag als „Controlling“. Das kann vom tatsächlichen Server-Sessionstatus abweichen.
- **Gefunden:** Die Clientlogik leitet „my turn“ teilweise aus Queue-Position 1 statt der bestätigten aktiven Session ab. Controls können zu früh freigeschaltet erscheinen und serverseitig abgewiesen werden.
- **Gefunden:** Home-API-Fehler werden teilweise als leere Datenlage dargestellt. Nutzer unterscheiden „keine Robots“ nicht von „Backend nicht erreichbar“.
- **Gefunden:** Der Service Worker registriert sich, implementiert aber keinen Fetch-/Offline-Cache. PWA-/Offline-Erwartungen werden nicht erfüllt.

### 6.6 Vertrauen und Conversion

- **Gefunden:** Alpha-Badge und konkrete Use Cases setzen Erwartungen grundsätzlich gut.
- **Gefunden – P1:** Claims zu automatischem E-Stop >300 ms, automatischer Refund-/Chargeback-Umkehr und „cancel anytime from your account“ sind durch die Implementierung nicht gedeckt.
- **Gefunden:** Pricing und Wallet erklären Steuern/VAT, Credit-Verfall, Verbrauch, Rückzahlung, Auszahlungskurs, Gebühren und Creator-Steuerpflichten nicht ausreichend am Entscheidungspunkt.
- **Gefunden:** Registrierung erwähnt Platform Rules, verlinkt aber keine explizite Terms-/Privacy-Zustimmung. Beim EU-Digitalcontent-Checkout fehlt die im Terms-Template selbst vorgeschlagene ausdrückliche Sofortlieferungs-/Widerrufszustimmung.

## 7. Feature Audit

### 7.1 Vorhandene Features

- Öffentliche Robot-Suche mit Filtern, Sortierung, Tags, Status und Pagination.
- Robot-Räume mit LiveKit-Video, mehreren Kameras, Chat, Queue, Voting, Controls, Crowd-Anzeige, E-Stop-UI und Donation.
- Access-Modi OPEN, PASSWORD, ALLOWED_USERS und LINK_ONLY; Public/Unlisted/Private.
- Host-Dashboard für Robotdaten, Zugriffsregeln, Allowlist, Control-Buttons, Webhooks, Ingress/OBS, Thumbnails und Betriebsaktionen.
- Sessions und Replay-Kandidaten.
- Nutzerprofil, E-Mail-Verifizierung, Passwort-Reset, Sessionwiderruf, Export und Kontolöschung.
- Credits, Stripe/PayPal Checkout, Donations, bezahlte Buttons, Earnings und manuelle Payouts.
- Moderation, Profanity-Events, Bans/Timeouts, Recording- und Runtime-Tools.
- Statusseite, Metriken und optionale Observability-Komponenten.

### 7.2 Unvollständige oder fehlerhafte Features

- **Subscription:** öffentlich aktivierbar und standardmäßig an, aber BillingIntent wird nicht als SUBSCRIPTION gespeichert, Renewals/Cancellations werden ohne intentId ignoriert, kein funktionierendes Kundenportal wurde gefunden.
- **Refund/Chargeback:** Providerereignisse lassen sich häufig nicht einem Intent zuordnen; fehlgeschlagene Debits werden verschluckt.
- **PayPal:** CHECKOUT.ORDER.APPROVED gilt bereits als completed, obwohl kein Capture-Schritt nachgewiesen ist.
- **Donation:** UI nutzt den vorhandenen Idempotency-Key nicht; Backend-Idempotenz ist nicht atomar.
- **Payout:** manuelle Freitext-Ziele, keine Maker-Checker-Trennung, keine Providerbestätigung, PAID kann nachträglich REJECTED werden.
- **Control-Safety:** kein Command-Acknowledgement, kein automatischer Server-E-Stop, keine verlässliche Refund-Kompensation nach Sendefehler.
- **Internationalisierung:** Routing vorhanden, Übersetzungen und Umschalter fehlen.
- **PWA:** Registrierung vorhanden, Offline-/Update-Strategie fehlt.
- **Data Export:** nur Profil, Robots und je maximal 100 Sessions/Queue-Einträge; Chat, Moderation, vollständiges Ledger, Billing, Payouts und Auditbezug fehlen.

### 7.3 Feature Gaps mit hohem Nutzen

- **Idee:** Verbindlicher Host-Go-live-Check mit Video-, Command-Ack-, E-Stop-, Netzwerk- und Zugriffsprüfung.
- **Idee:** In-App-/E-Mail-Benachrichtigungen für Queue-Turn, Zahlung, Refund, Payout, Robot offline und Moderationsereignisse.
- **Idee:** Vollständige Wallet-Historie mit Pagination, Filter, Beleg-/Exportfunktion und klarer Reconciliation-ID.
- **Idee:** Feature Flags für riskante Bereiche wie Subscription, Payout und Recording statt impliziter Env-Defaults.
- **Idee:** Analytics-Dashboard mit klarer Datenbasis, Retention und Consent-Entscheidung.
- **Idee:** Payout-Workflow mit verifiziertem Ziel, Statushistorie, Vier-Augen-Prinzip und Export für Buchhaltung.
- **Idee:** Eindeutige Session-Recording-Verknüpfung und sichtbare Aufnahme-/Retention-Hinweise im Raum.

## 8. Produkt- & Business-Audit

### 8.1 Zielgruppen-Fit

Das Produkt adressiert zwei klar erkennbare Gruppen:

- Hosts/Creator, die physische Robots, Streams und bezahlte Interaktionen anbieten.
- Zuschauer/Controller, die Robots entdecken, warten, steuern, chatten und Creator unterstützen.

Die technische Featurebreite passt zu Community-Robotik, Events, Makerspaces, Bildung und Creator-Erlebnissen. Der schwierigste Produktteil ist nicht Discovery, sondern Vertrauen: Nutzer müssen darauf vertrauen, dass Steuerung sicher, Warteschlangen fair, Zahlungen korrekt und Aufzeichnungen transparent sind. Genau diese vier Bereiche enthalten aktuell Blocker.

### 8.2 Monetarisierung

- **Gefunden:** Credit-Pakete, Plattformgebühr, bezahlte Buttons, Donations und Payouts bilden einen vollständigen Monetarisierungsentwurf.
- **Gefunden:** Die wirtschaftliche Bedeutung von balance und credits ist uneinheitlich. Das Leaderboard rankt Creator nach aktuellem credits-Wert, während Wallet-Transaktionen balance verwenden. Der Zeitraum filtert Sessions, nicht den angezeigten Vermögenswert.
- **Gefunden:** Earnings „per robot“ basiert nur auf den letzten 200 Transaktionen, während Lifetime-Summen anders berechnet werden. Das kann Berichte inkonsistent machen.
- **Gefunden:** Keine klare Umrechnung Credits zu Auszahlung, Mindestbetrag in Geld, Gebühren, Wechselkurs, Steuern oder Auszahlungsfrist im UI.
- **Risiko:** Ohne buchhalterisch unveränderliche Ledger-/Payout-Historie und Reconciliation darf kein Echtgeldbetrieb starten.

### 8.3 Conversion und Nutzerbindung

- **Positiv:** Explore, Featured-Bereiche, Suchfilter, Robotkarten und konkrete CTA-Struktur unterstützen Discovery.
- **Negativ:** Der wichtigste Host-CTA führt auf eine nicht vorhandene Route.
- **Negativ:** Queue-Disconnect löscht Positionen; fehlende Queue-Benachrichtigung und uneindeutige Turn-Anzeige schwächen Wiederkehr.
- **Negativ:** Checkout- und Payout-Texte lassen zentrale Kosten-/Rechtsfragen offen.
- **Idee:** Nach erfolgreichem ersten Robot-Go-live, erstem Turn und erster Donation gezielte Aktivierungsmeilensteine messen.

### 8.4 Professionalität und Wettbewerbsfähigkeit

- Die technische Breite ist für einen Alpha-Stand überdurchschnittlich.
- Sichtbare Vorlagentexte, widersprüchliche Claims, fehlende deutsche Inhalte und unklare Geldlogik wirken nicht produktionsreif.
- Unbelegte Performanceclaims wie etwa 150 ms Video oder automatische 300-ms-Sicherheitsreaktion sollten erst nach reproduzierbaren Benchmarks verwendet werden.
- Moderations- und Betriebsfunktionen sind ein Wettbewerbsvorteil, benötigen aber Rollenmatrix, Audit-Retention und Datenschutz-Minimierung.

## 9. QA & Testing

### 9.1 Vorhandener Umfang

- API: 43 Jest-Spec-Dateien mit 257 erkannten Tests im frischen Lauf; Auth, Queue, Controls, Wallet, Billing, Payouts, Gateway, Cross-Instance, LiveKit, Moderation, Recordings, Robots, Sessions und Maintenance sind vertreten.
- Eine Prisma-/Redis-Integration-Suite ist opt-in und im Standardlauf übersprungen.
- Web: 15 Vitest-Dateien mit 27 Tests; vor allem kleine Komponenten, Helpers und einzelne Robot-View-Teile.
- E2E: drei Dateien mit Smoke-, Auth- und Axe-Tests.
- Coverage-Schwellen API: 55 % Statements/Lines, 40 % Branches, 50 % Functions.
- Coverage-Schwellen Web: 25 % Statements/Lines, 50 % Branches, 35 % Functions.

### 9.2 Frischer Status

| Prüfung                              | Ergebnis                | Aussage                                                                             |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------- |
| Prisma validate                      | bestanden               | Schema syntaktisch gültig, keine Aussage zur Migration                              |
| Fresh-DB migrate deploy              | fehlgeschlagen          | Erste Migration setzt bestehende Basistabellen voraus                               |
| API Jest + Coverage                  | fehlgeschlagen          | 41 passed, 1 failed, 1 skipped; 4 Tests rot; alle Coverage-Schwellen unterschritten |
| Web Vitest + Coverage                | fehlgeschlagen          | 14/15 Dateien, 26/27 Tests; Fokus-Test rot; keine abschließende Coverage-Summe      |
| Playwright --project=chromium --list | fehlgeschlagen          | Config definiert kein benanntes chromium-Projekt                                    |
| Lint                                 | nicht abgeschlossen     | Wegen parallel gestarteter Fremd-Vollmatrix ressourcenschonend abgebrochen          |
| Typecheck                            | nicht ausgeführt        | Wegen fremder Vollmatrizen und hoher Last nicht sicher gestartet; nicht grün        |
| Production Build                     | nicht ausgeführt        | Gleiche Ressourcenlage; Build ignoriert zudem Web-Type-/Lintfehler                  |
| E2E-Lauf                             | nicht belastbar möglich | CI-Parameter defekt; Smoke-Suite benötigt nicht bereitgestellte Fixtures/API        |

### 9.3 Konkrete Testprobleme

- **Gefunden:** bot.gateway.protocol.spec.ts stellt LivekitService nach einer Constructor-Erweiterung nicht bereit. afterEach ruft zusätzlich close auf einem nicht initialisierten Modul auf und erzeugt Folgefehler.
- **Gefunden:** dashboard-sidebar.test.tsx erwartet eine Fokusreihenfolge, die der gerenderte DOM nicht erfüllt.
- **Gefunden:** Jest nutzt --forceExit. Offene Handles werden verdeckt; der frische Lauf weist explizit darauf hin.
- **Gefunden:** Web-Coverage-Schwellen sind so niedrig, dass selbst ein „grüner“ Wert die kritischen Client-Orchestratoren nicht ausreichend absichert.
- **Gefunden:** API-Controller, Guards, Billing-Provider, Mail, Maintenance und LiveKit weisen im frischen Bericht große ungetestete Bereiche auf.
- **Gefunden:** Finanztests mocken Prisma auf Methodenebene. Parallelitäts-, Crash- und echte Transaktionsinvarianten werden nicht geprüft.
- **Gefunden:** Payout-Tests kodieren das fehlerhafte Verhalten, dass Reject auch nach APPROVED möglich ist, statt eine strikte State-Machine zu verlangen.
- **Gefunden:** Playwright webServer startet nur pnpm dev im Web-Package. Die Smoke-Tests erwarten API-Daten und einen Robot test-robot, provisionieren aber weder API noch Datenbank noch Fixture.
- **Gefunden:** CI-Coverage lädt apps/coverage hoch; Jest schreibt laut package.json nach apps/api/coverage.
- **Gefunden:** E2E-CI übergibt --project=chromium, die Config hat kein projects-Array.
- **Gefunden:** .github ist ignoriert und unversioniert; selbst korrigierte Workflows schützen damit keine Branches.

### 9.4 Fehlende kritische Tests

- Parallel doppelte Donation mit identischem Key.
- Zwei gleichzeitige Billing-Completion-Events sowie Crash zwischen PAID und Wallet-Credit.
- Refund/Chargeback mit fehlendem Guthaben, Duplicate Events und Provider-Referenzauflösung.
- Zwei gleichzeitige mark-paid-Aufrufe sowie unerlaubte Payout-Transitions.
- PayPal Order Approved versus tatsächlich Captured.
- Subscription Initial Purchase, Renewal, Failure, Cancellation und Portal.
- Fresh-DB-Migration und Upgrade von jeder unterstützten Vorversion.
- Cookie-authentifizierte CSRF-Tests für alle Mutationen.
- LiveKit-Gastzugriff für alle Kombinationen aus visibility, accessMode und video policy.
- Redirect-/DNS-Rebinding-SSRF-Tests.
- Stale/future Control Commands, E-Stop-Schwelle, Robot-Ack und Kompensation.
- Zwei API-Replikate mit aktiver Session, Turn-Ownership und Disconnect.
- Session-Recording-Isolation.
- Vollständige Account-Deletion/Export-/Retention-Invarianten.

### 9.5 Manuelle QA-Matrix vor Release

1. Desktop Chrome, Firefox, Safari und Edge; iOS Safari und Android Chrome.
2. Tastatur-only, NVDA/JAWS, VoiceOver, Zoom 200/400 %, Reduced Motion, High Contrast.
3. Langsame/instabile Netze, WebSocket-Reconnect, LiveKit reconnect, Robot offline während bezahltem Command.
4. Zwei Nutzer und zwei Geräte je Account in Queue/Turn/Moderation.
5. Echte Stripe-/PayPal-Sandbox: success, cancel, delayed, duplicate, refund, partial refund, dispute, webhook replay.
6. SMTP-Ausfall, Queue-Ausfall, Redis-Eviction, PostgreSQL-Failover, S3-/LiveKit-Ausfall.
7. Backup plus Restore in neuer Umgebung und kompletter Smoke-Test.
8. Hardware-E-Stop, Software-E-Stop, hängende Bewegung und Command-Ack mit einem realen Robot-Client.

## 10. Performance Audit

### 10.1 Frontend

- **Gefunden:** Mehrere sehr große Client-Komponenten/Hooks erhöhen Hydration-, Parsing- und Re-Render-Risiko. Ohne frischen Bundle-Analyzer-Lauf wird keine konkrete Bundlegröße behauptet.
- **Positiv:** Dashboard-/LiveKit-/Moderationsbereiche nutzen teilweise dynamische Imports; öffentliche Robotdaten werden mit ISR/Revalidate geladen; next/image wird an zentralen Karten verwendet.
- **Gefunden:** adaptiveStream und dynacast sind im Video-Renderer deaktiviert. Mehrere Kameras können dadurch auf mobilen oder schwachen Verbindungen unnötig Bandbreite verbrauchen.
- **Gefunden:** Controls/Roomzustand pollen in kurzen Intervallen zusätzlich zu WebSockets. Der genaue Request-Impact ist zu messen.
- **Gefunden:** Der Service Worker bringt derzeit keinen Offline- oder Cachevorteil.
- **Prüfpunkt:** next build --analyze, Lighthouse, Web Vitals und mobile CPU-/Netzprofile fehlen als versionierte Budgets.

### 10.2 Backend und Datenbank

- **Gefunden:** Jeder Control Command kann Robot-, Access-, Button-, Queue-, Moderation-, Cooldown- und Walletzugriffe auslösen. Für den Hot Path fehlen Last- und Latenzbudgets.
- **Gefunden:** Presence schreibt viewerCount auf Join/Leave in PostgreSQL.
- **Gefunden:** Queue Leave/Voting erzeugt O(n)-Updates.
- **Gefunden:** Recording-Listen und Datei-Fallbacks scannen den gesamten Bucket.
- **Gefunden:** Earnings perRobot lädt nur ein fixes Fenster von 200 Transaktionen und aggregiert im Prozess; Ergebnis und Laufzeit skalieren nicht sauber.
- **Risiko:** Globale rawBody-Erfassung bis 5 MiB erhöht Speicherverbrauch pro parallelem Request.
- **Positiv:** Öffentliche Robotübersichten verwenden gezielte Selects, Indizes und teils rohe, parametrisierte Aggregation. Redis-Locks und Caches sind für Hot Paths bereits angelegt.

### 10.3 Messbare Zielwerte

Vor Release sollten mindestens folgende Budgets im CI oder Staging gemessen werden:

- Public LCP p75 <= 2,5 s und INP p75 <= 200 ms auf Mobile-Mid-Tier.
- Initiales JS pro öffentlicher Route mit dokumentiertem Budget; Regression <= 10 %.
- REST p95 <= 300 ms ohne externe Provider, Fehlerquote < 1 % unter Ziel-Last.
- Control-Autorisierung bis Robot-Send p95 <= 100 ms im gleichen Rechenzentrum; stale Commands werden verworfen.
- Queue Join/Leave mit 100 und 1.000 Einträgen ohne Timeouts/Deadlocks.
- Recording-Lookup unabhängig von Gesamtobjektzahl durch Prefix/Index.
- Zwei API-Replikate unter realistischer WebSocketzahl ohne Session-/Turn-Duplikate.

## 11. DevOps & Deployment

### 11.1 Build und CI/CD

- **Gefunden – P0:** .gitignore ignoriert .github vollständig. git ls-files enthält keine Workflowdatei. CI, CodeQL und Release-Workflows sind damit nur lokale Dateien.
- **Gefunden – P1:** Next config setzt eslint.ignoreDuringBuilds und typescript.ignoreBuildErrors auf true. Der Web-Produktionsbuild kann trotz Fehlern erfolgreich sein.
- **Gefunden:** Das Web-Dockerfile setzt zusätzlich NEXT_SKIP_TYPECHECK=1.
- **Gefunden:** CI-E2E und Coverage-Artifact-Pfad sind fehlerhaft.
- **Gefunden:** Mutable Image-Tags wie latest für App, MinIO und mc verhindern reproduzierbare Rollbacks und erschweren Supply-Chain-Kontrolle.

### 11.2 Docker Compose und Entwicklungsumgebung

- **Gefunden – P1:** docker-compose.dev.yml referenziert target: dev, aber weder docker/api/Dockerfile noch docker/web/Dockerfile besitzt eine dev-Stage.
- **Gefunden:** API-Command pnpm --filter api start:dev referenziert ein nicht vorhandenes Script; das Script heißt dev.
- **Gefunden:** Wird die Dev-Datei allein verwendet, erwartet Compose ein nicht vorhandenes Root-Dockerfile. In der dokumentierten Merge-Variante bleiben zumindest die falschen Stages/Commands.
- **Gefunden:** Die HTTP-Nginx-Konfiguration hört auf Port 80, der Healthcheck prüft HTTPS auf 127.0.0.1. Ohne generierte SSL-Konfiguration wird der Proxy ungesund.
- **Gefunden:** Docker-Compose-Variablen verlangen direkte Secrets teilweise per :?, während gleichzeitig \*\_FILE-Varianten gesetzt werden. Ein reiner Docker-Secret-Betrieb kann an der Compose-Substitution scheitern.
- **Gefunden:** Für API/Web sind keine CPU-/Memory-Limits oder Reservations definiert.
- **Gefunden:** cAdvisor und Promtail erhalten weitreichende Host-/Docker-Socket-Zugriffe. Das ist nur in klar isolierten Operator-Umgebungen vertretbar.

### 11.3 ENV und Konfigurationsparität

- **Gefunden:** Produktions-Compose reicht mehrere im Code genutzte Variablen nicht durch, darunter Subscription-, Provider-, Plattformgebühr-, Sentry-/OTEL- und Teile der Recording-/Retention-Konfiguration.
- **Gefunden – P0:** SUBSCRIPTION_MONTHLY_ENABLED fehlt im Compose-Service. Der Code aktiviert den Default-Plan, solange der Wert nicht explizit false ist.
- **Gefunden – Risiko:** NEXT*PUBLIC*-Variablen werden bei Next in Clientbundles zur Buildzeit eingebettet. Compose setzt viele davon erst als Runtime-Environment des fertigen Images; das ausgelieferte Bundle kann falsche Default-URLs/Legalwerte enthalten.
- **Gefunden:** .env.example und tatsächliche Verwendung sind nicht vollständig synchron, unter anderem bei Analytics-Retention, Cleanup-Intervall, Public Web URL, Robot-JWT-Ablauf, Recording-Signing, App-Version und Observability.
- **Gefunden:** setup-env.sh ist gegenüber der aktuellen Variablenmenge unvollständig und verwendet unsichere Defaults.

### 11.4 Health, Monitoring und Rollback

- **Gefunden:** /health kann degraded melden, ohne nachgewiesenen non-200-Status. Container prüfen nur /health/live und warten daher nicht auf Redis/PostgreSQL/LiveKit-Bereitschaft.
- **Gefunden:** Sentry-Code ist vorhanden, Pakete fehlen; ein DSN allein aktiviert keine Fehlererfassung.
- **Positiv:** Pino, Prometheus, OpenTelemetry, Grafana/Loki und strukturierte Health-Endpunkte sind als Basis vorhanden.
- **Gefunden:** Keine SLOs, Alertregeln, Pager-Zuordnung oder nachgewiesene Release-/Rollback-Automation.
- **Gefunden:** Release-Workflow ist lokal vorhanden, aber nicht versioniert; Image-Signatur/SBOM/Provenance sind nicht nachgewiesen.

### 11.5 Backup und Restore

- **Gefunden:** Backupskripte und Runbook existieren.
- **Gefunden:** Skripte enthalten Fallback-Passwörter und widersprüchliche Retention-Angaben.
- **Gefunden:** Restore-Dokumentation referenziert nicht vorhandene Services wie streamer/agents und ignoriert teils Fehler.
- **Prüfpunkt:** Es gibt keinen frischen, automatisierten Restore-Nachweis auf eine neue Umgebung; S3/MinIO, Redis-relevanter Zustand, Secrets und LiveKit-Konfiguration sind nicht als vollständiges Recovery-Set dokumentiert.

## 12. Dokumentation

### 12.1 Positiv

- Umfangreiche README, CONTRIBUTING, Setup-, WebSocket-, Robot-Auth-, Observability- und Runbook-Dokumente.
- ADRs für Gateway, Prisma, Redis, Turn-State und Wallet.
- OpenAPI-Datei und Generatoren für API-Client-Dokumentation.
- Betriebs- und Robot-Setup-Seiten sind auch im Produkt vorhanden.

### 12.2 Konkrete Lücken und Drift

- **Gefunden:** README nennt Node 24, package engines >=22 und CONTRIBUTING 22+; .nvmrc/.node-version stehen auf 24.
- **Gefunden:** README verspricht automatischen E-Stop >300 ms, der Server sendet nur eine Warnung >200 ms und verwirft nicht einmal Commands älter als MAX_CONTROL_COMMAND_AGE_MS.
- **Gefunden:** README nennt Wallet/Billing als fehlende Wiring-Arbeit, obwohl umfangreicher Code vorhanden ist.
- **Gefunden:** robot-auth.md dokumentiert robot:identify, der aktuelle WebSocket-Vertrag verwendet robot:claim.
- **Gefunden:** Shared README nennt Enum-/Queuewerte wie INVITE_ONLY, ALLOWLIST, FIFO oder VOTE, die nicht den aktuellen Schemawerten entsprechen.
- **Gefunden:** Zwei WebSocket-ADRs mit 0001/ADR-001 überlappen und enthalten unbelegte Größen-/Latenzbehauptungen.
- **Gefunden:** ADR 0006 beschreibt Active Turns als rein lokal, der aktuelle Code verwendet Redis plus lokalen Fallback.
- **Gefunden:** Runbook nennt /health/metrics statt des externen Pfads /api/v1/health/metrics und enthält weitere veraltete Compose-/Servicebeispiele.
- **Gefunden:** docs/openapi.json enthält zwar viele Routen, ist aber gegenüber aktuellen Subscription-/Admin-/Auth-Endpunkten als Driftverdacht zu behandeln. Der vorgesehene CI-Driftcheck wird wegen unversioniertem Workflow nicht ausgeführt.
- **Gefunden:** Kein konsistentes Changelog-/Release- und Migrationshandbuch für Betreiber.
- **Prüfpunkt:** Robot-Client-Referenzimplementierung liegt nicht im geprüften Repository. Hardwareprotokoll, Ack-Semantik und sichere Stop-Implementierung können daher nicht end-to-end bestätigt werden.

## 13. Rechtliches & Compliance

### 13.1 Gefundener Stand

- Imprint, Privacy, Cookie Notice und Terms sind als Seiten vorhanden.
- Konfigurierbare Operator-, Adress-, Register-, VAT- und Supportdaten sind vorgesehen.
- Privacy beschreibt Accounts, Realtime, Moderation, Billing, Recording und Betroffenenrechte.
- Nutzer können einen JSON-Export anstoßen und ihr Konto löschen.

### 13.2 Release-Blocker und Abweichungen

- **Gefunden – P1:** Bei fehlender Konfiguration werden Self-hosted BotParty operator, legal@localhost.invalid und „address not configured“ öffentlich ausgegeben. Ein Deployment-Gate verhindert das nicht.
- **Gefunden – P1:** Terms und Privacy zeigen sichtbar Vorlage-, Anpassungs- und Konfigurationshinweise. Das ist kein finaler Vertragstext und wirkt nicht wie eine veröffentlichte Betreibererklärung.
- **Gefunden:** Registrierung besitzt keine klar verlinkte Einwilligungs-/Kenntnisnahme für Terms und Privacy.
- **Gefunden:** Checkout erfasst keine ausdrückliche Sofortlieferungs-/Widerrufsbestätigung, obwohl der eigene Text diese für EU-Verbraucher als möglichen Bedarf nennt.
- **Gefunden:** Cookie-Banner speichert nur eine Präferenz. Accept/Decline schaltet keine erkennbaren Kategorien; funktionale localStorage-/sessionStorage-Nutzung läuft unabhängig weiter. Die Cookie-Seite nennt keine exakten Schlüssel, Laufzeiten oder Drittanbieter.
- **Gefunden:** Account Export ist nicht vollständig genug, um die im Text beschriebene Auskunftsfunktion allein zu erfüllen.
- **Gefunden:** Hard Delete kaskadiert Transaktionen, BillingIntents, WalletIdempotencyKeys und PayoutRequests. Finanz- und Auditnachweise können dadurch verschwinden, obwohl Terms/Privacy gesetzliche Aufbewahrung erwähnen.
- **Gefunden:** Billing-Webhook-Payload, Payout-Ziel und Admin-/Moderationsdaten haben keine konsistent dokumentierte, technisch durchgesetzte Retention.
- **Gefunden:** Schema erwartet AdminAuditLog.expiresAt mit 90 Tagen; die Migration erzeugt die Spalte nicht. Der Cleanup kann daher auf realen DBs scheitern.
- **Gefunden:** Recordings werden bei Accountlöschung nur für eigene Robots und nur bei verfügbarer Storage-Konfiguration entfernt. Backups, Sessionbezug und Aufzeichnungen, auf denen der Nutzer als Controller erscheint, sind nicht abgedeckt.
- **Prüfpunkt:** Rechtsgrundlagen, Auftragsverarbeiterverträge, Drittlandtransfers, Verzeichnis der Verarbeitungstätigkeiten, TOMs, Incident-Prozess, KYC/AML/Steuern bei Creator-Payouts sowie Minderjährigenschutz sind außerhalb des Codes zu klären.

### 13.3 Datenschutz durch Technik

- Datenminimierung für Staff ist zu schärfen: MOD kann Nutzerlisten inklusive E-Mail sehen.
- Freie Webhook-Payloads, User-Agent/IP in Donation-Metadaten und vollständige Providerpayloads brauchen Zweck, Zugriff und Löschfristen.
- Finanzhistorie sollte pseudonymisiert erhalten bleiben, während das Nutzerprofil gelöscht/anonymisiert wird.
- Recording muss eine eindeutige Sessionzuordnung, Aufnahmeanzeige, Zweck- und Retention-Regel erhalten.

## 14. Priorisierte Maßnahmen

### P0 – kritisch, sofort

1. Zahlungen, Subscriptions, Payouts und kostenpflichtige Controls bis zur transaktionalen Absicherung per Feature Flag deaktivieren.
2. Vollständige Prisma-Baseline erstellen und Fresh-DB-/Upgrade-Migrationen als Gate etablieren.
3. LiveKit-Gastzugriff für PASSWORD/ALLOWED_USERS schließen.
4. Steuerbefehle nach Alter verwerfen, automatischen E-Stop serverseitig erzwingen und doppelte UI-Auslösung entfernen.
5. Billing-Gutschrift/Reversal, Donation und Payout atomar und idempotent machen.
6. PayPal erst nach bestätigtem Capture gutschreiben.
7. Webhook-SSRF über Redirect und DNS-Rebinding schließen.
8. SMTP/Produktionsstart fail-closed gestalten und Token-Logging entfernen.
9. Sicheren Produktionsbootstrap ohne Standardpasswort/HTTP-Default einführen.
10. Direkte hohe Dependency-Advisories beheben und erneut auditieren.

### P1 – vor Release

1. .github aus .gitignore entfernen, Workflows versionieren und alle Gates reparieren.
2. Build darf Type-/Lintfehler nicht ignorieren; rote Tests und Coverage beheben.
3. Payout-State-Machine, Vier-Augen-Prinzip und Finanz-Retention implementieren.
4. Cookie-authentifizierte Mutationen einheitlich CSRF-schützen; REST-Tokenrevocation konsistent machen.
5. Robot-/LiveKit-Tokenrevocation und kurze Controller-TTLs einführen.
6. Defekte Host-Route und Queue-/Turn-Anzeige reparieren.
7. Tastaturfalle, Dialogfokus und pointer-only Controls beheben.
8. Rechtstexte finalisieren, Pflichtkonfiguration validieren und Checkout-Zustimmungen klären.
9. Subscriptions entweder vollständig implementieren oder überall deaktivieren/entfernen.
10. Dev-/Prod-Compose, Nginx-Health, Secrets und Buildtime-ENV korrigieren.
11. Session-/Turn-Ownership für mehrere Replikate absichern.
12. Recording eindeutig an Sessions binden.

### P2 – sollte verbessert werden

1. Große Hooks/Pages entlang fachlicher Seams zerlegen und Shared Contracts ausbauen.
2. Queue-/Presence-/Recording-Hotpaths skalierbar machen.
3. Testabdeckung nach Risiko statt globalem Mindestwert anheben.
4. Vollständigen Datenexport, Wallet-Historie und Reconciliation-UI liefern.
5. Dokumentation/OpenAPI/ADRs synchronisieren.
6. Monitoring, SLOs, Alerts, Restore-Drills und Rollbacknachweise aufbauen.
7. Echte deutsche Lokalisierung liefern oder de-Routing entfernen.
8. CSP härten und Header zentralisieren.

### P3 – Nice-to-have

1. PWA-Offline-/Update-Strategie oder Service-Worker-Entfernung.
2. Produktanalytics-Dashboard mit sauberem Consent-/Retention-Modell.
3. Geführtes Host-Onboarding, Queue-/Incident-Benachrichtigungen.
4. Benchmark-basierte Performanceclaims und automatisierte Bundlebudgets.
5. Erweiterte Beleg-/Exportfunktionen für Creator und Betreiber.

## 15. Konkrete Aufgabenliste

Die Reihenfolge innerhalb einer Priorität folgt Abhängigkeiten und Risikoreduktion. „Gefunden“ bezeichnet reproduzierte oder direkt gelesene Defekte; „Risiko“ und „Prüfpunkt“ dürfen erst nach zusätzlichem Nachweis als Bug geschlossen werden.

### 15.1 P0 – Kritische Aufgaben

- [x] **Eine vollständige, unveränderliche Prisma-Baseline herstellen**
  - Umgesetzt und geprüft (18.07.2026): Unveränderliche Initialmigration und Vorwärtsmigration ergänzt; Fresh-DB, Legacy-Upgrade, `migrate deploy`, Driftcheck und Wiederholung liefen auf PostgreSQL 16 grün.
  - Priorität: P0
  - Kategorie: DevOps
  - Problem: **Gefunden.** Die erste der sieben Migrationen verändert Relation "Robot", obwohl auf einer leeren Datenbank noch keine Tabelle existiert und das Schema "robots" verwendet. Fresh-DB migrate deploy endet reproduzierbar mit P3018/42P01.
  - Risiko/Auswirkung: Neue Deployments, Disaster-Recovery und saubere CI-Umgebungen können keine Datenbank aufbauen. Das Entrypoint-Baselining kann Drift verdecken.
  - Ziel: Eine leere unterstützte PostgreSQL-Version wird ausschließlich aus versionierten Migrationen vollständig und deterministisch aufgebaut.
  - Betroffene Dateien/Bereiche: packages/prisma/prisma/migrations; packages/prisma/prisma/schema.prisma; docker/api/entrypoint.sh; Datenbankdokumentation.
  - Konkreter Umsetzungshinweis: Aktuellen Zielzustand als geprüfte Initialmigration erzeugen; bestehende Produktionsdatenbanken über einen separat getesteten Upgradepfad behandeln; keine bereits ausgerollte Migration nachträglich editieren; das pauschale „alle Migrationen applied“ im Entrypoint entfernen.
  - Akzeptanzkriterium: prisma migrate deploy ist auf leerem PostgreSQL 16 erfolgreich; prisma migrate diff zeigt danach keinen Drift; Upgrade-Test eines anonymisierten Altstands ist grün; erneuter Lauf ist idempotent.
  - Geschätzter Aufwand: groß

- [x] **Riskante Monetarisierungsfunktionen bis zur Reparatur fail-closed schalten**
  - Umgesetzt und geprüft (18.07.2026): Zentral validierte, standardmäßig deaktivierte Flags sperren Billing, Donations, Payouts, Paid Controls und Subscriptions in API und UI; Flag-Matrix ist getestet.
  - Priorität: P0
  - Kategorie: Produkt
  - Problem: **Gefunden.** Subscription ist standardmäßig aktiv, Payout und Paid Controls sind ohne zentrale Release-Freigabe erreichbar, obwohl ihre Buchungsinvarianten verletzt sind.
  - Risiko/Auswirkung: Reales Geld, Creator-Guthaben und physische Aktionen können falsch verbucht werden.
  - Ziel: Checkout, Subscription, Payout, Donation und kostenpflichtige Controls sind pro Funktion explizit aktivierbar und standardmäßig aus.
  - Betroffene Dateien/Bereiche: apps/api/src/billing; apps/api/src/earnings; apps/api/src/wallet; apps/api/src/gateway/control.handler.ts; Pricing/Wallet/Robot-UI; .env.example; docker-compose.yml.
  - Konkreter Umsetzungshinweis: Validierte Feature Flags mit Default false und Boot-Log einführen; API-Endpunkte und UI gemeinsam sperren; Status klar, ohne irreführende Kauf-CTAs, anzeigen.
  - Akzeptanzkriterium: Ohne explizite Produktionsfreigabe liefert kein Monetarisierungsendpunkt einen Checkout oder bucht Credits; UI zeigt keine aktive Kauf-/Payout-Aktion; automatisierte Flag-Tests bestehen.
  - Geschätzter Aufwand: mittel

- [x] **BillingIntent ohne kollidierende Platzhalterreferenz anlegen**
  - Umgesetzt und geprüft (18.07.2026): Intents starten ohne Platzhalterreferenz, besitzen explizite Zustände und korrelierbare IDs; Parallel- und Providerfehler-Tests verhindern Kollisionen und Blockaden.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** Einmal- und Subscription-Checkout legen providerRef als literal "pending" an, während provider plus providerRef eindeutig ist. Erst nach erfolgreicher Providererstellung wird die echte Referenz gespeichert.
  - Risiko/Auswirkung: Parallele Checkouts kollidieren; bleibt ein Provideraufruf nach dem Insert hängen oder schlägt fehl, kann der Platzhalter weitere Checkouts desselben Providers blockieren.
  - Ziel: Noch nicht bekannte Providerreferenzen sind NULL oder eindeutig; fehlgeschlagene Checkout-Erstellung hinterlässt einen klaren, wiederholbaren Status.
  - Betroffene Dateien/Bereiche: apps/api/src/billing/billing.service.ts; Prisma BillingIntent; Checkout-Tests.
  - Konkreter Umsetzungshinweis: providerRef initial NULL, expliziter CREATING/PENDING/FAILED-Zustand, Providercall mit korrelierbarer Intent-ID; Cleanup/Retry und Unique Constraint auf echte Referenzen.
  - Akzeptanzkriterium: 20 parallele Checkouts desselben Providers erstellen unabhängige Intents; Providerfehler blockiert keinen Folgecheckout; keine "pending"-Referenz bleibt in der Datenbank.
  - Geschätzter Aufwand: mittel

- [x] **Billing-Completion und Wallet-Gutschrift atomar/idempotent machen**
  - Umgesetzt und geprüft (18.07.2026): Providerereignis, Intentstatus, Balance und eindeutige Ledgerrelation laufen in einer wiederholbaren Serializable-Transaktion; Parallel-, Retry-, Betrags- und Währungstests sind grün.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** BillingIntent wird in einer Transaktion PAID, die Wallet-Gutschrift erfolgt danach. Ein Crash verliert die Gutschrift; parallele Events können nach nicht atomarer Vorprüfung doppelt gutschreiben. Die Implementierung prüft den Betrag, aber nicht die Währung.
  - Risiko/Auswirkung: Nutzer zahlen ohne Credits oder erhalten doppelte Credits; Ledger und Providerstatus driften.
  - Ziel: Genau eine Gutschrift je BillingIntent, auch bei Parallelität, Retry und Prozessabsturz.
  - Betroffene Dateien/Bereiche: apps/api/src/billing/billing.service.ts; apps/api/src/wallet/wallet.service.ts; Prisma Transaction/BillingIntent-Schema und Migrationen.
  - Konkreter Umsetzungshinweis: Eindeutige billingIntentId-Spalte oder dedizierte Ledger-Relation mit Unique Constraint ergänzen; Statuswechsel, Eventpersistenz, Balance-Update und Ledgerzeile in einer Serializable-Transaktion mit Retry ausführen; Betrag, Währung, Providerreferenz und Nutzerbezug prüfen; paidAt setzen.
  - Akzeptanzkriterium: 20 parallele gleiche und verschiedene Completion-Events erzeugen genau eine DEPOSIT-Buchung; Crash-/Retry-Test konvergiert zu PAID plus korrekter Balance; falsche Währung/Referenz wird ohne Gutschrift in Review gestellt; Datenbankconstraint verhindert Duplikate.
  - Geschätzter Aufwand: groß

- [x] **Refund- und Chargeback-State-Machine transaktionssicher implementieren**
  - Umgesetzt und geprüft (18.07.2026): Refunds und Chargebacks lösen Intents über persistierte Providerreferenzen auf, buchen atomar genau einmal und führen unauflösbare Ereignisse in `needs-review`; Replay- und Fehlerfälle sind getestet.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** Status wird vor dem Debit auf REFUNDED/CHARGEBACK gesetzt; Debit-Fehler werden geschluckt. Stripe- und PayPal-Reversal-Events besitzen häufig keine intentId und werden ignoriert. Wiederholte verschiedene Events können mehrfach abbuchen.
  - Risiko/Auswirkung: Status behauptet eine Umkehr, obwohl Credits erhalten bleiben; alternativ entstehen Mehrfachbelastungen.
  - Ziel: Providerereignis, Intentauflösung, einmalige Reversal-Buchung und Status bilden eine wiederholbare atomare Einheit.
  - Betroffene Dateien/Bereiche: apps/api/src/billing/billing.service.ts; providers/stripe.provider.ts; providers/paypal.provider.ts; Prisma BillingWebhookEvent/BillingIntent/Transaction.
  - Konkreter Umsetzungshinweis: Provider Payment/Capture/Charge/Subscription-Referenzen dauerhaft verknüpfen; Reversal-Ledgerzeile eindeutig an Intent plus Reversal-ID binden; unzureichendes Guthaben als expliziten Debt/Frozen-Zustand modellieren statt Fehler zu verschlucken.
  - Akzeptanzkriterium: Refund, Partial-/Full-Refund nach definierter Policy, Chargeback, Duplicate und Replay sind integriert getestet; jeder Event endet in eindeutigem processed/needs-review/failed-Zustand; kein Erfolg bei fehlgeschlagener Buchung.
  - Geschätzter Aufwand: groß

- [x] **Donation-Idempotenz vor der Überweisung reservieren**
  - Umgesetzt und geprüft (18.07.2026): Idempotency-Key, Transfer und Ergebnis werden atomar reserviert und persistiert; parallele Duplikate liefern dieselbe Ledgergruppe, die UI verwendet eine stabile UUID je Versuch.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** Der Dienst liest den Key, überweist und legt den Key erst danach an. Bei Parallelität überweisen beide Requests; der P2002-Fehler des zweiten Keys wird als unkritisch verworfen.
  - Risiko/Auswirkung: Doppelte Belastung und Creator-Gutschrift bei Retry/Doppelklick.
  - Ziel: Ein Idempotency-Key führt über alle Instanzen genau zu einer Donation.
  - Betroffene Dateien/Bereiche: apps/api/src/wallet/donation.service.ts; WalletIdempotencyKey-Schema; apps/web/src/components/robot-view/donation-dialog.tsx; apps/web/src/lib/api/wallet.ts.
  - Konkreter Umsetzungshinweis: Key atomar als IN_PROGRESS reservieren oder Transfer und Resultat in einer Transaktion mit Unique Constraint ausführen; UI pro Absendeversuch UUID erzeugen und bei Retry wiederverwenden.
  - Akzeptanzkriterium: 20 parallele Requests mit demselben Key erzeugen eine Ledgergruppe; alle Antworten liefern dasselbe Ergebnis; neue Keys funktionieren unabhängig.
  - Geschätzter Aufwand: mittel

- [x] **Payout-Transitions und Auszahlung atomar absichern**
  - Umgesetzt und geprüft (18.07.2026): Conditional Transitions, Wallet-Debit, `paidAt`, externe Referenz und Auditlog sind atomar; `PAID` ist unveränderlich und Parallel-/State-Matrix-Tests sind grün.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** markPaid bucht vor dem Statusupdate und ohne Transaktion; parallele Aufrufe können doppelt abbuchen. reject darf selbst APPROVED und PAID nach REJECTED setzen; paidAt wird nicht gesetzt.
  - Risiko/Auswirkung: Doppelauszahlung/-abbuchung, nachträgliche Statusfälschung und nicht auditierbare Finanzhistorie.
  - Ziel: Strikte Zustandsfolge PENDING → APPROVED → PAID oder PENDING/APPROVED → REJECTED nach definierter Policy, jede Transition einmalig.
  - Betroffene Dateien/Bereiche: apps/api/src/earnings/payouts.service.ts; payouts.controller.ts; Prisma PayoutRequest/Transaction; Staff-Payout-UI und Tests.
  - Konkreter Umsetzungshinweis: Conditional updateMany auf erwarteten Ausgangsstatus, Walletbuchung und paidAt in einer Transaktion; eindeutige payoutRequestId im Ledger; PAID unveränderlich; Reversal als eigener Zustand/Event.
  - Akzeptanzkriterium: Paralleltest markPaid erzeugt eine WITHDRAWAL-Buchung; PAID kann nicht rejected werden; jede Transition hat Actor, Zeit und Auditlog; State-Matrix ist vollständig getestet.
  - Geschätzter Aufwand: groß

- [ ] **PayPal erst nach bestätigtem Capture gutschreiben**
  - Technisch umgesetzt und geprüft (18.07.2026): `ORDER.APPROVED` schreibt nicht gut, `PAYMENT.CAPTURE.COMPLETED` wird samt Order-/Capturebezug, Betrag und Währung genau einmal verarbeitet; Unit- und Providervertragstests sind grün. Externer Abnahmeblocker: Der geforderte echte PayPal-Sandbox-E2E benötigt Client-Credentials und Webhook-ID.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** CHECKOUT.ORDER.APPROVED wird als completed interpretiert; ein serverseitiger Capture-Schritt ist nicht vorhanden.
  - Risiko/Auswirkung: Credits können vor finalem Zahlungseingang gutgeschrieben werden.
  - Ziel: Nur PAYMENT.CAPTURE.COMPLETED mit verifizierter Order/Capture-Zuordnung darf Credits freigeben.
  - Betroffene Dateien/Bereiche: apps/api/src/billing/providers/paypal.provider.ts; billing.service.ts; PayPal-Konfiguration und Tests.
  - Konkreter Umsetzungshinweis: Intent-, Order- und Capture-ID persistieren; APPROVED höchstens als Zwischenzustand speichern; Capture serverseitig durchführen oder ausschließlich auf verifiziertes Capture-Webhook warten; Betrag und Währung prüfen.
  - Akzeptanzkriterium: APPROVED allein erzeugt keine Gutschrift; CAPTURE.COMPLETED genau eine; denied/refunded/disputed konvergieren korrekt; PayPal-Sandbox-E2E ist dokumentiert grün.
  - Geschätzter Aufwand: groß

- [x] **Subscription-Endpunkte deaktivieren, bis der komplette Lebenszyklus implementiert ist**
  - Umgesetzt und geprüft (18.07.2026): Subscription-Planliste und Checkout sind server- und clientseitig fail-closed und standardmäßig deaktiviert; eine Aktivierung ohne Billingfreigabe wird beim Boot abgewiesen.
  - Priorität: P0
  - Kategorie: Feature
  - Problem: **Gefunden.** Default ist aktiv; purchaseType bleibt ONE_TIME; Renewals und Kündigungen haben intentId null; kein nutzbares Kundenportal wurde gefunden; UI verspricht Kündigung im Account.
  - Risiko/Auswirkung: Wiederkehrende Zahlungen ohne wiederkehrende Credits oder Kündigungsmöglichkeit.
  - Ziel: Kurzfristig keine Subscription-Verkaufsfläche; langfristig vollständiger, getesteter Lifecycle.
  - Betroffene Dateien/Bereiche: subscription-plans.ts; billing.service/controller.ts; StripeProvider; Pricing; Compose/ENV.
  - Konkreter Umsetzungshinweis: Default false und Endpoint-Gate sofort; für Reaktivierung Customer-/Subscription-IDs, purchaseType, Renewal-Intent/Ledger, Failure/Cancellation und Billing Portal implementieren.
  - Akzeptanzkriterium: Ohne explizites Flag liefert die Planliste leer und Checkout 404/disabled; Reaktivierung erfordert grüne Sandbox-Tests für Initialkauf, Renewal, Failed Payment, Cancel und Portal.
  - Geschätzter Aufwand: kurzfristig klein, vollständig groß

- [x] **LiveKit-Gastzugriff an alle Raumzugriffsmodi koppeln**
  - Umgesetzt und geprüft (18.07.2026): Viewer-Tokens verwenden die gemeinsame Capability-Autorisierung für Visibility, AccessMode und Video-Policy; die vollständige Zugriffsmatrix ist automatisiert getestet.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** viewer-public validiert Raumfreigabe nur für LINK_ONLY; PASSWORD und ALLOWED_USERS werden bei öffentlicher Visibility und Video ALL umgangen.
  - Risiko/Auswirkung: Nicht autorisierte Zuschauer erhalten Livevideo geschützter Räume.
  - Ziel: Videozugriff folgt einer explizit dokumentierten Policy und kann AccessMode nicht unbemerkt umgehen.
  - Betroffene Dateien/Bereiche: apps/api/src/livekit/livekit.controller.ts; RobotAccessService; Metadaten-Accessmodell; Dashboard- und Raumtexte.
  - Konkreter Umsetzungshinweis: Einen gemeinsamen authorizeRobotCapability(robot, actor, capability=video) verwenden; Gastgrant/Passwort-/Allowlistnachweis für alle Modi prüfen; falls Video absichtlich unabhängig sein soll, eigenes Feld und eindeutige UI einführen.
  - Akzeptanzkriterium: Matrix aus PUBLIC/UNLISTED/PRIVATE × OPEN/PASSWORD/ALLOWED_USERS/LINK_ONLY × ALL/AUTHENTICATED/DISABLED ist automatisiert; kein Token ohne geforderten Nachweis.
  - Geschätzter Aufwand: mittel

- [x] **Stale Control Commands verwerfen und automatischen E-Stop erzwingen**
  - Umgesetzt und geprüft (18.07.2026): Zeitfenster, Clock-Skew, Command-Sequenz und Watchdog werden vor Buchung und Versand geprüft; Latenzüberschreitung erzeugt genau einen priorisierten Stop im Robot-Simulator-Test.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** MAX_CONTROL_COMMAND_AGE_MS und LATENCY_EMERGENCY_STOP_MS sind definiert, aber ungenutzt. Der Server sendet den Command vor der Latenzprüfung und warnt nur ab 200 ms.
  - Risiko/Auswirkung: Veraltete oder wiederaufgetauchte Bewegungsbefehle erreichen physische Hardware; dokumentierte Schutzwirkung existiert nicht.
  - Ziel: Server und Robot-Client akzeptieren nur frische, monotone Commands; Grenzwertüberschreitung löst einen idempotenten Stop aus.
  - Betroffene Dateien/Bereiche: packages/shared/constants; apps/api/src/gateway/control.handler.ts; E-Stop-Handler; Robot-Client-Protokoll/Dokumentation.
  - Konkreter Umsetzungshinweis: Server-seitige receiveAt-/Sequenzprüfung vor Buchung und Sendung; zukünftige Timestamps begrenzen; bei Schwelle Stop mit höherer Priorität senden; Robot-Client benötigt Watchdog/Dead-man-Switch unabhängig vom Browser.
  - Akzeptanzkriterium: Commands älter als 750 ms oder außerhalb erlaubter Clock-Skew werden nicht weitergeleitet/abgebucht; >300-ms-Szenario erzeugt genau einen Stop; Hardware-/Simulator-Test bestätigt Stillstand.
  - Geschätzter Aufwand: groß

- [x] **Bezahlte Controls mit Command-ID, Ack und Kompensation verbinden**
  - Umgesetzt und geprüft (18.07.2026): UUID, Pending-Command, ACK/NACK, Timeout, eindeutiger Ledgerbezug und idempotente Kompensation bilden einen durchgängigen Zustand; Offline-, Duplicate- und Retry-Fälle sind getestet.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** Wallettransfer erfolgt vor robotClient.send; send/Robot-Ausführung besitzt kein Ack und keine idempotente Command-ID. Cooldown wird vor Charge konsumiert.
  - Risiko/Auswirkung: Nutzer zahlen für nicht zugestellte Aktionen; Retries können doppelt buchen oder ausführen.
  - Ziel: Jede bezahlte Aktion hat einen nachvollziehbaren Zustand und wird genau einmal gebucht oder kompensiert.
  - Betroffene Dateien/Bereiche: ControlHandler; WalletService; WebSocket-Protokoll; Robot-Client; Transaction-Metadaten; UI.
  - Konkreter Umsetzungshinweis: UUID pro Press, PENDING-Reservierung, Robot ACK/NACK mit Timeout, eindeutiger Ledgerbezug; erst bei Ack finalisieren oder bei Fehler automatisch stornieren; Cooldown nur nach akzeptiertem Vorgang.
  - Akzeptanzkriterium: Offline, Socket-Close, NACK, Timeout, Duplicate und Retry sind getestet; Balance und Robot-Ausführung stimmen in jedem Fall; Nutzer sieht finalen Status.
  - Geschätzter Aufwand: groß

- [x] **Doppelte Pointer-/Click-Auslösung bei Controls und E-Stop entfernen**
  - Umgesetzt und geprüft (18.07.2026): Controls und E-Stop besitzen einen Pointerpfad mit Keyboard-Fallback und Command-ID-Deduplizierung; Pointer-, Touch-, Enter- und Space-Tests senden je Interaktion genau einen Befehl.
  - Priorität: P0
  - Kategorie: UX
  - Problem: **Gefunden.** Zusätzliche Control-Buttons sowie E-Stop-Flächen binden dieselbe Aktion an onPointerDown und onClick.
  - Risiko/Auswirkung: Ein physischer Klick kann zwei Commands, zwei Buchungen oder zwei Zustandswechsel auslösen.
  - Ziel: Pro Nutzerinteraktion genau ein Press; E-Stop bleibt sofortig und idempotent.
  - Betroffene Dateien/Bereiche: apps/web/src/components/robot-view/robot-view-main-column.tsx; robot-view-mobile-bar.tsx; Controls-Komponenten; Tests.
  - Konkreter Umsetzungshinweis: Einen Pointer-Eventpfad mit Keyboard-Fallback verwenden; synthetischen Click nicht zusätzlich senden; Command-ID-Deduplizierung ergänzen.
  - Akzeptanzkriterium: Pointer, Touch, Enter und Space erzeugen jeweils genau einen Network-Command; automatisierter Browser-Test zählt Nachrichten; E-Stop ist bei Wiederholung harmlos.
  - Geschätzter Aufwand: klein

- [x] **Webhook-SSRF gegen Redirects und DNS-Rebinding schließen**
  - Umgesetzt und geprüft (18.07.2026): Manuelle Redirectvalidierung, Hoplimit, DNS-Auflösung und gepinnte Ziel-IP blockieren private, link-local und gemappte Adressen sowie Rebinding; positive und negative Ketten sind getestet.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** DNS wird vor fetch geprüft; fetch folgt Redirects automatisch und bindet die geprüfte IP nicht an die Verbindung.
  - Risiko/Auswirkung: Host-Webhooks können interne Dienste, Cloud-Metadaten oder lokale Adminoberflächen erreichen.
  - Ziel: Jede Netzwerkverbindung geht ausschließlich zu erneut validierten öffentlichen Zielen.
  - Betroffene Dateien/Bereiche: apps/api/src/common/webhook-target.ts; apps/api/src/jobs/webhook.processor.ts; DNS-/HTTP-Client und Tests.
  - Konkreter Umsetzungshinweis: Redirects manuell mit kleinem Hoplimit behandeln und jedes Ziel neu validieren; aufgelöste IP für die Verbindung pinnen oder sicheren Egress-Proxy nutzen; IPv4/IPv6-Sonderbereiche vollständig testen; Responsebody nicht laden.
  - Akzeptanzkriterium: Redirect zu 127.0.0.1, RFC1918, link-local, IPv4-mapped IPv6 und DNS-Wechsel wird blockiert; öffentliche Redirectkette funktioniert bis zum Limit; Security-Tests sind grün.
  - Geschätzter Aufwand: groß

- [x] **Token-Logging entfernen und SMTP in Produktion verpflichtend machen**
  - Umgesetzt und geprüft (18.07.2026): Mail- und Authlogs enthalten keine Links oder Tokens; Produktionskonfiguration verlangt SMTP und verifiziert den Transport beim Boot, Zustellfehler werden klar und retrybar behandelt.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** Ohne SMTP werden vollständige Verifizierungs- und Reset-Links inklusive Token gewarnt; der Aufruf signalisiert dennoch Erfolg.
  - Risiko/Auswirkung: Logleser können Konten übernehmen; Nutzer erhalten keine Mail und glauben an erfolgreiche Zustellung.
  - Ziel: Keine Secrets in Logs; Produktion startet mit nutzbarem Mailpfad oder deaktiviert abhängige Flows explizit.
  - Betroffene Dateien/Bereiche: apps/api/src/mail/mail.service.ts; AuthService/Controller; Config-Validierung; Runbook.
  - Konkreter Umsetzungshinweis: Links nie loggen, höchstens korrelierbare Event-ID; SMTP_HOST/From und Transport-Verifikation beim Boot prüfen; Zustellfehler in retrybaren Status und Monitoring überführen.
  - Akzeptanzkriterium: Secret-Scanner findet keine Token in Testlogs; Produktionsboot ohne konfigurierte Mailstrategie schlägt fehl; Reset-/Verify-E2E bestätigt Zustellung oder klaren Fehler.
  - Geschätzter Aufwand: mittel

- [x] **Unsicheren Produktionsbootstrap ersetzen**
  - Umgesetzt und geprüft (18.07.2026): Setup trennt Entwicklung und Produktion, verlangt TLS-/Betreiberwerte, erzeugt keine bekannten Passwörter und gibt keine Credentials aus; unsichere Defaults brechen ab.
  - Priorität: P0
  - Kategorie: DevOps
  - Problem: **Gefunden.** setup-env.sh wählt HTTP als naheliegenden Standard, setzt NODE_ENV=production, nutzt admin123456 als Seed-Passwort und zeigt Demo-Credentials.
  - Risiko/Auswirkung: Öffentlich erreichbare Instanzen können mit bekannten Zugangsdaten oder ohne TLS starten.
  - Ziel: Produktion ist nur mit explizitem TLS-/Domain-/Secret-Setup und zufälligem oder extern bereitgestelltem Admin-Credential startbar.
  - Betroffene Dateien/Bereiche: scripts/setup-env.sh; Seed; .env.example; Compose; Installationsdokumentation.
  - Konkreter Umsetzungshinweis: Demo-Seeding strikt von Production trennen; keine Defaultpasswörter; zufälliges One-time-Secret oder Einladungsflow; HTTP nur expliziter Dev-Modus; Secrets nicht ausgeben.
  - Akzeptanzkriterium: Unbeaufsichtigter Production-Lauf mit Defaults bricht ab; kein bekanntes Credential im Repository/Output; TLS und Operatorwerte werden validiert.
  - Geschätzter Aufwand: mittel

- [x] **Hohe direkte Dependency-Advisories beheben**
  - Umgesetzt und geprüft (18.07.2026): Direkte Laufzeitpakete wurden auf gepatchte Linien aktualisiert, ungenutzte Pakete entfernt und transitive Sicherheitsversionen gepinnt; Produktions- und vollständiger `pnpm audit --audit-level low` melden keine bekannten Schwachstellen.
  - Priorität: P0
  - Kategorie: Security
  - Problem: **Gefunden.** Frischer Production-Audit: 44 hohe, 35 mittlere und 6 niedrige Advisories; direkte Pfade betreffen unter anderem Next, Fastify/Nest-Plattform, ws und Nodemailer.
  - Risiko/Auswirkung: Bekannte DoS-, SSRF-/Dateizugriffs-, Proxy-Bypass- und Crash-Schwächen bleiben im Produktionsgraph.
  - Ziel: Keine bekannte hohe/ kritische, für den Produktionsgraph relevante Schwachstelle ohne dokumentierte Ausnahme.
  - Betroffene Dateien/Bereiche: package.json-Dateien; pnpm-lock.yaml; ungenutztes @paypal/paypal-server-sdk; CI-Audit.
  - Konkreter Umsetzungshinweis: Direkte Pakete auf gepatchte kompatible Versionen aktualisieren, ungenutztes SDK entfernen, transitive Pfade mit pnpm why prüfen; offizielle Advisories und Breaking Changes beachten.
  - Akzeptanzkriterium: Frischer pnpm audit --prod meldet 0 kritisch und 0 unbehandelte hoch; Ausnahmen enthalten CVE/GHSA, Reachability, Owner und Ablaufdatum; Tests/Build sind grün.
  - Geschätzter Aufwand: groß

### 15.2 P1 – Aufgaben vor einem öffentlichen Release

- [ ] **GitHub-Workflows tatsächlich versionieren**
  - Technisch umgesetzt und lokal geprüft (18.07.2026): `.github` ist nicht mehr ignoriert; CI, CodeQL, Release und Restore-Drill sind mit minimalen Permissions und SHA-gepinnten Actions vorhanden. Externer Abnahmeblocker: Commit/Push, verpflichtende Branch-Protection und ein GitHub-PR-Lauf benötigen Repository-Zugriff.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** .gitignore schließt .github aus; git ls-files enthält die vorhandenen CI-, CodeQL- und Release-Dateien nicht.
  - Risiko/Auswirkung: Pull Requests und Releases haben keine reproduzierbaren Qualitäts-/Security-Gates.
  - Ziel: Workflows sind versioniert, reviewbar und auf geschützten Branches verpflichtend.
  - Betroffene Dateien/Bereiche: .gitignore; .github/workflows; Repository-Branch-Protection.
  - Konkreter Umsetzungshinweis: .github-Ausnahme entfernen, Dateien bewusst hinzufügen, minimale Permissions, Pinning und Environments/Secrets prüfen.
  - Akzeptanzkriterium: Frischer Checkout enthält alle Workflows; PR zeigt verpflichtende Checks; Workflow-Permissions folgen least privilege.
  - Geschätzter Aufwand: klein

- [ ] **CI-Kommandos, Coverage-Pfade und E2E-Projekt reparieren**
  - Technisch umgesetzt und lokal geprüft (18.07.2026): Chromium-Projekt, isolierte DB-/Redis-Fixtures, korrekte Coverageartefakte, Migrations-, OpenAPI-, Observability-, Queue-, Dev-Compose-, Build-, E2E- und Lighthouse-Gates sind integriert. Externer Abnahmeblocker: Der geforderte leere GitHub-Runner-Lauf benötigt einen gepushten Branch und Actions-Zugriff.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** --project=chromium referenziert kein Playwright-Projekt; API-Coverage-Pfad ist falsch; Filter sind uneinheitlich; E2E provisioniert keine API/Fixtures.
  - Risiko/Auswirkung: CI schlägt deterministisch fehl oder testet nicht den behaupteten Scope.
  - Ziel: Ein frischer Runner führt Lint, Typen, Unit/Coverage, Migration, Integration, E2E, Build und OpenAPI-Drift reproduzierbar aus.
  - Betroffene Dateien/Bereiche: .github/workflows/ci.yml; apps/web/playwright.config.ts; Test-Setup; Artifact-Pfade.
  - Konkreter Umsetzungshinweis: Benanntes chromium-Projekt definieren oder Parameter entfernen; apps/api/coverage hochladen; Postgres/Redis/API/Seed als E2E-Services starten; scoped Package-Namen verwenden.
  - Akzeptanzkriterium: CI ist auf leerem Cache grün; Artifact enthält beide Reports; Smoke-Test arbeitet mit deterministisch erzeugtem Robot-Fixture.
  - Geschätzter Aufwand: mittel

- [x] **Produktionsbuild als echtes Qualitätsgate konfigurieren**
  - Umgesetzt und geprüft (18.07.2026): Type-/Lint-Bypässe und Skip-ENV wurden entfernt; Lint, Typecheck und der optimierte Next-/API-Produktionsbuild laufen als harte Gates grün.
  - Priorität: P1
  - Kategorie: Codequalität
  - Problem: **Gefunden.** Next ignoriert ESLint- und TypeScript-Buildfehler; Docker setzt NEXT_SKIP_TYPECHECK.
  - Risiko/Auswirkung: Defekter oder unsicher typisierter Client kann als erfolgreiches Image veröffentlicht werden.
  - Ziel: Release-Build bricht bei Lint-/Typefehlern ab.
  - Betroffene Dateien/Bereiche: apps/web/next.config.ts; docker/web/Dockerfile; CI.
  - Konkreter Umsetzungshinweis: ignoreDuringBuilds/ignoreBuildErrors entfernen oder false setzen; explizite lint/typecheck-Jobs als Build-Abhängigkeit; keine Skip-ENV im Release-Image.
  - Akzeptanzkriterium: Absichtlich erzeugter Typ- oder Lintfehler macht CI/Image-Build rot; sauberer Stand ist grün.
  - Geschätzter Aufwand: klein

- [x] **Aktuell rote API- und Web-Tests reparieren**
  - Umgesetzt und geprüft (18.07.2026): Gateway- und Fokusfixtures, Jest-Lifecycle sowie die Browser-Smokes wurden repariert; API 65/65 Suites mit 608 Tests einschließlich aktiver Testcontainers-Integration, Web 33/33 Dateien mit 109 Tests und Chromium 21/21 laufen grün. Ein Test mit ausschließlich bedingungslos erfolgreichen Assertions wurde entfernt.
  - Priorität: P1
  - Kategorie: Codequalität
  - Problem: **Gefunden.** Gateway-Protokollsuite fehlt LivekitService und erzeugt vier Fehler; DashboardSidebar-Fokustest schlägt fehl.
  - Risiko/Auswirkung: Regressionen sind nicht von veraltetem Testsetup unterscheidbar; Release-Baseline ist rot.
  - Ziel: Alle Standard-Unit-Tests sind ohne Force-Exit-Folgeschäden grün.
  - Betroffene Dateien/Bereiche: apps/api/src/gateway/bot.gateway.protocol.spec.ts; Gateway-Konstruktorfixtures; dashboard-sidebar.tsx/test.tsx.
  - Konkreter Umsetzungshinweis: LivekitService-Mock ergänzen, afterEach nur bei initialisiertem Modul; Fokusreihenfolge anhand gewünschter UX korrigieren, nicht nur Erwartung blind ändern.
  - Akzeptanzkriterium: API 43/43 Suites ohne ungewollten Skip und Web 15/15 Dateien grün; Fokusverhalten zusätzlich im Browser bestätigt.
  - Geschätzter Aufwand: klein

- [x] **Jest offene Handles statt --forceExit beheben**
  - Umgesetzt und geprüft (18.07.2026): `--forceExit` ist entfernt, Ressourcen besitzen Teardown und Jest/ts-jest sind auf Major 29 ausgerichtet; drei vollständige Wiederholungen endeten ohne Handle-Warnung.
  - Priorität: P1
  - Kategorie: Codequalität
  - Problem: **Gefunden.** API-Scripts erzwingen --forceExit; Jest meldet mögliche offene Async-Operationen.
  - Risiko/Auswirkung: Leaks, laufende Timer, Redis-/Queue-Verbindungen und flaky Tests bleiben verborgen.
  - Ziel: Jest beendet nach sauberem Teardown selbstständig.
  - Betroffene Dateien/Bereiche: apps/api/package.json; Testmodule; Redis/BullMQ/Timer-Lifecycle.
  - Konkreter Umsetzungshinweis: Mit --detectOpenHandles isolieren; fake timers und onModuleDestroy konsequent verwenden; --forceExit entfernen; ts-jest nur auf TS matchen.
  - Akzeptanzkriterium: Gesamtlauf endet ohne Force Exit und Handle-Warnung in stabiler Zeit; drei Wiederholungen sind grün.
  - Geschätzter Aufwand: mittel

- [x] **Coverage risikobasiert anheben und kritische Pfade verpflichtend machen**
  - Umgesetzt und geprüft (18.07.2026): Globale API-/Web-Schwellen und ein separates 90-%-Gate je Metrik für acht Auth-, Finanz-, Control- und LiveKit-Dateien sind CI-pflichtig; beide Voll-Coverageläufe sind grün.
  - Priorität: P1
  - Kategorie: Codequalität
  - Problem: **Gefunden.** API liegt unter allen eigenen Schwellen; Web-Schwellen sind niedrig und große Hooks/Finanz-UI kaum getestet.
  - Risiko/Auswirkung: Kritische Fehler in Auth, Billing, Controls und UI-Orchestrierung werden spät entdeckt.
  - Ziel: Hohe Branch-Abdeckung für Geld, Zugriff und Safety; realistische globale Mindestwerte ohne künstliche Excludes.
  - Betroffene Dateien/Bereiche: Jest-/Vitest-Konfiguration; Billing/Wallet/Payout/Control/Auth/LiveKit; use-robot-view-state; Dashboard/Wallet/Pricing.
  - Konkreter Umsetzungshinweis: Zunächst Module-Schwellen für kritische Pfade festlegen; Concurrency/Failure-Tests ergänzen; danach globale Schwellen schrittweise erhöhen.
  - Akzeptanzkriterium: Kritische Services mindestens 90 % Branches, globale API/Web-Ziele im Team festgelegt und CI-grün; kein Coverage-Rückgang ohne Review.
  - Geschätzter Aufwand: groß

- [x] **REST-Access-Token gegen aktuellen Nutzerzustand validieren**
  - Umgesetzt und geprüft (18.07.2026): Die JWT-Strategie lädt Aktivstatus, `tokenVersion` und aktuelle Rolle aus der Datenbank; Deaktivierung, Rollenwechsel und Logout-all wirken auf den nächsten Request und sind getestet.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** JwtStrategy gibt den Payload unverändert zurück; isActive, tokenVersion und aktuelle Rolle werden nicht geladen.
  - Risiko/Auswirkung: Deaktivierte Nutzer und entzogene Rollen wirken bis Tokenablauf weiter; Logout-all ist für REST verzögert.
  - Ziel: Einheitliche sofortige oder klar definierte Revocation-Semantik für REST und WS.
  - Betroffene Dateien/Bereiche: apps/api/src/auth/strategies/jwt.strategy.ts; AuthService; Cache/DB; Tests.
  - Konkreter Umsetzungshinweis: Tokenstatus zentral prüfen, optional kurz gecacht und bei Änderungen invalidiert; Rolle aus vertrauenswürdigem aktuellem Zustand beziehen; TTL/Performance messen.
  - Akzeptanzkriterium: Deaktivierung, Rollenentzug und logout-all sperren den nächsten geschützten Request und WS-Revalidate innerhalb des definierten SLO.
  - Geschätzter Aufwand: mittel

- [x] **CSRF-Schutz für alle cookie-authentifizierten Mutationen zentralisieren**
  - Umgesetzt und geprüft (18.07.2026): Ein globaler Guard verlangt bei Cookie-Mutationen konfigurierte Origin/Referer plus Double-Submit-Token, lässt Bearer-Clients zu und verbietet SameSite=None ohne Secure; die geforderte Controller-Matrix ist grün.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** Access-Cookie wird global akzeptiert, CsrfOriginGuard liegt nur auf Auth-Mutationen.
  - Risiko/Auswirkung: Cookie-Policy-Änderungen oder Browser-/Integrationsvarianten können übrige Mutationen CSRF-anfällig machen.
  - Ziel: Browser-Cookieauthentifizierung erfordert bei jeder Mutation Origin plus Token; Bearer-Clients bleiben klar unterstützt.
  - Betroffene Dateien/Bereiche: globale Guards/Middleware; Auth cookies; alle Controller; Web API Client.
  - Konkreter Umsetzungshinweis: Zentral zwischen Bearer und Cookie unterscheiden; Guard global für unsafe methods; SameSite=None nur mit Secure und HTTPS erlauben.
  - Akzeptanzkriterium: Negative CSRF-Tests für Robot, Queue, Wallet, Payout, Users, Controls und Moderation; Bearer-only Requests funktionieren gemäß Dokumentation.
  - Geschätzter Aufwand: mittel

- [x] **Robot- und LiveKit-Tokens widerrufbar und kurzlebiger machen**
  - Umgesetzt und geprüft (18.07.2026): Device-/Tokenversion, kurze capability-spezifische TTLs, Turnbindung und LiveKit-Grantentzug bei Handoff/Ende wurden integriert; Claim-Rotation und Revocation-Matrix sind getestet.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** Robot-Publisher 24 h, Viewer/Controller 4 h, Robot-Auth bis 30 Tage; Queue-/Claim-Änderung widerruft Grants nicht.
  - Risiko/Auswirkung: Ehemalige Controller oder kompromittierte Geräte behalten Zugriff.
  - Ziel: Capability-Tokens sind kurzlebig, an Turn/Device-Version gebunden und widerrufbar.
  - Betroffene Dateien/Bereiche: LivekitService/Controller; RobotDeviceService; Prisma Robot/Device-Felder; Gateway.
  - Konkreter Umsetzungshinweis: tokenVersion/deviceVersion, kurze Controller-TTL, Turn-ID im Grant, LiveKit participant removal/grant update bei Handoff; Robotrotation dokumentieren.
  - Akzeptanzkriterium: Turnende entzieht Data-Publish binnen definiertem SLO; Claim-Reset sperrt altes Robot-JWT; Revocation-E2E ist grün.
  - Geschätzter Aufwand: groß

- [x] **Webhook-Secrets mit AEAD und Versionierung schützen**
  - Umgesetzt und geprüft (18.07.2026): Versioniertes AES-256-GCM mit zufälligem Nonce, Key-ID und AAD ersetzt XOR/Klartext; Manipulation, Nichtdeterminismus, Rotation und Migrationsskript sind getestet.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** Deterministisches XOR/HMAC-Keystream ohne Authentizität; Legacy-Klartext wird akzeptiert.
  - Risiko/Auswirkung: Manipulation bleibt unentdeckt; Datenbank- plus App-Key-Zugriff legt alle Secrets offen; Rotation ist nicht sauber möglich.
  - Ziel: Versionierte, authentifizierte Verschlüsselung und kontrollierte Migration.
  - Betroffene Dateien/Bereiche: RobotWebhookService; jobs/webhook.processor.ts; Schema; Secret-Konfiguration.
  - Konkreter Umsetzungshinweis: AES-256-GCM oder XChaCha20-Poly1305 mit zufälligem Nonce, Key-ID und AAD webhookId; Lazy-/Batch-Migration; Legacypfad nach Frist entfernen.
  - Akzeptanzkriterium: Ciphertext-Manipulation schlägt fehl; gleiche Secrets erzeugen verschiedene Ciphertexte; Keyrotation ohne Ausfall getestet; kein Klartextformat neu speicherbar.
  - Geschätzter Aufwand: mittel

- [x] **E-Mail-Verifizierungs-, Claim- und Stream-Secrets nicht im Klartext speichern**
  - Umgesetzt und geprüft (18.07.2026): Einmaltokens und Gerätezugang werden nur gehasht verglichen, langlebige Streamdaten sind versioniert verschlüsselt und rotierbar; Flow- und Rotationstests sind grün.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** emailVerificationToken, streamKey und claimToken stehen als direkt nutzbare Werte in PostgreSQL.
  - Risiko/Auswirkung: Datenbanklesezugriff ermöglicht Accountverifizierung oder Robotübernahme.
  - Ziel: Nur gehashte Einmal-Tokens; langlebige Schlüssel verschlüsselt oder ersetzbar.
  - Betroffene Dateien/Bereiche: Prisma User/Robot; AuthService; RobotDeviceService; Dashboard-Secretanzeige.
  - Konkreter Umsetzungshinweis: Verifizierung/Claim mit SHA-256/HMAC-Hash und Constant-time-Vergleich; Stream-Key envelope-encrypted oder aus kurzlebigem Credentialflow ersetzen; Rotation/Ablauf.
  - Akzeptanzkriterium: DB-Dump enthält keine direkt verwendbaren Tokens; Altwerte migriert/rotiert; alle Flows und Rotationen getestet.
  - Geschätzter Aufwand: groß

- [ ] **Finanzdaten bei Kontolöschung erhalten und Nutzer anonymisieren**
  - Technisch umgesetzt und geprüft (18.07.2026): Accountlöschung deaktiviert Login und anonymisiert Profil/öffentliche Inhalte, während Ledger-, Billing- und Payoutrelationen mit pseudonymer Actor-ID und balanciertem Ledger erhalten bleiben. Staff-Änderungen und -Löschungen sperren Akteur und Ziel deterministisch, validieren die aktuelle aktive Adminrolle in der Transaktion und schreiben Profil-/Balance-/Ledgeränderungen atomar; anonymisierte Konten sind nicht reaktivierbar. Externer Abnahmeblocker: Die verbindliche gesetzliche Aufbewahrungsdauer und Rechtsgrundlage müssen vom Betreiber juristisch freigegeben werden.
  - Priorität: P1
  - Kategorie: Compliance
  - Problem: **Gefunden.** User-Hard-Delete kaskadiert Ledger, BillingIntents, Payouts und Idempotency-Daten.
  - Risiko/Auswirkung: Buchhaltung, Streitfallnachweis und Betrugsaudit werden gelöscht; Ledger-Invarianten brechen.
  - Ziel: Personenbezug minimieren, finanzielle Pflicht-/Auditdaten unveränderlich erhalten.
  - Betroffene Dateien/Bereiche: Prisma-Relationen; UsersService.deleteOwnAccount/admin delete; Privacy/Terms; Retentionjobs.
  - Konkreter Umsetzungshinweis: Anonymisierungszustand statt Hard Delete, pseudonyme immutable Actor-ID, separate PII-Tabelle/Deletion; Rechts-/Retention-Matrix mit Owner festlegen.
  - Akzeptanzkriterium: Löschung entfernt Login/Profil und öffentliche Inhalte, erhält notwendige Finanzsummen ohne direkte PII; Ledger bleibt balanciert; Rechtsprüfung dokumentiert.
  - Geschätzter Aufwand: groß

- [x] **Schema-/Migrationsdrift bei AdminAuditLog beheben**
  - Umgesetzt und geprüft (18.07.2026): Vorwärtsmigration ergänzt `expiresAt`, Backfill und Index; Fresh-/Upgrade-Driftchecks sowie Cleanup-Tests für fällige und nicht fällige Einträge sind grün.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** Schema und Cleanup erwarten expiresAt plus Index; die Migration erzeugt beides nicht.
  - Risiko/Auswirkung: Cleanup kann gegen reale Datenbanken fehlschlagen; Retentionversprechen wird nicht eingehalten.
  - Ziel: Jede unterstützte Datenbank entspricht dem Prisma-Schema und löscht Auditlogs nach dokumentierter Policy.
  - Betroffene Dateien/Bereiche: Prisma-Migrationen/Schema; MaintenanceService; Retentiondokumentation.
  - Konkreter Umsetzungshinweis: Vorwärtsmigration für Spalte, Default, Backfill und Index; nicht alte Migration editieren; Driftcheck auf repräsentativem Altstand.
  - Akzeptanzkriterium: prisma migrate diff leer; Cleanup-Test löscht fällige und behält nicht fällige Logs; Fresh-/Upgrade-DB grün.
  - Geschätzter Aufwand: mittel

- [x] **Seed pro Entität idempotent und partiell reparierbar machen**
  - Umgesetzt und geprüft (18.07.2026): System- und Demoseed sind getrennt und upserten Pflichtentitäten einzeln; leere, vollständige und partielle Datenbanken konvergierten, Production-Demoseed wird abgewiesen.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** packages/prisma/prisma/seed.ts beendet sich, sobald irgendeines der geprüften Modelle Daten enthält. Eine teilweise initialisierte Datenbank erhält dadurch unter anderem keinen fehlenden Plattformnutzer oder Admin.
  - Risiko/Auswirkung: Boot und Plattformgebühren können nach Teilimport/abgebrochenem Seed in einem inkonsistenten Zustand bleiben.
  - Ziel: Erforderliche Systemdatensätze werden einzeln und sicher upserted; Demo-Daten bleiben strikt optional.
  - Betroffene Dateien/Bereiche: packages/prisma/prisma/seed.ts; PlatformUser-Service; API-Entrypoint; Setup-Dokumentation.
  - Konkreter Umsetzungshinweis: Systemseed und Demoseed trennen; feste IDs/Keys per upsert; bestehende Nutzerdaten nie überschreiben; fehlende Pflichtentitäten beim Boot klar melden.
  - Akzeptanzkriterium: Seed auf leerer, vollständiger und absichtlich partieller DB konvergiert zum gleichen Systemzustand; Demo-Credentials entstehen nie in Production.
  - Geschätzter Aufwand: mittel

- [x] **Rechtliche Pflichtkonfiguration als Deployment-Gate behandeln**
  - Umgesetzt und geprüft (18.07.2026): Public-Production-Builds validieren vollständige Betreiber-, Länder-, E-Mail-, URL- und Rechtsangaben fail-fast; der geprüfte Build enthält keine Platzhalter.
  - Priorität: P1
  - Kategorie: Compliance
  - Problem: **Gefunden.** Fehlende Operatorwerte führen zu Platzhaltern und legal@localhost.invalid im öffentlichen Produkt.
  - Risiko/Auswirkung: Impressum/Datenschutz sind unvollständig; Vertrauen und mögliche gesetzliche Pflichten werden verletzt.
  - Ziel: Public/Production startet oder baut nur mit vollständigen, plausiblen Betreiberwerten.
  - Betroffene Dateien/Bereiche: apps/web/src/lib/legal.ts; Build-/Runtime-Konfigvalidation; Compose; Deploymentcheck.
  - Konkreter Umsetzungshinweis: NODE_ENV/APP_ENV-abhängiges fail-fast; E-Mail/URL/Land validieren; Secrets und Public Buildtime-Werte trennen.
  - Akzeptanzkriterium: Production-Build/Startup ohne Pflichtfelder schlägt klar fehl; öffentliche Seiten enthalten keine Platzhalter.
  - Geschätzter Aufwand: klein

- [ ] **Rechtstexte und Checkout-Einwilligungen finalisieren**
  - Technisch umgesetzt und geprüft (18.07.2026): Sichtbare Template-/Konfigurationshinweise wurden entfernt, Policies versioniert, Links vereinheitlicht und die Sofortlieferungs-/Terms-Einwilligung wird mit der Billingabsicht nachweisbar gespeichert. Externer Abnahmeblocker: Die rechtliche Wirksamkeit und Betreiberfassung erfordern eine juristische Prüfung.
  - Priorität: P1
  - Kategorie: Compliance
  - Problem: **Gefunden.** Sichtbare Seiten bezeichnen sich als Template, enthalten vorgeschlagene Texte und stimmen nicht vollständig mit Export/Deletion/Refund überein.
  - Risiko/Auswirkung: Unklare Vertragslage und falsche Datenschutz-/Refund-Erwartungen.
  - Ziel: Betreiberbezogene, geprüfte Texte entsprechen exakt dem aktivierten Funktionsumfang.
  - Betroffene Dateien/Bereiche: imprint/privacy/cookies/terms; Login/Register; Pricing/Wallet/Checkout; Produktkonfiguration.
  - Konkreter Umsetzungshinweis: Juristische Prüfung beauftragen; Version/Datum, akzeptierte Fassung und Links bei Registrierung/Checkout speichern; EU-Sofortlieferung nur bei rechtlicher Erforderlichkeit korrekt erfassen.
  - Akzeptanzkriterium: Keine Template-/Konfigurationshinweise sichtbar; Terms/Privacy verlinkt; notwendige Zustimmung nachweisbar; Claims spiegeln Tests und Retention.
  - Geschätzter Aufwand: groß

- [x] **Nicht belegte Safety-, Refund- und Subscriptionclaims entfernen**
  - Umgesetzt und geprüft (18.07.2026): Nicht belegte Latenz-, Refund- und Subscriptionversprechen wurden entfernt; sichtbare Verfügbarkeit folgt Feature-Flags und verbleibende Aussagen verweisen auf Tests oder dokumentierte Grenzen.
  - Priorität: P1
  - Kategorie: Produkt
  - Problem: **Gefunden.** README/Produkttexte versprechen automatischen E-Stop über 300 ms, automatische Credit-Umkehr bei Refund/Chargeback und Kündigung im Account; diese Fähigkeiten sind im aktuellen Code nicht durchgängig vorhanden.
  - Risiko/Auswirkung: Nutzer treffen Sicherheits- und Kaufentscheidungen aufgrund falscher Zusagen.
  - Ziel: Sichttext beschreibt nur nachweislich aktive Fähigkeiten und bekannte Grenzen.
  - Betroffene Dateien/Bereiche: README; Landing; Pricing; Wallet; Terms; Room-Onboarding; Docs.
  - Konkreter Umsetzungshinweis: Claims bis zur Implementierung streichen oder präzise einschränken; danach aus automatisierten Safety-/Billing-Abnahmetests und Feature Flags ableiten.
  - Akzeptanzkriterium: Claim-Inventar ist einem Test oder einer dokumentierten Grenze zugeordnet; deaktivierte Features werden nirgends als verfügbar beworben.
  - Geschätzter Aufwand: klein

- [ ] **Cookie-/Storage-Inventar und echte Kategorieentscheidung herstellen**
  - Technisch umgesetzt und geprüft (18.07.2026): Das wirkungslose Banner wurde entfernt, notwendige Cookie-/Storage-Keys, Zweck und Lebensdauer dokumentiert und Analytics-Consent technisch durchgesetzt. Externer Abnahmeblocker: Rechtsgrundlage und endgültige Kategorisierung müssen juristisch bestätigt werden.
  - Priorität: P1
  - Kategorie: Compliance
  - Problem: **Gefunden.** Banner-Accept/Decline ändert nur einen Preferencewert; funktionale Speicherungen laufen weiter; Notice nennt keine exakten Keys/Laufzeiten.
  - Risiko/Auswirkung: Nutzerentscheidung ist missverständlich; Dokumentation deckt Browserdaten nicht ausreichend ab.
  - Ziel: Entweder nur technisch notwendiger Storage mit korrekter Information oder echte Einwilligungssteuerung für optionale Kategorien.
  - Betroffene Dateien/Bereiche: cookie-banner.tsx; preferences/store; Chat-/Room-/LiveKit-localStorage; Cookie Notice; Analytics.
  - Konkreter Umsetzungshinweis: Inventar mit Name, Zweck, Lebensdauer, Anbieter, Rechtsgrundlage; optionale Writes vor Consent blockieren; unnötiges Banner entfernen, falls keine Einwilligung nötig und rechtlich bestätigt.
  - Akzeptanzkriterium: Decline verhindert jede als optional klassifizierte Speicherung; Notice stimmt per automatisiertem Storage-Snapshot; Rechtsprüfung dokumentiert.
  - Geschätzter Aufwand: mittel

- [x] **Defekte Host-Onboarding-Links und Robot-Anlage reparieren**
  - Umgesetzt und geprüft (18.07.2026): `/dashboard/robots/new` leitet gezielt auf den fokussierten Anlagebereich, der Auth-Refresh wartet vor geschützten Redirects, und der Chromium-E2E legt einen privaten Robot an und zeigt Claim-Token sowie verbindliche Go-live-Checks.
  - Priorität: P1
  - Kategorie: UX
  - Problem: **Gefunden.** Zwei CTAs führen auf /dashboard/robots/new, aber nur /dashboard/page.tsx existiert.
  - Risiko/Auswirkung: Der wichtigste Conversion-Flow endet mit 404.
  - Ziel: Nutzer gelangen direkt in einen funktionierenden Robot-Anlageflow.
  - Betroffene Dateien/Bereiche: Explore-Onboarding/Empty-State; Dashboard-Routing; Robot-Create-UI.
  - Konkreter Umsetzungshinweis: Entweder Route implementieren oder CTAs auf vorhandenen Dashboard-Create-Zustand mit eindeutigem Fokus verlinken.
  - Akzeptanzkriterium: Beide CTAs öffnen den Anlageflow ohne Redirectschleife/404; E2E erstellt einen Robot und zeigt nächste Schritte.
  - Geschätzter Aufwand: mittel

- [x] **Falsches de-Routing korrigieren**
  - Umgesetzt und geprüft (18.07.2026): Das nicht übersetzte `/de`-Routing wurde entfernt; Sprache, Canonical und Sitemap liefern nur die tatsächlich vorhandene englische Fassung aus.
  - Priorität: P1
  - Kategorie: UX
  - Problem: **Gefunden.** /de setzt Deutsch als Dokumentsprache, zeigt aber englischen Inhalt; LocaleSwitcher ist auskommentiert.
  - Risiko/Auswirkung: Falsche Screenreader-Aussprache, SEO-Duplikate und enttäuschte Nutzer.
  - Ziel: Entweder echte vollständige de/en-Lokalisierung oder nur die tatsächlich vorhandene Sprache ausliefern.
  - Betroffene Dateien/Bereiche: middleware; use-locale; Nav; alle sichtbaren Seiten/Komponenten; Metadata.
  - Konkreter Umsetzungshinweis: Kurzfristig de-Routing entfernen oder lang=en; langfristig Message-Katalog, Übersetzungscoverage und sichtbaren Switcher einführen.
  - Akzeptanzkriterium: Jede indexierbare Route hat korrekte lang-/canonical-/hreflang-Werte; keine gemischten Kerntexte; Sprachumschaltung E2E getestet.
  - Geschätzter Aufwand: groß

- [x] **Tab-Tastaturfalle im Robot-Raum entfernen**
  - Umgesetzt und geprüft (18.07.2026): Tab behält seine Browsersemantik, Moduswechsel haben eigene Schaltflächen und Bewegungstasten greifen nicht in Eingabefeldern; der Chromium-Fokuspfad bestätigt fortlaufende, unterschiedliche Fokusziele.
  - Priorität: P1
  - Kategorie: UX
  - Problem: **Gefunden.** Globaler keydown verhindert Tab und schaltet FocusMode, statt Browserfokus weiterzugeben.
  - Risiko/Auswirkung: Tastaturnutzer erreichen Navigation, Controls, Queue, Donate und weitere Elemente nicht zuverlässig.
  - Ziel: Standard-Tabreihenfolge bleibt erhalten; Control-/Chatmodus nutzt separate, dokumentierte Shortcuts.
  - Betroffene Dateien/Bereiche: use-robot-view-state.ts; Room-Onboarding; Keyboard-Hilfe; Accessibility-Tests.
  - Konkreter Umsetzungshinweis: Tab nie global preventDefault; optional Alt-/Ctrl-Shortcut oder sichtbarer Toggle; Eingabefelder und Screenreader nicht abfangen.
  - Akzeptanzkriterium: Vollständiger Raum ist nur per Tastatur bedienbar; Axe plus Playwright-Fokuspfad grün; keine Standardtaste startet unerwartet Bewegung.
  - Geschätzter Aufwand: mittel

- [x] **Dialoge und pointer-only Controls barrierefrei machen**
  - Umgesetzt und geprüft (18.07.2026): Der gemeinsame Dialog besitzt Namen/Beschreibung, inert-Hintergrund, Scrollsperre, Fokusfalle, Escape und Fokusrückgabe; Iconbuttons sind benannt und XY-/Drag-Controls besitzen Pfeiltasten-/Home-Alternativen. Komponenten-, Axe- und Chromium-Tests sind grün.
  - Priorität: P1
  - Kategorie: UX
  - Problem: **Gefunden.** Kein Focus Trap/Escape/Restore; Donation-X ohne Label; XY/drag Panels ohne gleichwertige Tastaturbedienung.
  - Risiko/Auswirkung: Screenreader- und Tastaturnutzer verlieren Kontext oder können Funktionen nicht nutzen.
  - Ziel: WCAG-2.2-AA-taugliche Dialog- und Control-Grundbausteine.
  - Betroffene Dateien/Bereiche: ui/dialog.tsx; donation-dialog.tsx; Controls/XY; video-renderer.tsx; Tests.
  - Konkreter Umsetzungshinweis: Gemeinsamen Dialog mit labelledby, Fokusmanagement, Escape und Hintergrund-inert; XY über Buttons/Arrow Keys oder alternative Controls; Dragpanels resetbar per Tastatur.
  - Akzeptanzkriterium: Keyboard-/Screenreader-Test für Öffnen, Bedienen, Schließen und Fokusrückgabe; alle Iconbuttons haben Namen; keine serious/critical Axe-Verstöße.
  - Geschätzter Aufwand: groß

- [x] **Queue-Anzeige ausschließlich aus bestätigtem Sessionzustand ableiten**
  - Umgesetzt und geprüft (18.07.2026): Controllerlabel, Freigabe und Countdown verwenden ausschließlich serverbestätigte Session-/Turn-IDs; Handoff-, Delay- und Reconnectzustände sind getestet.
  - Priorität: P1
  - Kategorie: UX
  - Problem: **Gefunden.** activeSession wird im QueuePanel ignoriert; Position 1 wird immer „Controlling“ und teilweise clientseitig als eigener Turn interpretiert.
  - Risiko/Auswirkung: Nutzer glauben, Kontrolle zu haben, obwohl der Server noch keinen Turn gestartet hat.
  - Ziel: „Controlling“, Controls-Freigabe und Countdown entsprechen derselben serverautoritativen Turn-ID.
  - Betroffene Dateien/Bereiche: queue-panel.tsx; use-robot-view-state.ts; Turn-WebSocketevents; Tests.
  - Konkreter Umsetzungshinweis: ActiveSession/turnId als einzige Quelle; Zwischenzustand „Next“/„Starting“; Reconnect holt Snapshot; Queuehead nicht mit Controller gleichsetzen.
  - Akzeptanzkriterium: Handoff-, Delay-, Reconnect- und Cross-Instance-Tests zeigen nie vorzeitig freigegebene Controls oder falsches Label.
  - Geschätzter Aufwand: mittel

- [x] **Mehrinstanz-Startup darf fremde aktive Sessions nicht beenden**
  - Umgesetzt und geprüft (18.07.2026): Startup-Reconciliation beendet nur Sessions mit abgelaufener Owner-Lease; Zwei-Instanz- und Owner-Kill-Tests belegen Erhalt beziehungsweise einmaliges Recovery.
  - Priorität: P1
  - Kategorie: Codequalität
  - Problem: **Gefunden.** Jeder Gateway-Modulstart ruft global endAllActiveSessions auf.
  - Risiko/Auswirkung: Rolling Deploy oder Skalierung beendet laufende Turns einer anderen Replik.
  - Ziel: Nur nachweislich verwaiste Sessions werden durch Lease/Heartbeat reconciled.
  - Betroffene Dateien/Bereiche: bot.gateway.runtime.ts; SessionsService; ActiveTurnStore; Prisma Session; Redis.
  - Konkreter Umsetzungshinweis: Instance-/leaseId und Heartbeat persistieren; Reconciliation nur nach abgelaufener Lease; Ownership-CAS bei end/clear.
  - Akzeptanzkriterium: Start einer zweiten Replik lässt aktive Session unverändert; Kill des Owners wird nach definiertem Timeout genau einmal reconciled.
  - Geschätzter Aufwand: groß

- [x] **Active-Turn-Ownership und Timer-Failover atomar machen**
  - Umgesetzt und geprüft (18.07.2026): Redis-Leases, monotone Fencing-Tokens, Compare-and-Delete/Update und Recoveryworker ersetzen ungeschützte lokale Ownership; Race-/Failover-Tests und ADR sind synchron.
  - Priorität: P1
  - Kategorie: Codequalität
  - Problem: **Gefunden/Risiko.** clear löscht Rediszustand ohne Owner-Vergleich; Timer sind lokal und ADR/Code divergieren.
  - Risiko/Auswirkung: Alte Instanz kann neuen Turn löschen oder doppelte Handoffs auslösen.
  - Ziel: Lease-basierte Turn-State-Machine mit eindeutiger Ownership und Fencing Token.
  - Betroffene Dateien/Bereiche: active-turn.store.ts; turn.handler.ts; Redis Lua; ADR 0006.
  - Konkreter Umsetzungshinweis: Monotones fencingToken, compare-and-delete/update, erneuerbare Lease, Recoveryworker statt unkoordinierter lokaler Timer.
  - Akzeptanzkriterium: Race-/Failover-Test mit zwei Instanzen beweist höchstens einen Owner und einen Session-Endevent; alte Fencing Tokens werden verworfen.
  - Geschätzter Aufwand: groß

- [x] **Recording eindeutig einer Session zuordnen**
  - Umgesetzt und geprüft (18.07.2026): Persistente Recordingrelation und Object-Key mit Session-/Robot-/Kamera-ID ersetzen Zeitfensterheuristik; Berechtigungs- und Nachbarsessiontests sind grün.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** Replay-Kandidaten entstehen per Robot-ID und breitem Zeitfenster aus einem vollständigen Bucket-Scan.
  - Risiko/Auswirkung: Falsche oder fremde Aufnahme kann einem berechtigten Sessionnutzer angeboten werden.
  - Ziel: Jede Aufnahme referenziert exakt Session, Robot, Kamera und Zeitraum.
  - Betroffene Dateien/Bereiche: LiveKit-Recordingstart; Session.recordingUrl/Metadaten; RecordingAdminService; Object-Key-Template; Migration.
  - Konkreter Umsetzungshinweis: sessionId in Egress-Metadaten/Object-Key und Recording-Tabelle; Wiedergabe nur über Relation, keine heuristische Berechtigung; Backfill als Prüfpunkt.
  - Akzeptanzkriterium: Sessiondetail liefert ausschließlich verknüpfte Recordings; benachbarte Sessions desselben Robots bleiben isoliert; Zugriffsmatrix getestet.
  - Geschätzter Aufwand: groß

- [x] **Dev-Compose wieder baubar und startbar machen**
  - Umgesetzt und geprüft (18.07.2026): Echte API-/Web-Dev-Stages, gemeinsame File-Secret-Auflösung, Source-Mounts und ein isolierter Smoke sind integriert; beide Images bauen, alle zwölf Migrationen plus Seed laufen, PostgreSQL/Redis/LiveKit/API/Web werden gesund und echte temporäre Codeänderungen lösen API- sowie Web-Reload aus.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** target dev fehlt in beiden Dockerfiles; API start:dev fehlt; Standalone-Nutzung sucht falsches Dockerfile.
  - Risiko/Auswirkung: Dokumentierter Onboardingpfad funktioniert nicht.
  - Ziel: Ein dokumentierter Befehl startet reproduzierbar Hot-Reload-API und Web.
  - Betroffene Dateien/Bereiche: docker-compose.dev.yml; docker/api/Dockerfile; docker/web/Dockerfile; package scripts; README.
  - Konkreter Umsetzungshinweis: Echte dev-Stages oder separate Dev-Dockerfiles; korrekte scoped Scripts; Volumes/Dependencies prüfen; Merge-Befehl als Integrationstest.
  - Akzeptanzkriterium: Frischer Checkout startet mit dokumentiertem Command; API/Web erreichbar; Codeänderung triggert Reload; Healthchecks grün.
  - Geschätzter Aufwand: mittel

- [x] **Next-Public-ENV zur Buildzeit korrekt injizieren**
  - Umgesetzt und geprüft (18.07.2026): Alle öffentlichen URLs, Legalwerte, Imagehosts und Flags sind Docker-Build-Args vor `next build`; Pflichtwertvalidierung und Bundle-Smoke sind grün.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefundenes Konfigurationsrisiko.** Compose setzt NEXT_PUBLIC_API_URL, WS, LiveKit und Legalwerte im Runtime-Container; Clientwerte werden von Next überwiegend beim Build eingebettet.
  - Risiko/Auswirkung: Produktionsbundle ruft falsche Hosts auf oder enthält Platzhalter.
  - Ziel: Ein Image hat klar definierte Buildtime-Konfiguration oder nutzt eine sichere Runtime-Config-Schicht.
  - Betroffene Dateien/Bereiche: docker/web/Dockerfile; docker-compose.yml; Next config; Releaseworkflow.
  - Konkreter Umsetzungshinweis: ARG/ENV vor next build für alle Publicwerte oder runtime config endpoint; Image pro Environment eindeutig taggen; keine Secrets als NEXT_PUBLIC.
  - Akzeptanzkriterium: Gebautes Bundle enthält die erwarteten URLs/Operatorwerte; Staging/Prod-Smoke prüft effektive Config; falsche Pflichtwerte brechen Build.
  - Geschätzter Aufwand: mittel

- [x] **Produktions-ENV und Compose-Parität herstellen**
  - Umgesetzt und geprüft (18.07.2026): Zod-Umgebungsschema, `.env.example`, Setup und Compose sind abgeglichen; Featuregruppen validieren vollständig und der reine File-Secret-Smoke startet PostgreSQL, Redis, MinIO und LiveKit-Konfiguration.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** Code, .env.example, setup wizard und Compose führen unterschiedliche Variablen; Subscriptionflag fehlt besonders kritisch. Mehrere direkte Secretvariablen werden per Compose-Substitution verlangt, obwohl zugleich \*\_FILE gesetzt wird.
  - Risiko/Auswirkung: Features aktivieren sich unbeabsichtigt, Observability/Recording/Billing startet halb konfiguriert oder ein eigentlich gültiger reiner Docker-Secret-Start scheitert vor dem Containerboot.
  - Ziel: Eine typisierte zentrale Env-Spezifikation treibt Validierung, Beispiel und Deployment; jedes Secret besitzt genau definierte direkte- oder file-basierte Quellen.
  - Betroffene Dateien/Bereiche: API ConfigModule; .env.example; docker-compose.yml; setup-env.sh; Web-Config.
  - Konkreter Umsetzungshinweis: Zod-/Joi-Env-Schema mit Defaults nur für Dev; automatische Doku-/Parity-Prüfung; optionale Featuregruppen vollständig validieren.
  - Akzeptanzkriterium: CI vergleicht verwendete und dokumentierte Variablen; Productionboot ist bei halber Provider-/Recording-Konfiguration rot; Flags defaulten sicher; Compose startet nachweislich mit ausschließlich file-basierten Secrets.
  - Geschätzter Aufwand: groß

- [x] **Nginx-Healthcheck, WebSocket-IP und Header konsolidieren**
  - Umgesetzt und geprüft (18.07.2026): HTTP/TLS-Probes, Trusted-Proxy/XFF für REST und WS sowie eine widerspruchsfreie Headerquelle wurden vereinheitlicht; Composeprofile und Headertests sind grün. Der TLS-Container wurde zusätzlich als UID 101, read-only und ohne Capabilities mit gruppenbeschränktem `0640`-Schlüssel praktisch gestartet.
  - Priorität: P1
  - Kategorie: DevOps
  - Problem: **Gefunden.** HTTP-Config wird per HTTPS geprüft; /ws setzt kein X-Forwarded-For; Security-Header widersprechen sich.
  - Risiko/Auswirkung: Falscher Healthstatus, kollabierte Rate Limits und unklare Browserpolicy.
  - Ziel: Proxychecks entsprechen aktiver Config; Client-IP nur aus Trusted Proxy; eine effektive Headerquelle.
  - Betroffene Dateien/Bereiche: docker/nginx/nginx.conf; nginx.ssl.conf.template; Compose healthcheck; Fastify trustProxy; Next headers.
  - Konkreter Umsetzungshinweis: Separate HTTP/HTTPS-Probes; XFF/Forwarded im WS-Block; bekannte Proxy-Netze konfigurieren; Frame/CSP/HSTS/Referrer zentral testen.
  - Akzeptanzkriterium: HTTP- und TLS-Profile werden gesund; zwei Clients erhalten getrennte IP-Limits; Header-Snapshot enthält keine widersprüchlichen Duplikate.
  - Geschätzter Aufwand: mittel

- [x] **Redis-Eviction für kritischen Zustand ausschließen**
  - Umgesetzt und geprüft (18.07.2026): Redis nutzt `noeviction`, kritische Services behandeln OOM fail-safe und Memory-/Eviction-Alerts mit Runbook wurden ergänzt; Regel- und Konfigurationssimulation sind grün.
  - Priorität: P1
  - Kategorie: Performance
  - Problem: **Gefunden.** allkeys-lru darf Queue-, Turn-, Lock-, Grant- und Idempotenzschlüssel verdrängen.
  - Risiko/Auswirkung: Autorisierung, Queuefairness und Exactly-once-Eigenschaften brechen unter Druck.
  - Ziel: Kritischer Redis-Zustand wird nicht still evicted; Speicherdruck löst Alarm/fail-safe aus.
  - Betroffene Dateien/Bereiche: docker/redis/redis.conf; Redis-Keydesign; Monitoring; Runbook.
  - Konkreter Umsetzungshinweis: noeviction oder getrennte Redis-Instanzen/DBs nach Kritikalität; TTLs und Maxmemory dimensionieren; OOM-Verhalten in Services behandeln.
  - Akzeptanzkriterium: Lasttest bis Memorylimit erzeugt Alarm und kontrollierte Fehler, aber keinen stillen Verlust von Locks/Turns/Idempotenz.
  - Geschätzter Aufwand: mittel

- [ ] **Payout-Ziel und Vier-Augen-Prinzip professionalisieren**
  - Technisch umgesetzt und geprüft (18.07.2026): Typisierte IBAN-/PayPal-Ziele sind AEAD-verschlüsselt und maskiert; Requester, Approver und Payer müssen drei verschiedene Accounts sein, jede Auszahlung verlangt eine externe Referenz und Auditspur. Externer Abnahmeblocker: Reale Provider-/Bankbestätigung sowie KYC-/Steuerprozess benötigen Betreiberkonten und verbindliche Compliancevorgaben.
  - Priorität: P1
  - Kategorie: Produkt
  - Problem: **Gefunden.** PayPal-E-Mail/IBAN als gemeinsames Freitextfeld; MOD darf approven und paid markieren; keine externe Zahlungsbestätigung.
  - Risiko/Auswirkung: Fehlüberweisung, Insider-Missbrauch, PII-Leak und fehlende Compliance.
  - Ziel: Verifiziertes Ziel, getrennte Rollen, Provider-/Bankreferenz und vollständige Statushistorie.
  - Betroffene Dateien/Bereiche: Payout-Schema/Service/Controller; Wallet- und Staff-UI; Rollen; Auditlog.
  - Konkreter Umsetzungshinweis: Typisierte PayoutMethod mit verschlüsselten Feldern; Requester/Approver/Payer trennen; Auszahlung erst nach Providerreferenz; KYC/Steuer-Prüfpunkt.
  - Akzeptanzkriterium: Eine Person kann nicht allein anlegen, freigeben und zahlen; Ziel wird maskiert; jede Auszahlung ist mit externer Referenz reconciliert.
  - Geschätzter Aufwand: groß

- [x] **CSP härten und Extra-Image-Origin korrekt anwenden**
  - Umgesetzt und geprüft (18.07.2026): Nonce-basierte Middleware-CSP ohne Produktions-`unsafe-eval`, getrennte Connect-/Image-Origin-Allowlisten, Reportlimit und eingebettete Frame-Policy sind aktiv; der Browserlauf bestätigt Header und null CSP-Konsolenverstöße auf fünf Kernrouten.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** unsafe-inline für Script/Style; CSP_EXTRA_IMG_ORIGINS landet nicht in img-src; connect-src kann sehr breit werden.
  - Risiko/Auswirkung: Schwächere XSS-Begrenzung und gebrochene externe Bilder.
  - Ziel: Nonce-/Hash-basierte CSP mit minimalen Origins und funktionierender Konfiguration.
  - Betroffene Dateien/Bereiche: apps/web/next.config.ts; Middleware/SSR; LiveKit/Sentry-Verbindungen; Tests.
  - Konkreter Umsetzungshinweis: Per-Request Nonce gemäß Next-Support; unsafe-eval/inline minimieren; Origins je Directive validieren; Report-Only-Rollout.
  - Akzeptanzkriterium: Keine unerwarteten CSP-Verstöße in Kernflows; img extras funktionieren nur in img-src; Security-Header-Test dokumentiert Policy.
  - Geschätzter Aufwand: groß

- [x] **Öffentlichen CSP-Report-Endpunkt begrenzen**
  - Umgesetzt und geprüft (18.07.2026): 16-KiB-Routenlimit, Schema-Allowlist, Truncation, Sampling und IP-/Globallimit ersetzen Rohpayload-Logging; Oversize-, Rate- und Logfeldtests sind grün.
  - Priorität: P1
  - Kategorie: Security
  - Problem: **Gefunden.** Öffentlicher Endpoint nimmt bis zum globalen Bodylimit fremde Reports an und loggt freie Daten.
  - Risiko/Auswirkung: Log-Flood, Kosten, gespeicherte Angreiferpayloads und mögliche PII.
  - Ziel: Kleiner, rate-limitierter, schema-validierter Reportkanal ohne Rohpayload-Logging.
  - Betroffene Dateien/Bereiche: HealthController; Fastify Bodylimit; Nginx Rate Limit; Logging/Retention.
  - Konkreter Umsetzungshinweis: Route-spezifisch etwa 16 KiB, CSP-Report-Schema/Allowlist, Sampling und IP-/Globalrate; strukturierte Felder truncaten.
  - Akzeptanzkriterium: Oversize/hohe Rate wird mit 413/429 abgewiesen; Logs enthalten nur erlaubte, begrenzte Felder; Lasttest bleibt stabil.
  - Geschätzter Aufwand: klein

### 15.3 P2 – Qualitäts-, Skalierungs- und Vollständigkeitsaufgaben

- [x] **Große Web-Orchestratoren entlang fachlicher Seams zerlegen**
  - Umgesetzt und geprüft (18.07.2026): Control-Inputs, Dashboard-Controls, Mod-Viewmodel, Streamdiagnostik, Wallet-Helfer und weitere fachliche Seams wurden extrahiert und isoliert getestet; der Architekturcheck begrenzt neue handgeschriebene Module auf 500 Zeilen.
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: **Gefunden.** use-dashboard-page.ts, use-robot-view-state.ts, mod/page.tsx und video-renderer.tsx bündeln jeweils zahlreiche Zustände, Netzwerkaufrufe, Berechtigungen, Timer und Darstellung.
  - Risiko/Auswirkung: Hohe Änderungskosten, schwer isolierbare Tests und veraltete Hook-Closures.
  - Ziel: Kleine, benannte Feature-Controller/Hooks mit klaren Inputs, Outputs und Tests.
  - Betroffene Dateien/Bereiche: apps/web/src/components/dashboard; robot-view; livekit; apps/web/src/app/mod.
  - Konkreter Umsetzungshinweis: Zuerst Verhalten durch Characterization-Tests sichern; danach Seams wie Robot CRUD, Access, Controls, Webhooks, Queue, Chat, Media und Keyboard extrahieren; keine rein kosmetische Dateiaufteilung.
  - Akzeptanzkriterium: Kein neuer Orchestrator >500 Zeilen ohne Begründung; extrahierte Module lassen sich ohne ganze Page testen; bestehende E2E-Flows bleiben grün.
  - Geschätzter Aufwand: groß

- [x] **react-hooks/exhaustive-deps wieder aktivieren**
  - Umgesetzt und geprüft (18.07.2026): `react-hooks/exhaustive-deps` ist global `error`, ohne pauschale Ausnahme; betroffene Effekte und Callbacks wurden stabilisiert und der vollständige Lint-Lauf ist grün.
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: **Gefunden.** Die Regel ist deaktiviert, obwohl viele komplexe Effekte und Callbacks existieren.
  - Risiko/Auswirkung: Effekte arbeiten mit veralteten Tokens, Robotdaten oder Berechtigungen.
  - Ziel: Hook-Abhängigkeiten sind explizit korrekt oder lokal begründet.
  - Betroffene Dateien/Bereiche: ESLint-Konfiguration; alle Web-Hooks, besonders Dashboard und Robot View.
  - Konkreter Umsetzungshinweis: Regel zunächst warn, Befunde systematisch mit Tests bearbeiten; stabile Callbacks/Refs nur dort verwenden, wo Semantik klar ist; keine flächigen Disable-Kommentare.
  - Akzeptanzkriterium: Regel ist error; keine globale Ausnahme; jeder lokale Disable enthält Begründung und Test.
  - Geschätzter Aufwand: groß

- [x] **API- und Eventverträge im Shared-Package konsolidieren**
  - Umgesetzt und geprüft (18.07.2026): Öffentliche REST-/WS-Schemas und Enums liegen kanonisch in Shared/OpenAPI; OpenAPI und Markdown-Referenz werden reproduzierbar generiert und der Driftcheck ist grün. Der zur Laufzeit ungenutzte generierte TypeScript-Client wurde entfernt.
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: **Gefunden.** Webtypen sind mehrfach definiert; Subscription-Controller fällt auf any zurück; OpenAPI/Shared/Prisma-Werte driften.
  - Risiko/Auswirkung: Frontend und Backend akzeptieren unterschiedliche Formen oder Statuswerte.
  - Ziel: Eine kanonische, validierbare Quelle für öffentliche REST-/WS-Verträge.
  - Betroffene Dateien/Bereiche: packages/shared; apps/web/src/lib/api-types.ts und api/types.ts; Controller/DTOs; Clientgenerator.
  - Konkreter Umsetzungshinweis: Zod-Schemas plus abgeleitete Typen oder OpenAPI-Client als Grenze; Prisma-Modelle nicht ungefiltert veröffentlichen; Contract-Tests.
  - Akzeptanzkriterium: Doppelte öffentliche Typen entfernt; kein any an API-Grenzen; Clientgenerierung und OpenAPI-Drift sind CI-grün.
  - Geschätzter Aufwand: groß

- [x] **Chat-Nachrichten über clientMessageId idempotent machen**
  - Umgesetzt und geprüft (18.07.2026): `clientMessageId` ist je Robot/Nutzer eindeutig persistiert; Reconnect-/Parallel-Duplikate liefern die Originalnachricht und erzeugen nur einen Datensatz beziehungsweise sichtbaren Eintrag.
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: **Gefundenes Risiko.** clientMessageId wird nicht als eindeutige Datenbankinvariante persistiert; Reconnect/Retry kann dieselbe authentifizierte Nachricht mehrfach speichern.
  - Risiko/Auswirkung: Doppelte Chatnachrichten, Moderationsrauschen und uneindeutige Zustellbestätigung.
  - Ziel: Ein Client-Sendeversuch erzeugt je Raum/Nutzer genau eine Nachricht und eine wiederholbare Antwort.
  - Betroffene Dateien/Bereiche: ChatHandler; Prisma ChatMessage; Web Chat-State/Reconnect; Tests.
  - Konkreter Umsetzungshinweis: clientMessageId plus robotId/userId eindeutig, serverseitige Message-ID zurückgeben; Gastsemantik explizit definieren; Duplicate als Originalantwort behandeln.
  - Akzeptanzkriterium: Parallel-/Reconnect-Test mit identischer ID erzeugt einen Datensatz und eine sichtbare Nachricht; unterschiedliche IDs bleiben unabhängig.
  - Geschätzter Aufwand: mittel

- [x] **Control-Konfigurationscache replikenweit invalidieren**
  - Umgesetzt und geprüft (18.07.2026): DB-/Redis-Version und Pub/Sub-Invalidierung propagieren Preis-/Accessänderungen nach Commit; Zwei-Replikat-Tests verwerfen veraltete Cacheversionen sofort.
  - Priorität: P2
  - Kategorie: Security
  - Problem: **Gefundenes Risiko.** Enabled Controls werden pro Instanz für fünf Sekunden gecacht; Preis-/Accessänderungen sind nicht sofort auf allen Replikaten sichtbar.
  - Risiko/Auswirkung: Kürzlich gesperrte oder verteuerte Aktion kann kurzfristig mit alter Policy ausgeführt werden.
  - Ziel: Sicherheits- und Preisänderungen invalidieren alle Replikate vor Bestätigung an den Host.
  - Betroffene Dateien/Bereiche: ControlsService; Dashboard-Mutationen; Redis Pub/Sub/Versionierung; ControlHandler.
  - Konkreter Umsetzungshinweis: Robot-Control-Version in Redis/DB, Publish-Invalidation nach Commit; Hot Path prüft Version; Updateantwort erst nach erfolgreichem Publish oder sichere kurze TTL plus Version.
  - Akzeptanzkriterium: Zwei-Replikat-Test zeigt neue Access-/Preisregel unmittelbar nach erfolgreichem Update; kein alter Command wird akzeptiert.
  - Geschätzter Aufwand: mittel

- [x] **Queue-Join-Limit und Positionsinvarianten transaktionssicher machen**
  - Umgesetzt und geprüft (18.07.2026): Count/Insert liegen in derselben Serializable-Transaktion mit begrenztem Konfliktretry; DB-Invarianten und Paralleltests halten Limit und eindeutige Reihenfolge.
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: **Gefunden/Risiko.** Globaler Count liegt außerhalb der Transaktion; Serializable-Konflikte werden nicht retried; position ist nicht eindeutig.
  - Risiko/Auswirkung: Limitüberschreitung, Duplicate Positions oder sporadische 500/409 unter Parallelität.
  - Ziel: Deterministische Queue-Invarianten über mehrere Instanzen.
  - Betroffene Dateien/Bereiche: QueueService; Prisma QueueEntry; Redis-Voting; Tests.
  - Konkreter Umsetzungshinweis: Count/Insert in dieselbe Transaktion, begrenzter Retry bei P2034; sortierbarer Sequenzwert oder DB-Constraint; Fehlercodes für Clients.
  - Akzeptanzkriterium: 100 parallele Joins halten Userlimit und eindeutige Reihenfolge; keine ungefangenen Serialisierungsfehler.
  - Geschätzter Aufwand: mittel

- [x] **Queue-Neunummerierung und Voting von O(n)-Writes entkoppeln**
  - Umgesetzt und geprüft (18.07.2026): Sparse Ordering und set-basierte Änderungen ersetzen sequentielle Neunummerierung; der reale 1.000-Einträge-Benchmark bestand mit Read-p95 82,06 ms, Join/Leave-p95 18,06 ms und null Duplikaten.
  - Priorität: P2
  - Kategorie: Performance
  - Problem: **Gefunden.** Leave und Voting aktualisieren zahlreiche Einträge sequentiell.
  - Risiko/Auswirkung: Lange Locks und steigende Latenz bei großen Events/Queues.
  - Ziel: Join/Leave/Vote bleiben bei Zielqueuegrößen innerhalb eines definierten Budgets.
  - Betroffene Dateien/Bereiche: apps/api/src/queue/queue.service.ts; QueueEntry-Sortierung; Redis-Ballots.
  - Konkreter Umsetzungshinweis: Unveränderliche rank/order keys oder sparse ordering; Set-based SQL statt Schleifen; Votes aggregiert und begrenzt aktualisieren.
  - Akzeptanzkriterium: Benchmark mit 1.000 Einträgen: p95 Join/Leave/Vote unter festgelegtem Ziel, konstante/nahezu konstante Writezahl; Reihenfolge korrekt.
  - Geschätzter Aufwand: groß

- [x] **Queue bei kurzem Robot-Disconnect erhalten**
  - Umgesetzt und geprüft (18.07.2026): Disconnect pausiert den Turn und startet eine Grace Period statt die Queue zu löschen; Reconnect erhält Reihenfolge/Votes, Timeout sendet genau ein verständliches Cancel-Event.
  - Priorität: P2
  - Kategorie: UX
  - Problem: **Gefunden.** Robot-Socket-Disconnect ruft clearQueue für den gesamten Robot auf.
  - Risiko/Auswirkung: Ein kurzer Netzfehler löscht alle Wartepositionen und Stimmen; Nutzer verlieren Vertrauen und verlassen den Raum.
  - Ziel: Queue bleibt während eines definierten Reconnect-Fensters erhalten und wird nur kontrolliert aufgelöst.
  - Betroffene Dateien/Bereiche: bot.gateway.runtime.ts; GatewayRuntime disconnect; QueueService; Robotstatus; Raum-UI.
  - Konkreter Umsetzungshinweis: Offline-/reconnecting-Zustand mit Grace Period; Turn sicher stoppen, Queue aber pausieren; Host kann bewusst canceln; nach Timeout klare Benachrichtigung.
  - Akzeptanzkriterium: Reconnect innerhalb der Frist erhält Reihenfolge und Votes; abgelaufene Frist löst genau ein Queue-Cancel-Event mit verständlicher UI aus.
  - Geschätzter Aufwand: mittel

- [x] **Datenbankconstraint für höchstens eine aktive Session pro Robot einführen**
  - Umgesetzt und geprüft (18.07.2026): Partieller Unique Index für `ACTIVE` plus transaktionale Create-/End-Logik erzwingen exakt eine aktive Session; Paralleltests sind grün.
  - Priorität: P2
  - Kategorie: Codequalität
  - Problem: **Gefundenes Risiko.** Service beendet alte Sessions, aber parallele Creates haben keine DB-Invariante.
  - Risiko/Auswirkung: Zwei aktive Sessions, falscher Controller und doppelte Analytics/Webhooks.
  - Ziel: Die Datenbank verhindert mehrere ACTIVE-Sessions.
  - Betroffene Dateien/Bereiche: Prisma Session; PostgreSQL Partial Unique Index; SessionsService; Tests.
  - Konkreter Umsetzungshinweis: Partiellen Unique Index auf robotId WHERE status='ACTIVE'; Create/End in Serializable-Transaktion mit Retry und eindeutiger Konfliktbehandlung.
  - Akzeptanzkriterium: Paralleltest erzeugt exakt eine aktive Session; andere Anfrage erhält definierten Status oder übernimmt kontrolliert.
  - Geschätzter Aufwand: mittel

- [x] **Presence nicht bei jedem Join/Leave in PostgreSQL schreiben**
  - Umgesetzt und geprüft (18.07.2026): Redis ist Quelle für aktuelle Presence, PostgreSQL erhält nur gedrosselte Snapshots; Mehrinstanz- und 1.000-Event-Tests belegen Konvergenz ohne Write-Amplification.
  - Priorität: P2
  - Kategorie: Performance
  - Problem: **Gefunden.** viewerCount wird für flüchtige Presence-Änderungen dauerhaft geschrieben; Replikate können Werte überschreiben.
  - Risiko/Auswirkung: Write-Amplification, Hot Rows und ungenaue Counts.
  - Ziel: Realtime-Count bleibt in Redis/LiveKit; DB erhält nur gedrosselte Snapshots oder aggregierte Statistik.
  - Betroffene Dateien/Bereiche: RoomHandler; PresenceHandler; RobotRoomStateHelper; Public Overview.
  - Konkreter Umsetzungshinweis: Redis-Zähler als Quelle, periodisches/debounced Persist; monotone Analytics getrennt von aktuellem Count; Stale-Recovery.
  - Akzeptanzkriterium: 1.000 Join/Leave-Events erzeugen höchstens die definierte kleine DB-Writezahl; Anzeige konvergiert über zwei Replikate.
  - Geschätzter Aufwand: mittel

- [x] **Recording-Metadaten indexieren statt Buckets zu scannen**
  - Umgesetzt und geprüft (18.07.2026): Recording-Katalog und Sessionpräfix liefern indexierte Lookups; Sessiondetails führen kein unpräfixiertes `ListObjects` mehr aus, S3-Listing bleibt ausschließlich Reconciliation.
  - Priorität: P2
  - Kategorie: Performance
  - Problem: **Gefunden.** Listing und Fallbacksuche paginieren über den gesamten Bucket.
  - Risiko/Auswirkung: Latenz und S3-Kosten wachsen mit jeder Aufnahme.
  - Ziel: O(1)/indexierter Lookup nach Session, Robot und Datei.
  - Betroffene Dateien/Bereiche: RecordingAdminService; Prisma Recording-Modell; LiveKit Egress-Callbacks; S3-Keypräfix.
  - Konkreter Umsetzungshinweis: Recording-Tabelle als Katalog, Object-Key mit robotId/sessionId-Prefix; S3-List nur für Reconciliationjob.
  - Akzeptanzkriterium: Sessiondetail macht kein unpräfixiertes ListObjects; Benchmark bleibt bei 10/10.000/1.000.000 Objekten innerhalb desselben Latenzbudgets.
  - Geschätzter Aufwand: groß

- [x] **Earnings und Leaderboard fachlich konsistent berechnen**
  - Umgesetzt und geprüft (18.07.2026): Ledgerbasierte Revenue- und zeitraumbezogene Engagementmetriken ersetzen Balance-/200-Einträge-Heuristiken; Fixturetests und UI-Beschriftung stimmen überein.
  - Priorität: P2
  - Kategorie: Produkt
  - Problem: **Gefunden.** perRobot nutzt die letzten 200 Transaktionen, Lifetime anders; Leaderboard rankt credits/aktuellen Wert, während Zeitraum nur Sessions filtert.
  - Risiko/Auswirkung: Creator sehen irreführende Einnahmen/Ränge; Ausgaben können Rang senken.
  - Ziel: Klar benannte Metriken mit derselben Datenbasis und Zeitdimension.
  - Betroffene Dateien/Bereiche: EarningsService; UsersService.getLeaderboard; Prisma-Aggregationen; Web-Seiten; ADR 0005/0007.
  - Konkreter Umsetzungshinweis: Revenue-/Engagement-Leaderboards trennen; SQL-Aggregation über Ledgerzeitraum; balance und credits semantisch bereinigen; limit min/max validieren.
  - Akzeptanzkriterium: Fixtures mit Käufen, Ausgaben, Donations und Zeiträumen ergeben dokumentierte Werte; UI erklärt Metrik und Zeitraum.
  - Geschätzter Aufwand: groß

- [x] **Vollständige Wallet-Historie und Reconciliation sichtbar machen**
  - Umgesetzt und geprüft (18.07.2026): Filter, Cursor-Pagination, Final/Reversed-Status, Reconciliation-ID sowie CSV-/JSON-Export sind in API und Wallet integriert; Duplikat-, Lücken- und CSV-Injection-Tests sind grün.
  - Priorität: P2
  - Kategorie: Feature
  - Problem: **Gefunden.** API kann cursor-paginieren, die Wallet-Seite zeigt primär den Summary-Ausschnitt; eindeutige Provider-/Intent-/Payoutbezüge fehlen für Nutzer.
  - Risiko/Auswirkung: Nutzer können Saldoabweichungen nicht nachvollziehen und Supportaufwand steigt.
  - Ziel: Filterbare, paginierte, exportierbare Ledgeransicht mit Status und Referenz.
  - Betroffene Dateien/Bereiche: Wallet API/UI; Transaction-Metadaten; Billing/Payout-Relationen.
  - Konkreter Umsetzungshinweis: Infinite/paginated list, Typ/Zeitraum/Robotfilter, Pending/Final/Reversed, menschenlesbare Reconciliation-ID; sensible Metadaten ausblenden.
  - Akzeptanzkriterium: Jede Balanceänderung ist in der UI auffindbar und summiert sich korrekt; Pagination ohne Duplikate/Lücken; CSV/JSON-Export geprüft.
  - Geschätzter Aufwand: mittel

- [x] **Betroffenen-Datenexport vervollständigen**
  - Umgesetzt und geprüft (18.07.2026): Reauth-geschützter Export umfasst vollständige paginierte Profile, Robots, Sessions, Queue, Chat, Moderation, Ledger, Billing, Payouts und Analytics mit redigierter Fremd-PII; >100-Fixtures sind getestet.
  - Priorität: P2
  - Kategorie: Compliance
  - Problem: **Gefunden.** Export enthält nur Profil, Robots und maximal 100 Sessions/Queue-Einträge; Chat, Moderation, Ledger, Billing, Payouts und vollständige Historie fehlen.
  - Risiko/Auswirkung: Die Privacy-Aussage „account export“ kann als vollständige Auskunft missverstanden werden.
  - Ziel: Vollständiger, sicherer, paginierter/asynchroner Export gemäß bestätigtem Scope.
  - Betroffene Dateien/Bereiche: UsersService.exportOwnData; Settings; Queue/Jobs/Object Storage; Privacy.
  - Konkreter Umsetzungshinweis: Dateninventar mit Rechtsprüfung; asynchrones Exportarchiv, kurzlebiger Download, Reauth, Auditlog; Fremd-PII redigieren.
  - Akzeptanzkriterium: Testkonto mit >100 Datensätzen exportiert alle in der Matrix vorgesehenen Daten; Download ist zeitbegrenzt und nur nach Reauth verfügbar.
  - Geschätzter Aufwand: groß

- [x] **PII- und Retention-Matrix technisch durchsetzen**
  - Umgesetzt und geprüft (18.07.2026): Datenmatrix mit Ownern/Ausnahmen, minimierte Providerpayloads, TTL-/Cleanupjobs und Backup-/Deletionpolicy wurden umgesetzt; Tests löschen fällige und erhalten nicht fällige Datensätze.
  - Priorität: P2
  - Kategorie: Compliance
  - Problem: **Gefunden.** Webhook-Payloads, Donation-IP/User-Agent, Payoutziele, Chat/Moderation und Backups haben keine einheitliche Retention.
  - Risiko/Auswirkung: Überlange Speicherung und unklare Lösch-/Auskunftsfähigkeit.
  - Ziel: Für jede Datenklasse Zweck, Zugriff, Speicherort, Frist und Löschmechanismus.
  - Betroffene Dateien/Bereiche: Prisma-Modelle; MaintenanceService; Logging; S3; Backups; Rechtstexte.
  - Konkreter Umsetzungshinweis: Versionierte Datenlandkarte; Felder minimieren/verschlüsseln; Cleanupjobs mit Metriken; Legal Hold separat; Backuplöschung dokumentieren.
  - Akzeptanzkriterium: Automatisierte Retentiontests pro Tabelle/Bucket; Dashboard/Alert bei Cleanupfehler; Dokument und Codewerte stimmen überein.
  - Geschätzter Aufwand: groß

- [x] **Sentry-Integration entweder installieren oder vollständig entfernen**
  - Umgesetzt und geprüft (18.07.2026): Nicht funktionsfähige API-/Browser-Bootstraps, DSN-Konfiguration, Servicekomponenten und Dokuclaims wurden vollständig entfernt; Quell- und Dependency-Suche ist leer.
  - Priorität: P2
  - Kategorie: DevOps
  - Problem: **Gefunden.** Code importiert @sentry/node/@sentry/nextjs dynamisch, Pakete fehlen; .env.example nennt zudem ein anderes Nest-Paket.
  - Risiko/Auswirkung: Betreiber glauben an Error Tracking, obwohl keine Events gesendet werden.
  - Ziel: Observability-Konfiguration ist wahrheitsgemäß und per Smoke-Test nachweisbar.
  - Betroffene Dateien/Bereiche: API/Web package.json; SentryBootstrap; .env.example; Runbook; Release.
  - Konkreter Umsetzungshinweis: Offiziell kompatible Pakete installieren und Release/Source Maps/PII-Filter konfigurieren oder DSN-/Codepfade entfernen; Testevent im Staging.
  - Akzeptanzkriterium: SENTRY_DSN führt zu bestätigtem Testevent mit Release und ohne Tokens/PII; deaktivierter Zustand erzeugt keine falsche Erfolgsanzeige.
  - Geschätzter Aufwand: mittel

- [x] **Readiness, Liveness und Degraded-Status korrekt trennen**
  - Umgesetzt und geprüft (18.07.2026): `/live` prüft nur den Prozess, `/ready` zwingende DB-/Redis- und aktivierte Featureabhängigkeiten mit non-200; Ausfall-/Recoverytests und Compose-Probes sind grün.
  - Priorität: P2
  - Kategorie: DevOps
  - Problem: **Gefundenes Risiko.** Container prüfen /health/live; der aggregierte Healthstatus kann degraded liefern, ohne klaren non-200-Readinessstatus.
  - Risiko/Auswirkung: Traffic erreicht Instanzen ohne DB/Redis/LiveKit; Orchestrator erkennt Abhängigkeitsschäden nicht.
  - Ziel: Liveness prüft Prozess, Readiness prüft zwingende Abhängigkeiten und liefert non-200.
  - Betroffene Dateien/Bereiche: HealthController; Docker Compose; Nginx/upstream; Monitoring.
  - Konkreter Umsetzungshinweis: /live ohne externe Calls, /ready mit DB/Redis und je Feature erforderlichen Services; optionale Provider getrennt; Startperiod/Timeouts.
  - Akzeptanzkriterium: Ausfall jeder Pflichtabhängigkeit entfernt Instanz aus Readiness, nicht aus Liveness; Recovery wird automatisch grün.
  - Geschätzter Aufwand: mittel

- [x] **Ressourcenlimits, SLOs und Alerts definieren**
  - Umgesetzt und geprüft (18.07.2026): Compose-Limits, SLOs, 15 Alertregeln, Owner/Eskalation und Runbooks decken API, WS, Queue, Billing, Mail, Webhooks, DB, Redis, Storage und Containerdisk ab; `promtool`-Game-Day-Simulation ist grün.
  - Priorität: P2
  - Kategorie: DevOps
  - Problem: **Gefunden.** Compose hat keine App-Limits; Prometheus-Stack besitzt keine nachgewiesenen Produkt-SLOs/Alertregeln.
  - Risiko/Auswirkung: Ein Leak oder Spike verdrängt DB/Redis; Ausfälle werden spät bemerkt.
  - Ziel: Kapazitätsgrenzen und Alerting für API, WebSocket, Queue, Billing, Mail, Webhooks, DB, Redis, LiveKit und Storage.
  - Betroffene Dateien/Bereiche: Compose/Deployment; Prometheus/Grafana; Runbook.
  - Konkreter Umsetzungshinweis: Requests/Limits aus Lasttest ableiten; Alerts für Errorrate, p95, Queueage, Webhookfail, Billing-needs-review, Redis memory, DB connections, disk.
  - Akzeptanzkriterium: Game-Day löst erwartete Alerts aus; Owner/Eskalation/Runbook verlinkt; Limits verhindern Host-Ausfall.
  - Geschätzter Aufwand: groß

- [x] **Backup und Restore als automatisierten Drill etablieren**
  - Umgesetzt und geprüft (18.07.2026): Versioniertes Manifest, Checksummen, PostgreSQL-/MinIO-/Secretbackup und isolierter Restore mit Migration, Drift und Anwendungssmoke laufen im Releaseworkflow; der nach allen API-Korrekturen wiederholte Drill bestand in 30 s einschließlich Admin-Login, autorisierter Datenabfrage und Recording-Download. Beschädigtes Archiv, falscher Schlüssel und fehlendes Secret werden abgewiesen.
  - Priorität: P2
  - Kategorie: DevOps
  - Problem: **Gefunden.** Skripte/Doku widersprechen sich, referenzieren alte Services und ein vollständiger Restore ist nicht nachgewiesen.
  - Risiko/Auswirkung: Backups können im Ernstfall unbrauchbar sein.
  - Ziel: Definierte RPO/RTO und regelmäßig bewiesener Restore aller notwendigen persistenten Daten.
  - Betroffene Dateien/Bereiche: scripts/backup/restore; Runbook; PostgreSQL; MinIO/S3; Secrets/Configs.
  - Konkreter Umsetzungshinweis: Keine Fallbackpasswörter; manifestierte Backupversion; Restore in isolierte Umgebung, Migration/Smoke/Checksummen; Resultat reporten.
  - Akzeptanzkriterium: Automatischer Monats-/Release-Drill stellt neues Environment innerhalb RTO her; RPO nachgewiesen; fehlendes Objekt/Secret macht den Drill rot.
  - Geschätzter Aufwand: groß

- [x] **Dokumentation, ADRs und OpenAPI mit dem Code synchronisieren**
  - Umgesetzt und geprüft (18.07.2026): README, Runbook, Robot-/WS-Doku, Retention, Observability und ADRs wurden an Protokoll und Betrieb angepasst; OpenAPI und Markdown-Referenz sind deterministisch neu erzeugt und driftfrei.
  - Priorität: P2
  - Kategorie: Doku
  - Problem: **Gefunden.** Robot-Event, Healthpfad, Enumwerte, Billingstatus, Turn-Architektur und Safetyclaims sind veraltet oder widersprüchlich.
  - Risiko/Auswirkung: Integratoren bauen gegen falsche Protokolle; Betrieb reagiert mit falschen Befehlen.
  - Ziel: Aktuelle, versionierte Source-of-Truth für Setup, API, WS, Robot-Client und Betrieb.
  - Betroffene Dateien/Bereiche: README; CONTRIBUTING; docs; packages/shared/README; docs/openapi.json; ADRs; Runbook.
  - Konkreter Umsetzungshinweis: Dokumente nach Owner/Status inventarisieren; veraltete ADRs superseded markieren; Beispielpayloads aus Schemas generieren; Claims nur mit Benchmark.
  - Akzeptanzkriterium: OpenAPI-Driftcheck grün; Doku-Beispieltests laufen; keine Suche nach alten Events/Enums/Pfaden in aktiven Dokumenten.
  - Geschätzter Aufwand: groß

- [x] **Frontend-Bundle, Rendering und Polling messen und budgetieren**
  - Umgesetzt und geprüft (18.07.2026): Framer Motion wurde entfernt, Kernrouten laden ohne unnötiges Prefetching, Explore/Login werden statisch ausgeliefert, die Filtersuche bleibt servergerendert, Robot- und Dashboard-Polling ist sichtbarkeitsabhängig und überlappungsfrei, Raumzustand nutzt WebSocketevents. Exakte JS-Baselines mit 10-%-Regressionsgate, consent-gebundene CLS/LCP/INP-p75-Messung und 18 mobile Lighthouse-Läufe auf Landing, Explore, Robot, Login, Pricing und authentifiziertem Dashboard sind grün: Performance 98–100, Accessibility 95–100, LCP 1,609–2,015 s, TBT 0–136 ms, CLS 0, 20–45 Requests und 42.594–174.533 übertragene Bytes.
  - Priorität: P2
  - Kategorie: Performance
  - Problem: **Prüfpunkt.** Große Clientdateien und paralleles Polling sind sichtbar, aber keine frische Bundle-/Web-Vitals-Messung liegt vor.
  - Risiko/Auswirkung: Mobile Ladezeit, Re-Render und Datenverbrauch können schlecht sein; konkrete Größe darf erst gemessen werden.
  - Ziel: Reproduzierbare Budgets pro Kernroute und kontrollierte Pollingstrategie.
  - Betroffene Dateien/Bereiche: apps/web analyze; Robot View/Dashboard/Mod; CI; Lighthouse.
  - Konkreter Umsetzungshinweis: Bundle Analyzer und Lighthouse CI auf Landing/Explore/Robot/Login/Pricing/Dashboard; React Profiler für Room; WebSocketevents statt unnötigem Polling.
  - Akzeptanzkriterium: Dokumentierte JS-/LCP-/INP-/Requestbudgets; CI warnt/blockiert >10-%-Regression; Messwerte auf Mobileprofil.
  - Geschätzter Aufwand: mittel

- [ ] **LiveKit-Bandbreite für Multi-Camera adaptiv steuern**
  - Technisch umgesetzt und im Browsermodell geprüft (18.07.2026): `adaptiveStream`, `dynacast`, sichtbarkeitsabhängige Subscriptionqualität, Netzfallback und exportierbare Diagnostik sind integriert. Externer Abnahmeblocker: Der geforderte 30-Minuten-Vier-Kamera-Test mit realer Publisherhardware, Mobilgerät, Bitrate, CPU und Temperatur benötigt das physische Robot-/Kamera-Setup.
  - Priorität: P2
  - Kategorie: Performance
  - Problem: **Gefundenes Risiko.** adaptiveStream und dynacast sind deaktiviert; mehrere Streams können auch unsichtbar hohe Qualität beziehen.
  - Risiko/Auswirkung: Mobile Daten, Decode-CPU und Startzeit steigen.
  - Ziel: Nur sichtbare/aktive Kameras erhalten angemessene Qualität.
  - Betroffene Dateien/Bereiche: video-renderer.tsx; LiveKit RoomOptions; Multi-Camera-UX.
  - Konkreter Umsetzungshinweis: adaptiveStream/dynacast gegen aktuelle LiveKit-Version testen; aktive Kamera priorisieren, Thumbnails niedrig; Netzqualitätsfallback.
  - Akzeptanzkriterium: 4-Kamera-Test reduziert empfangene Bitrate/CPU bei einer sichtbaren Kamera messbar, ohne Umschaltfehler; mobile Zielwerte dokumentiert.
  - Geschätzter Aufwand: mittel

- [x] **Avatar-/Remote-Image-Policy datenschutz- und funktionssicher machen**
  - Umgesetzt und geprüft (18.07.2026): Avatare werden serverseitig größen-, MIME- und pixelbegrenzt unter zufälligen Objektschlüsseln in einem privaten S3-Bucket gespeichert und ausschließlich über den API-Proxy geladen. Ersetzung, Löschung und Kontolöschung erzeugen transaktionale Storage-Outbox-Aufträge; Kompensations- und Docker-E2E-Tests sind grün.
  - Priorität: P2
  - Kategorie: Security
  - Problem: **Gefundenes Risiko.** Nutzer können HTTPS-Avatar-URLs setzen; Remotehosts können Tracking erhalten oder nicht von Next Image zugelassen sein.
  - Risiko/Auswirkung: Drittanbieter sehen Besucher-IP/Referer; Bilder brechen je nach Host.
  - Ziel: Kontrollierte Upload-/Proxystrategie oder enge Hostallowlist.
  - Betroffene Dateien/Bereiche: User avatar validation; Next image config; Privacy; CSP.
  - Konkreter Umsetzungshinweis: Bevorzugt serverseitiger Upload in eigenen S3-Bucket mit Größen-/MIME-/Pixelprüfung; alternativ Proxy und Hostallowlist.
  - Akzeptanzkriterium: Beliebige externe Trackinghosts werden nicht direkt aus Browsern geladen; gültige Avatare funktionieren; Uploadlimits getestet.
  - Geschätzter Aufwand: mittel

- [x] **MOD-Datenzugriff anhand einer Rollenmatrix minimieren**
  - Umgesetzt und geprüft (18.07.2026): Moderation und Finance sind serverseitig getrennt, E-Mail-/Kontaktfelder minimiert und Finanzendpunkte Admin-only; die automatisierte Staff-Endpunkt-/Responsefeld-Matrix ist grün.
  - Priorität: P2
  - Kategorie: Compliance
  - Problem: **Gefunden.** MOD kann umfangreiche Nutzerlisten inklusive E-Mail sowie Billing-/Payout-Review sehen und teils Finanzaktionen ausführen.
  - Risiko/Auswirkung: Überprivilegierung und unnötige PII-Offenlegung.
  - Ziel: Separierte Rollen/Capabilities für Moderation, Support, Finance und Admin.
  - Betroffene Dateien/Bereiche: RolesGuard/decorators; User/Billing/Payout-Controller; Staff-UI; Auditlog.
  - Konkreter Umsetzungshinweis: Capability-Matrix; E-Mail maskieren; Financeaktionen nur Finance/Admin; serverseitige Feldselektion je Rolle.
  - Akzeptanzkriterium: Automatisierte Rollenmatrix testet jeden Staff-Endpunkt und Responsefelder; MOD sieht keine unnötige Finanz-/Kontaktinformation.
  - Geschätzter Aufwand: groß

- [x] **Login-Lockout gegen gezielte Account-Sperren härten**
  - Umgesetzt und geprüft (18.07.2026): Progressive Verzögerungen und getrennte IP-/Accountsignale ersetzen dauerhafte fremdauslösbare Sperren; NAT-, Angriff-, Recovery- und Risikohinweis-Tests sind grün.
  - Priorität: P2
  - Kategorie: Security
  - Problem: **Gefundenes Risiko.** Fehlversuche sperren einen Account nach E-Mailbezug; ein Angreifer kann wiederholt fremde Konten in Lockout bringen.
  - Risiko/Auswirkung: Gezielte Verfügbarkeitsangriffe auf Nutzer und Hosts; hinter NAT können grobe Proxy-Limits zusätzlich legitime Nutzer treffen.
  - Ziel: Credential Stuffing begrenzen, ohne einem anonymen Client eine dauerhafte Account-Sperrfunktion zu geben.
  - Betroffene Dateien/Bereiche: AuthService; Redis-Rate-Limits; Nginx auth zones; Mailwarnung; Monitoring.
  - Konkreter Umsetzungshinweis: Progressive Delays, IP-/Device-/Account-Signale getrennt, Captcha/Challenge nach Risiko, sichere Recovery; Limits anhand realer NAT-Szenarien kalibrieren.
  - Akzeptanzkriterium: Angriffssimulation kann Passwortversuche nicht skalieren, sperrt das Zielkonto aber nicht dauerhaft; legitimer Recoveryflow und NAT-Lasttest bestehen.
  - Geschätzter Aufwand: mittel

- [x] **Kontrollbuttons pro Command eindeutig modellieren**
  - Umgesetzt und geprüft (18.07.2026): Der Client sendet `buttonId`, der Server lädt exakt Preis, Access und Cooldown dieses Datensatzes und weist manipulierte ID-/Command-Paare ab; Duplicate-Command-Tests sind grün.
  - Priorität: P2
  - Kategorie: Produkt
  - Problem: **Gefunden.** Mehrere erlaubte Buttons mit gleichem command werden auf billigsten Preis und kleinsten Cooldown reduziert.
  - Risiko/Auswirkung: Hostkonfiguration kann Preis-/Accessregeln ungewollt unterlaufen.
  - Ziel: Eindeutige Action-ID mit serverseitig bestimmter Semantik; Command ist nur Robotpayload.
  - Betroffene Dateien/Bereiche: ControlButton-Schema; ControlsService; ControlHandler; Dashboard-Builder; Robot-Protokoll.
  - Konkreter Umsetzungshinweis: Client sendet buttonId/actionId, Server lädt genau diesen Datensatz; Fallbackbewegungen separat; Duplicate Commands erlaubt nur mit klarer Policy.
  - Akzeptanzkriterium: Preis/Access/Cooldown stammen immer vom gewählten Button; manipuliertes command/buttonId-Paar wird abgewiesen; Tests decken Duplikate.
  - Geschätzter Aufwand: groß

- [x] **Raw Body auf Zahlungswebhooks begrenzen**
  - Umgesetzt und geprüft (18.07.2026): Raw Bytes werden nur für Stripe-/PayPal-Routen mit 256-KiB-Grenze gehalten; normale Routen nutzen den kleinen Standardparser, Signatur- und 413-Tests sind grün.
  - Priorität: P2
  - Kategorie: Performance
  - Problem: **Gefunden.** Raw-Body-Unterstützung und 5-MiB-Grenze gelten global.
  - Risiko/Auswirkung: Unnötige Speicherkopien und größere DoS-Fläche auf jeder Route.
  - Ziel: Rohbytes nur für signaturpflichtige Providerwebhooks mit kleinem providerkonformen Limit.
  - Betroffene Dateien/Bereiche: apps/api/src/main.ts/Fastify-Setup; BillingController; Bodylimit; Nginx.
  - Konkreter Umsetzungshinweis: Route-spezifischer Content-Type-Parser/Plugin; 256 KiB oder durch Provider-Maximum belegtes Limit; übrige API kleiner.
  - Akzeptanzkriterium: Stripe/PayPal-Signaturtests grün; Oversize-Body erhält 413; normale Routen halten keine Raw-Kopie.
  - Geschätzter Aufwand: mittel

- [x] **Status-/Healthseite auf echte Abhängigkeiten und Fehlerzustände ausrichten**
  - Umgesetzt und geprüft (18.07.2026): Öffentliche Statusfähigkeiten für Discovery, Video, Control, Auth und Payments werden aus echten, nicht sensiblen Dependencychecks abgeleitet; gezielte Ausfalltests und Alerts sind grün.
  - Priorität: P2
  - Kategorie: UX
  - Problem: **Gefundenes Risiko.** Öffentliche Statusdarstellung und API-Health unterscheiden nicht alle Pflicht-/Optionalkomponenten; degraded HTTP-Semantik ist unklar.
  - Risiko/Auswirkung: Nutzer sehen „online“, obwohl Steuerung, Video oder Zahlung nicht funktioniert.
  - Ziel: Produktfähigkeiten statt nur Prozesse als Status anzeigen.
  - Betroffene Dateien/Bereiche: HealthController; status/page.tsx; LiveKit/Redis/DB/Billing/Mail Checks.
  - Konkreter Umsetzungshinweis: Capabilities Discovery/Video/Control/Auth/Payments getrennt; sensible Details nicht öffentlich; History/Incidentlink optional.
  - Akzeptanzkriterium: Gezielter Ausfall jeder Komponente erzeugt den korrekten Capabilitystatus und Monitoringalarm.
  - Geschätzter Aufwand: mittel

### 15.4 P3 – Weiterführende Produktverbesserungen

- [x] **Service Worker mit klarer PWA-Strategie versehen oder entfernen**
  - Umgesetzt und geprüft (18.07.2026): Registrierung, Browserkomponente und leerer Service Worker wurden entfernt; Quellsuche und Produktionsbuild enthalten keine Registrierung oder Cachingpfade.
  - Priorität: P3
  - Kategorie: Performance
  - Problem: **Gefunden.** Service Worker registriert sich, hat aber keinen Fetch-/Cache-/Update-Flow.
  - Risiko/Auswirkung: Zusätzliche Komplexität ohne Nutzerwert; spätere Cacheprobleme möglich.
  - Ziel: Entweder bewusstes Install-/Offline-Erlebnis oder kein Service Worker.
  - Betroffene Dateien/Bereiche: Public Service Worker; Registrierung; Manifest; Offline-UI.
  - Konkreter Umsetzungshinweis: Für PWA nur statische Dokumente/Assets cachen, niemals Auth/Wallet/Robot-Control; Updateprompt und Versionierung; sonst Registrierung löschen.
  - Akzeptanzkriterium: Gewählte Strategie dokumentiert; Control-/Paymentrequests nie gecacht; Update-/Offline-E2E grün oder keinerlei Registrierung.
  - Geschätzter Aufwand: mittel

- [ ] **Geführtes Host-Go-live-Onboarding einführen**
  - Technisch umgesetzt und im Browser geprüft (18.07.2026): Persistente, serverseitig erzwungene Schritte für Claim, Connectivity, Kamera, Control-ACK, Hardware-E-Stop, Access, Moderation, Preview und Publish sind im Dashboard integriert; Anlage und nicht überspringbare Checks sind E2E-grün. Externer Abnahmeblocker: Eine echte Veröffentlichung nach Kamera-, Control- und Hardware-E-Stop-Nachweis benötigt den physischen Robot-Client.
  - Priorität: P3
  - Kategorie: Feature
  - Problem: **Idee.** Einzelne Dashboardfunktionen sind vorhanden, aber kein verbindlicher Ende-zu-Ende-Go-live-Pfad.
  - Risiko/Auswirkung: Hosts veröffentlichen Robots ohne Video, sichere Controls oder getesteten E-Stop.
  - Ziel: Checkliste von Anlage bis sicherer Veröffentlichung.
  - Betroffene Dateien/Bereiche: Dashboard; Robotstatus; LiveKit/Control-Diagnostics; Docs.
  - Konkreter Umsetzungshinweis: Schritte Claim, Connectivity, Kamera, Control-Ack, Hardware-E-Stop, Access, Moderation, Preview, Publish; Fortschritt serverseitig.
  - Akzeptanzkriterium: Neuer Host kann ohne externe Doku einen Testrobot veröffentlichen; Safetyschritte sind nicht überspringbar, wenn Public Control aktiviert wird.
  - Geschätzter Aufwand: groß

- [x] **Queue-, Robot- und Finanzbenachrichtigungen ergänzen**
  - Umgesetzt und geprüft (18.07.2026): Persistente Outbox, In-App-Center, E-Mail/Browserhooks, Präferenzen, Quiet Hours, Deduplizierung und sichere Templates liefern Turn-, Offline-, Payment- und Payoutstatus genau einmal; Service-Tests sind grün.
  - Priorität: P3
  - Kategorie: Feature
  - Problem: **Idee.** Browsernotification-Einstellung existiert, aber kein vollständiger Notification-Lifecycle für Turn, Offline, Zahlung oder Payout.
  - Risiko/Auswirkung: Nutzer verpassen ihren Turn; Hosts und Käufer bemerken Fehler spät.
  - Ziel: Opt-in In-App/Browser/E-Mail-Benachrichtigungen mit Präferenzen.
  - Betroffene Dateien/Bereiche: Settings; Jobs/Mail; Web Push; Queue/Billing/Payout/Robot Events.
  - Konkreter Umsetzungshinweis: Eventoutbox, deduplizierte Templates, Quiet Hours, Consent und Unsubscribe; keine sensiblen Inhalte auf Lockscreen.
  - Akzeptanzkriterium: Turn-soon/turn-now, robot-offline, payment-final und payout-status werden genau einmal entsprechend Präferenz zugestellt.
  - Geschätzter Aufwand: groß

- [ ] **Produktanalytics mit Daten- und Consentplan aufbauen**
  - Technisch umgesetzt und geprüft (18.07.2026): Versioniertes minimiertes Eventschema, Consent-Gate, Owner/Retention, Cleanup und Admin-Dashboard für Discovery, Hostaktivierung, Turns und Monetarisierung sind integriert und getestet. Externer Abnahmeblocker: Die geforderte Datenschutzprüfung der Metrikzwecke und Rechtsgrundlage muss der Betreiber abschließen.
  - Priorität: P3
  - Kategorie: Produkt
  - Problem: **Idee/Prüfpunkt.** AnalyticsEvents existieren für Sessions, aber kein konsistentes Aktivierungs-/Conversionmodell oder Betreiber-Dashboard.
  - Risiko/Auswirkung: Produktentscheidungen stützen sich auf unvollständige Daten; unkontrolliertes Tracking wäre compliancekritisch.
  - Ziel: Minimales Eventmodell für Discovery, Hostaktivierung, Turnerfolg und Monetarisierung.
  - Betroffene Dateien/Bereiche: AnalyticsEvent; Maintenance; Web/API Events; Admin-Dashboard; Privacy/Cookie.
  - Konkreter Umsetzungshinweis: Zweckgebundene Events ohne unnötige PII; Eventschema/Version; Retention; Consententscheidung vor externem Tracking; Qualitätsmetriken.
  - Akzeptanzkriterium: Metrikdefinitionen sind reproduzierbar; Events haben Owner/Retention; Datenschutzprüfung abgeschlossen.
  - Geschätzter Aufwand: groß

- [x] **Performance- und Safetyclaims nur aus reproduzierbaren Benchmarks ableiten**
  - Umgesetzt und geprüft (18.07.2026): Unbelegte quantitative Claims wurden entfernt; Queue- und Safetyprotokolle dokumentieren Umgebung, p50/p95, Datum und Reproduktionsbefehl, Hardwareaussagen bleiben bis zur Messung unveröffentlicht.
  - Priorität: P3
  - Kategorie: Produkt
  - Problem: **Gefunden.** README/Produkttexte nennen etwa 150 ms und automatische 300-ms-Sicherheit ohne passenden Nachweis.
  - Risiko/Auswirkung: Falsche Erwartung und Vertrauensverlust, bei Robotik potenziell sicherheitsrelevant.
  - Ziel: Claims besitzen Messmethode, Bedingungen und aktuelle Resultate.
  - Betroffene Dateien/Bereiche: README; Landing/Pricing/Docs; Benchmark-Suite.
  - Konkreter Umsetzungshinweis: Control- und Video-Latenz unter definierten Regionen/Netzen/Hardware messen; p50/p95 statt Einzelwert; Safetyclaim nur nach erzwungener Implementierung.
  - Akzeptanzkriterium: Jeder quantitative Claim verlinkt auf reproduzierbaren Bericht und Datum; sonst wird er entfernt oder als Zielwert bezeichnet.
  - Geschätzter Aufwand: mittel

- [x] **Release Notes und Betreiber-Changelog etablieren**
  - Umgesetzt und geprüft (18.07.2026): Keep-a-Changelog, Releasevorlage und SHA-gepinnter Releaseworkflow enthalten Migration, ENV, Protokolländerung, Upgrade und Rollback; Monorepoversionen sind konsistent.
  - Priorität: P3
  - Kategorie: Doku
  - Problem: **Gefunden.** Es gibt keine verlässliche, mit Migrationen/Breaking Changes gekoppelte Releasehistorie.
  - Risiko/Auswirkung: Betreiber übersehen ENV-, Schema-, Robot-Protokoll- und Sicherheitsänderungen.
  - Ziel: Jede Version dokumentiert Upgrade, Migration, Rollback und Breaking Changes.
  - Betroffene Dateien/Bereiche: CHANGELOG; Releaseworkflow; Docs; package versions.
  - Konkreter Umsetzungshinweis: Keep-a-Changelog/SemVer-Konvention, Changesets oder vergleichbarer Prozess; Securityhinweise separat; automatisch im Release verlinken.
  - Akzeptanzkriterium: Nächster Release enthält vollständige Notes, Upgrade-/Rollback-Schritte und Migrationshinweis; Versionen im Monorepo stimmen.
  - Geschätzter Aufwand: klein

## Abschlussbewertung nach der Sanierung

### Ist das Projekt aktuell release-ready?

**Noch nicht für einen öffentlichen Produktionsstart.** 75 von 85 Audit-Punkten sind praktisch umgesetzt und mit lokalen Tests oder Betriebsnachweisen belegt. Die ursprünglichen technischen P0-/P1-Defekte bei Migration, Geldflüssen, Control-Safety, Zugriff, Secrets, Dependencies, Tests, Builds und Dev-Betrieb sind behoben. Alle lokal technisch ausführbaren Prüfungen sind abgeschlossen; die übrigen zehn offenen Punkte benötigen objektiv externe Konten, Repositoryfreigaben, juristische Entscheidungen oder physische Robot-/Kamerahardware.

Monetarisierung, Payouts, Subscriptions und bezahlte Controls bleiben standardmäßig fail-closed. Ein Go-live ist erst verantwortbar, wenn die jeweils aktivierten Produktbereiche auch ihre unten dokumentierte externe Abnahme besitzen.

### Technischer Abschlussstand

- Produktionsbuild, Lint, Typecheck, API-/Web-Coverage, Chromium-E2E, Bundlebudgets, File-Secrets, Compose-, ENV- und Architekturprüfungen sowie 18 mobile Lighthouse-Läufe auf sechs Kernrouten sind grün.

### Verbleibende externe Abnahmen

- PayPal-Capture im echten Sandboxkonto mit Client-Credentials und Webhook-ID.
- Commit/Push der GitHub-Workflows, Branch-Protection und ein Lauf auf einem leeren GitHub-Runner.
- Juristische Freigabe für Finanzaufbewahrung, Rechtstexte, Checkout-Einwilligung sowie Cookie-/Storage-Kategorien.
- Reale Provider-/Bankreferenz sowie Betreiberentscheidungen zu KYC und Steuerprozess für Payouts.
- 30-Minuten-Vier-Kamera-Messung und vollständiger Go-live-Pfad mit physischem Robot-Client, Kamera, Control-ACK und Hardware-E-Stop.
- Datenschutzfreigabe für Zwecke und Rechtsgrundlage der Produktanalytics.

Offene Checkboxen stehen ausschließlich für diese noch nicht erbrachten externen Akzeptanznachweise; technisch implementierte Teilstände sind direkt am jeweiligen Punkt dokumentiert.
