# Finales Architektur-Audit

Stand: 18.07.2026. Grundlage sind Quellcode, Compose-Konfiguration, zwölf Prisma-Migrationen und die isolierten Docker-Prüfungen dieses Audits.

## Systembild

| Schicht | Implementierung | Kommunikation und Zustand |
| --- | --- | --- |
| Reverse Proxy | Nginx unprivileged 1.27 | HTTP(S), API-/Web-/WebSocket-/LiveKit-Routing, Ratenlimits, Security Header, dynamische Upstreams |
| Web | Next.js 15.5, React 19 | servergerenderte und clientseitige UI; REST, WebSocket und LiveKit über den Proxy |
| API | NestJS 11, Fastify 5, Node.js 24 | REST, WebSocket-Gateway, Auth, Robot-, Billing-, Wallet-, Moderations- und Betriebslogik |
| Datenbank | PostgreSQL 16, Prisma 6.19 | Primärdaten, Ledger, Idempotenz, Audit-, Queue-, Session- und Outboxzustand |
| Cache/Koordination | Redis 7, ioredis, BullMQ | globales Throttling, Queue, Pub/Sub, Locks, Turn- und Scheduler-Koordination |
| Echtzeitvideo | LiveKit Server, Ingress, Egress | WebRTC/WHIP, Aufnahme in S3-kompatiblen Storage |
| Objektspeicher | MinIO | private Robot-Thumbnails und Aufnahmen; Buckets/Policies über einmaligen Init-Container |
| Mail | SMTP-Adapter über Nodemailer | verifizierter Transport, Queue, kontrollierter Degraded-Zustand |
| Betrieb | Prometheus, Alertmanager, cAdvisor, Node Exporter; optional Loki/Promtail | Metriken, Alerts und strukturierte Containerlogs |

Das Repository ist ein pnpm-/Turbo-Monorepo mit `apps/api`, `apps/web`, gemeinsamen Paketen und Docker als verbindlichem Build-, Test- und Betriebsweg. API und Web laufen ohne beschreibbares Root-Dateisystem; der API-Entrypoint reduziert seine drei Secret-/UID-Drop-Capabilities vor dem Node-Prozess auf UID 1001. Web und Nginx laufen Non-Root ohne Capabilities. PostgreSQL und Redis sind nur im internen Docker-Netz; Nginx, Web, API, LiveKit und MinIO teilen ausschließlich die benötigten Frontend-Verbindungen.

## Daten- und Kontrollflüsse

1. Browserzugriffe enden an Nginx. REST-Anfragen gehen an eine von zwei API-Instanzen, Seiten an eine von zwei Web-Instanzen.
2. Zugriffstokens werden kurzlebig geprüft; Refresh-Cookies sind `HttpOnly`, Tokens sind über `tokenVersion`, Rollenwechsel, Passwortwechsel, Deaktivierung und Löschung widerrufbar.
3. Die API schreibt ausschließlich über `DATABASE_WRITE_URL`. `DATABASE_READ_URL` ist getrennt vorbereitet; sicherheits- und konsistenzkritische Reads bleiben auf Primary.
4. Redis koordiniert Ratenlimits, WebSocket-Instanzen, Jobs und verteilte Wartungs-/Scheduler-Locks. Bei Redis-Ausfall wird schreibende Schutzlogik fail-closed.
5. Avatar-, Thumbnail- und Recording-Daten gehen direkt von API/Egress zu MinIO. Dateien werden über kontrollierte API-/signierte Pfade ausgeliefert; private Robotdateien erst nach serverseitiger Eigentümer-/Staff-Prüfung. `/storage/` ist gesperrt.
6. Billing-Webhooks werden signiert geprüft, dedupliziert und transaktional in Ledgerzustand überführt. Payouts verwenden verschlüsselte Ziele und getrennte Requester-/Approver-/Payer-Akteure.
7. Löschungen externer Objekte werden als persistente Outbox-Aufgaben nachgeführt. Backups umfassen PostgreSQL und MinIO mit Manifest, Prüfsummen und optionaler Verschlüsselung.

## Rollen und Isolation

Es gibt die globalen Rollen `USER`, `MOD` und `ADMIN`. Ein separates Organisations-/Mandantenmodell existiert nicht. Die relevante Isolationseinheit ist der Benutzer als Robot-Eigentümer; private Robotdaten sind zusätzlich durch Sichtbarkeit und ACL geschützt. Das darf in Betrieb und Vertrieb nicht als vollwertiges B2B-Mandantenmodell bezeichnet werden.

## Skalierung, Redundanz und Wiederherstellung

- API und Web sind horizontal auf zwei Instanzen skaliert. Gemeinsame Zustände liegen in PostgreSQL/Redis/MinIO; die API-Instanz ist nicht sessiongebunden.
- Zwei Instanzen und health-gesteuertes Proxy-Draining liefern Anwendungsredundanz. Sie ergeben allein keine Hochverfügbarkeit der Gesamtplattform.
- PostgreSQL, Redis, MinIO, Nginx und die LiveKit-Komponenten sind in der gelieferten Compose-Topologie jeweils Single Points of Failure.
- `DATABASE_READ_URL` ist eine Lesereplica-Vorbereitung, kein Failover. Es wurde keine automatische Primary-Wahl behauptet oder implementiert.
- Backup/Restore schützt gegen Datenverlust, ersetzt aber weder Redundanz noch Hochverfügbarkeit. RPO und RTO wurden mangels Betreiberanforderung nicht erfunden.
- Disaster Recovery benötigt weiterhin externen, verschlüsselten Backup-Speicher, Secret-Escrow und regelmäßig terminierte Restore-Drills.

## Nachgewiesener Betriebsstand

Frischer Docker-Build, zwölf Migrationen, Seed, 21 Browser-/API-E2E-Tests, 611 API-Tests, 108 Web-Tests, Backup/Restore, Zwei-Instanz-Failover, Redis-/Datenbank-/MinIO-/LiveKit-Ausfall, abgewiesener Surge, Rollback und Rollforward wurden ausgeführt. Der öffentliche Produktivstart bleibt von den in `FINAL_PRODUCTION_READINESS_REPORT.md` genannten externen Freigaben abhängig.
