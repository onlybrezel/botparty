# Observability- und Betriebsaudit

Stand: 18.07.2026.

## Logs

API-Logs sind strukturiert und enthalten UTC-Zeit, Level, Request-ID, Correlation-ID und Instanz-ID. Benutzer-/Robotkontext wird nur als interne ID und nur dort protokolliert, wo es für Diagnose oder Audit nötig ist. Authheader, Cookies, Tokens, Passwörter, API-Schlüssel, Payout-Ziele und Uploadinhalte werden redigiert beziehungsweise nicht geloggt. Stacktraces bleiben intern.

Nginx protokolliert Status, Gesamtdauer, Upstreamadresse, Upstreamstatus und Upstreamdauer. Genau diese Felder machten den DNS-/Drain-Fehler reproduzierbar. Docker-Logrotation ist konfiguriert; Promtail/Loki sind als optionales, read-only angebundenes Profil vorhanden.

## Healthchecks

- `/api/v1/health/live`: ausschließlich Prozesslebendigkeit; bleibt bei Datenbank-/Redis-/Storage-Ausfall 200.
- `/api/v1/health/ready`: prüft PostgreSQL, Redis, Queuezustand, MinIO, LiveKit, Migrationszustand und notwendige Konfiguration mit begrenzten Timeouts.
- `/web-health/live`: Web-Prozessprobe mit Instanzmarker; Nginx enthält einen begrenzten Legacy-Rollbackpfad.

Die Trennung wurde final erneut durch Stoppen von Redis, PostgreSQL und MinIO sowie zuvor mit LiveKit geprüft. Datenbank-, Redis- und Storage-Ausfälle lieferten jeweils Liveness 200 und Readiness 503 mit komponentengenauer Checkmatrix; nach Neustart kehrte Readiness auf 200 zurück. Externe Kurzstörungen lösen keinen Containerrestart über Liveness aus.

## Metriken

Erfasst werden HTTP-Anzahl, Status/Fehlerrate, Histogramme und p50/p95/p99, Datenbank- und Redis-Latenz, Queuezustand/Jobfehler, Worker-/Schedulerstatus, Event-Loop-Lag, Prozessspeicher und CPU, LiveKit/Storage-Zustand sowie Backupstatus. cAdvisor und Node Exporter ergänzen Containerrestarts, Hostressourcen, freien Speicher und Volumenwachstum.

Im isolierten Stack waren beide API-Ziele, cAdvisor und Node Exporter in Prometheus `up`. 25 Alertregeln wurden geladen; `promtool` und die Alert-Regeltests bestanden.

## Alarmierung

Regeln decken API-Ausfall, erhöhte 5xx-Rate, hohe p95-Latenz, Event-Loop-Lag, Datenbank-/Redis-/Storage-Probleme, Queue-Stau, Job- und Backupfehler, Speicher-/Plattenknappheit, Containerrestarts und Zertifikatsablauf ab. Zeitfenster und `for`-Dauern vermeiden Einzelspike-Alarme. Alertmanager benötigt eine Betreiber-Webhook-URL aus Secret-Datei.

Die Operatorseite muss vor Produktion Empfänger, Eskalationskette und Wartungsfenster testen; die Software erfindet keine Bereitschaftsorganisation.
