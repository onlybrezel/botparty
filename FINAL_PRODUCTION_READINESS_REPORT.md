# Finaler Produktionsreifebericht

Stand: 18.07.2026.

## Entscheidung

Der Docker-basierte technische Core ist für eine geschützte Staging-/Self-Hosting-Abnahme produktionsnah. Ein öffentlicher Go-live mit Zahlungen, Payouts oder realen Robots ist **bedingt freigabefähig**, nicht pauschal freigegeben: externe Provider-, Rechts-, Hardware- und Betreiberabnahmen fehlen. Die betroffenen Features sind ohne vollständige Konfiguration fail-closed.

## Untersuchte Komponenten und Rollen

Geprüft wurden Nginx, Next.js-Web, zwei NestJS/Fastify-APIs, PostgreSQL/Prisma, Redis/BullMQ/PubSub, LiveKit Server/Ingress/Egress, MinIO, SMTP-Adapter, Migration/Seed, Backup/Restore, Prometheus/Alertmanager/cAdvisor/Node Exporter, optionale Logpipeline, CI und Betriebsdokumentation. Rollen: `USER`, `MOD`, `ADMIN`; Isolation: Robot-Eigentümer A, fremder Benutzer B und anonym. Ein B2B-Tenantmodell existiert nicht.

## Gefundene und behobene Probleme

- uneinheitliche private Robot-/Datei-/Realtime-Autorisierung und direkt lesbare Thumbnails;
- Sitzungen nach sicherheitsrelevanten Kontoänderungen;
- prozesslokales Throttling, Scheduler- und Job-Deduplizierung;
- nicht atomare Limit-/Ledger-/Payout-/Webhookpfade;
- zu frühe PayPal-Gutschrift;
- verlorengehende Objektlöschungen und finanzschädliche Kontokaskaden;
- stale Rollenprüfung und getrennter Balance-Ledger-Commit bei parallelen Staff-Kontoänderungen/-löschungen;
- direkte Avatar-Storage-URLs sowie verwaisbare Avatar-/Thumbnail-/Recordingobjekte;
- fehlende Primary/Read-Verbindungstrennung;
- parallel mögliche Migrationen und fehlende Storage-Init-Reihenfolge;
- uneinheitliche Fehler/Healthchecks/Logs/Metriken;
- Nginx-502-Fenster beim Entfernen alter Peers und bei vorzeitig sichtbaren Surge-Replikas sowie Legacy-Web-Health beim Rollback;
- Non-Root-TLS-Start mit üblichen Zertifikatrechten und veralteter Restore-Smoke nach der Eigentümerhärtung;
- nicht deterministischer beziehungsweise `.env`-abhängiger API-Client-Export;
- lückenhafte E2E-/CI-/Backup-/Self-Hosting-Pfade.

Alle genannten technischen Befunde wurden im Repository repariert und mit Regressionstests oder realen Dockerproben erneut geprüft.

## Ergänzte Regressionstests

- API: Auth-/Tokenwiderruf, Rollenmatrix, IDOR/Eigentümerzugriff, Redis-Throttling, Cross-Instance-WebSocket/PubSub, Queue-/Cron-Deduplizierung, Limits, Wallet/Donation/Payout/Billing, PayPal-Capture/Timeout, Storage-Outbox, Avatar-/Thumbnail-Kompensation und Konto-/Robotlöschung.
- Datenbank/Betrieb: echte PostgreSQL-/Redis-Testcontainer, frische und Legacy-Migration, Drift/Wiederholung, verschlüsselter Backup-Roundtrip, falscher Schlüssel/beschädigtes Archiv, Restore bis Login/Dateidownload sowie Health-/Alert-Regeltests.
- Browser/Docker: Eigentümer A gegen Benutzer B/anonym, private Robot-/Dateipfade, gefälschter Rollenheader, Avatar-Lifecycle, Auth, Host-Onboarding, CSP, Accessibility, Queue und Controls auf frisch gebauten Produktionsimages.
- Release: Dauerproben für Rollout, Rollback, Rollforward, abgewiesenen Surge und Ausfall einer von zwei API-Replikas; PostgreSQL-, Redis- und MinIO-Ausfall mit Wiederverbindung.

## Geänderter Dateiumfang

- Backend und Tests: `apps/api/src/{auth,billing,common,controls,earnings,filters,gateway,health,jobs,livekit,mail,maintenance,moderation,notifications,prisma,queue,redis,robots,sessions,storage,users,wallet}`.
- Frontend und Browsertests: `apps/web/src`, `apps/web/tests`, `apps/web/playwright.config.ts` und `apps/web/next.config.ts`. Der im Produktionsaudit geprüfte, aber zur Laufzeit ungenutzte generierte Client wurde im anschließenden Wartbarkeitsaudit entfernt; OpenAPI und die generierte Referenz bleiben erhalten.
- Datenbank: `packages/prisma/prisma/schema.prisma` und die drei neuen `20260718_*`-Migrationen für Storage-Outbox, private Thumbnails und Avatar-Proxy-Backfill.
- Container/Betrieb: `docker-compose*.yml`, `docker/api`, `docker/nginx`, Prometheus/Loki/Promtail-Konfiguration, `ops.sh`, `setup-env.sh` und Backup-/Restore-/Smoke-/Generator-Skripte unter `scripts`.
- Lieferkette/Dokumentation: `.github/workflows`, `.env.example`, Root-/Workspace-Paketkonfiguration, Lockfile, README, Runbook, OpenAPI/API-Client-Dokumentation, `AUDIT.md` und die 16 Abschlussberichte.

