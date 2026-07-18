# Umgesetzte Performance-Optimierungen

Stand: 18. Juli 2026

## Anwendung

### Statistik-Snapshot

`HealthService.getPublicStats()` hält den öffentlichen Snapshot fünf Sekunden pro API-Instanz und führt gleichzeitige Refreshes zusammen. Die Werte dürfen kurz veraltet sein; Auth-, Rollen- und Read-after-write-Pfade werden nicht gecacht.

Gemessen: 201,79 auf 2.068,11 req/s, p95 127,64 auf 22,72 ms. Datenbank-CPU sank im Lauf von 201 % auf 3,25 %.

### Schlanke öffentliche Roboterprojektion

Öffentliche Listen und Featured verwenden `PUBLIC_ROBOT_SELECT`. Private Hashes, Claim-Tokens und nicht benötigte Spalten werden gar nicht erst aus PostgreSQL geladen.

Gemessen: 145,39 auf 157,89 req/s, p95 305,20 auf 284,96 ms.

### Kontrollierte Parallelität

Die API begrenzt aktive Handler je Instanz. `MAX_CONCURRENT_REQUESTS` ist im Performance-Profil 32 und standardmäßig 64. `MAX_CONCURRENT_LOGIN_REQUESTS` ist im 1-CPU-Profil 1 und standardmäßig 2. Liveness, Readiness und Metrics bleiben erreichbar. Abgelehnte Requests erhalten `503` und `Retry-After: 1`.

Die Freigabe erfolgt bei normaler Antwort, Request-Abbruch und nach Ende serverseitiger Arbeit. Dadurch erzeugt ein geschlossener Client-Socket weder einen permanent belegten Slot noch eine verfrühte Freigabe während einer laufenden Passwortprüfung.

Gemessen bei 100 Clients: vor der Grenze 110,06 req/s, 17 Timeouts, p99 4.845 ms; mit Limit 32 auf mittlerem Datensatz 174,58 req/s, keine Timeouts oder `500`.

### Sichere temporäre Datenbankfehler

Der zentrale Exception-Filter ordnet bekannte PostgreSQL-Shutdown-/Startup- und Verbindungsfehler aus Prisma `503` statt `500` zu und setzt `Retry-After`. Unbekannte Prisma-Fehler bleiben interne Fehler.

Gemessen im identischen DB-Chaoslauf: neun unkontrollierte `500` vor der Änderung, null danach.

### Race-freie Benachrichtigungseinstellungen

Gleichzeitige erste Zugriffe auf `notification_preferences` können bei Prisma trotz Upsert mit `P2002` kollidieren. Der Service übernimmt nach diesem eindeutig erkannten Fall den konkurrierend erzeugten Datensatz beziehungsweise führt das gewünschte Update anschließend aus. Andere Datenbankfehler werden weiterhin geworfen.

Gemessen: 100 parallele direkte Upserts reproduzierten zwei Unique-Fehler; der erste Fresh-Smoke meldete einen `500`. Nach der Korrektur bestanden 4.434/4.434 Requests in einer neu aufgebauten Docker-Umgebung.

## Datenbank

Migration `20260718_add_notification_unread_index` erstellt einen partiellen Index für ungelesene Benachrichtigungen:

```sql
CREATE INDEX "notifications_unread_user_expires_idx"
ON "notifications"("userId", "expiresAt")
WHERE "readAt" IS NULL;
```

Gemessen: Query 51,47 auf 7,899 ms, 0 Heap Fetches. Großer Mixed-Lauf 121,77 auf 138,53 req/s, p95 405,70 auf 326,14 ms. Eine leere Datenbank wurde mit allen 13 Migrationen neu aufgebaut und der partielle Index anschließend aus `pg_indexes` verifiziert.

Nicht übernommen wurden zwei experimentelle Roboter-Sortierindizes: PostgreSQL nutzte sie weder im mittleren noch im großen Test. So bleiben Schreib- und Speicherkosten ohne Messnutzen aus.

## Reverse Proxy

Nginx liefert bei eigenem Rate-Limit ein konsistentes JSON-Fehlerformat, `429` und `Retry-After: 1`. Health-Endpunkte bleiben außerhalb des allgemeinen Limits. `nginx -t` und ein realer Limitlauf bestätigten die Konfiguration.

## Runtime und Container

- Node.js 24.18.0 in den Produktionsimages.
- Prisma-Pool 10 Verbindungen pro API, Pool-Timeout 3 s, Connect-Timeout 5 s.
- PostgreSQL im Performance-Profil mit 80 Verbindungen, `pg_stat_statements` und I/O-Timing.
- Lastgenerator, Mailpit und Dienste besitzen CPU-/RAM-Limits; der Lastgenerator läuft read-only ohne Capabilities.
- Mail wird im Performance-Netz ausschließlich an Mailpit gesendet.

Die gemessene API-RSS blieb im fünfminütigen Soak stabil; eine Worker-Thread- oder Node-Cluster-Schicht wurde mangels CPU-Profil-Nachweis nicht ergänzt. Zwei Container sind die klarere horizontale Skalierung.

## Monitoring und Regression

Neue bzw. erweiterte Metriken erfassen aktive Requests, Admission-Rejections, Event-Loop-Lag, Datenbankverbindungen, Queue-Tiefe und ältesten Queue-Eintrag. Prometheus warnt bei anhaltenden Overload-Rejections, Event-Loop-p99 über 100 ms und 64 Datenbankverbindungen (80 % des Testmaximums).

`scripts/run-performance-smoke.sh` baut eine frische isolierte Umgebung, migriert, seedet das kleine Profil und prüft p95, Fehlerrate und Mindestdurchsatz. `.github/workflows/performance-smoke.yml` startet ihn manuell und wöchentlich; vollständige Stress-/Soak-Läufe bleiben bewusst außerhalb normaler Commit-CI.

## Regressionstests

- Cache-TTL und Coalescing der Statistik
- öffentliche Projektion ohne private Felder
- allgemeines und Login-spezifisches Admission-Limit
- Freigabe nach echtem Socket-Abbruch
- Health-Verfügbarkeit unter Überlast
- transiente und nicht transiente Prisma-Fehlerzuordnung
- konkurrierender erster Insert und Update von Benachrichtigungseinstellungen
- frische Migration einschließlich partiellem Index
- Performance-Smoke mit echten API-/DB-/Redis-Containern