Der Produktionsaudit umfasste 231 geänderte oder neue Pfade einschließlich der damals generierten API-Clientdateien und Berichte. Der anschließende Wartbarkeitsaudit hat nicht genutzte generierte Artefakte entfernt. Es wurde kein Commit erzeugt und kein fremder Arbeitsstand zurückgesetzt.

## Abschlussprüfungen

| Prüfung | Ergebnis |
| --- | --- |
| frischer Docker-E2E-Build/Migration/Seed | erfolgreich |
| E2E Browser/API | 21/21 bestanden |
| API Unit/Integration | 65/65 Suites, 608/608 Tests einschließlich PostgreSQL-/Redis-Testcontainern |
| Web Unit | 33/33 Dateien, 109/109 Tests |
| Lint | 0 Fehler, 0 Warnungen |
| Typecheck | erfolgreich |
| Produktions-Build / Webbudgets | erfolgreich |
| Migration 0→aktuell, Legacy, Wiederholung, Drift | erfolgreich, 12 Migrationen |
| verschlüsseltes Backup/Restore und Negativfälle | erfolgreich; finaler Vollrestore nach allen API-Korrekturen 30 s |
| API-Ausfall / Redis / PostgreSQL / MinIO / LiveKit | kontrolliert wie dokumentiert |
| zwei API-Instanzen | erfolgreich, beide Instanz-IDs unter Last |
| Rollout / Rollback / Rollforward | 25.446 / 23.595 / 22.762 Antworten, ausschließlich HTTP 200; keine Verbindungsfehler |
| abgewiesener ungesunder Surge | 9.958/9.958 HTTP 200 über alte Replikas, null Fehler |
| finaler Keep-alive-Rollout | 146.191 HTTP 200; 7 rohe Socket-Reconnects von 146.198 Versuchen (0,0048 %), 0 HTTP-Fehler |
| Lasttest | bis 1.463,51 rps kurz; 0 Fehler |
| OpenAPI-/Referenz-Drift | 110 Pfade/126 Operationen; deterministische Generierung |
| Produktions-/vollständiger Dependency-Audit | keine bekannten Schwachstellen; Exit 0 |
| Bash/ShellCheck / Compose-Rendering | ohne Befund; Produktion, Entwicklung und E2E gültig |
| gehärtetes HTTPS-Profil | UID 101, read-only, keine Capabilities, TLS/Redirect/Liveness erfolgreich |
| Abschließender Diff-/Secret-Check | `git diff --check` Exit 0; keine Hochkonfidenztreffer |

## Single Points of Failure

Nginx, PostgreSQL-Primary, Redis, MinIO und jede LiveKit-Rolle sind in der Referenz-Compose-Topologie einzelne Knoten. Zwei API-/Web-Replikas liefern horizontale Skalierung und Anwendungsredundanz, aber keine vollständige HA. Read Replica und Backup sind kein automatisches Failover.

## Verbleibende Punkte

| Priorität | Komponente / Auswirkung | Reproduktion/Ursache | Verbindlicher nächster Schritt |
| --- | --- | --- | --- |
| P0 extern | PayPal/Stripe; reale Geldbewegung nicht endabgenommen | Sandbox-Credentials/Webhook-ID fehlen; Code bleibt deaktiviert | Provider-Sandbox mit echten signierten Webhooks, Capture, Refund und Replay abnehmen |
| P1 extern | Recht/Datenschutz; Texte und Retention ohne Rechtsfreigabe | Betreiber-/Rechtsentscheidung fehlt | finale Fassungen, Rechtsgrundlagen, Cookiekategorien und Aufbewahrungsmatrix freigeben |
| P1 extern | Payout/KYC/Steuer; keine reale Auszahlung | Bank-/Providerkonto und Complianceprozess fehlen | kontrollierten Drei-Akteur-Sandboxlauf mit realer Referenz abnehmen |
| P1 extern | GitHub-Gates; lokale Checks noch nicht branchpflichtig | kein Commit/Push/Branch-Protection in diesem Auftrag erlaubt | Änderungen reviewen, pushen, Actions grün ausführen und Checks verpflichtend setzen |
| P1 Betrieb | Gesamt-HA; Ausfall einzelner State-Dienste unterbricht Funktionen, Proxyreload rotiert einzelne Idle-Keep-alive-Sockets | Single-Node-Compose mit einem Nginx-Master | Betreiberarchitektur für Postgres/Redis/MinIO/Proxy/LiveKit samt Failover und gestaffeltem Proxyupdate testen |
| P2 extern | Robot-/Video-Sicherheit und Soak | physische Vier-Kamera-/E-Stop-Hardware fehlt | 30-Minuten-Hardwaretest, Temperatur/Bitrate/CPU und realen E-Stop abnehmen |
| P2 Betrieb | DR-Ziele | RPO/RTO und Offsite-Ziel nicht festgelegt | Anforderungen festlegen, WAL/PITR und terminierte Restore-Drills betreiben |

## Manuelle Freigaben vor Produktion

DNS/TLS, reale Secrets und Rotation, SMTP-Zustellung, Alertempfänger/Eskalation, Offsite-Backup und Restore aus diesem Ziel, Provider-Sandbox, Rechtstexte/Consent/Retention, KYC/Steuer, physische Robot-Safety sowie GitHub-Branch-Protection müssen von den jeweiligen Verantwortlichen bestätigt werden. Es wurden weder Produktivdaten noch produktive Provider angesprochen.
