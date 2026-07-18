# Performance- und Lastaudit

Stand: 18. Juli 2026

Dieses Dokument ist der Einstieg in das abschließende messwertbasierte Performance-Audit. Frühere Health-/Stats-Durchsatzwerte sind keine Anwendungskapazität und werden deshalb nicht mehr als zentrale Kapazitätsaussage verwendet.

## Ergebnis

- Reproduzierbare Docker-Umgebung mit kleinen, mittleren und großen Fixtures
- reale Mixes für Reads, authentifizierte Reads/Writes, Login, Upload/Download und WebSocket
- Baseline, Stress/Spike, fünfminütiger Soak, Recovery, zwei APIs und Chaos unter Last ausgeführt
- öffentliche Statistik durch kurzen Snapshot und Refresh-Coalescing entlastet
- öffentliche Roboterabfragen auf notwendige, nicht sensitive Felder reduziert
- gemessenen Benachrichtigungsengpass mit partiellem Index beseitigt
- Admission-Control und separates Login-Bulkhead gegen CPU-/DB-Überlast ergänzt
- temporäre Datenbankausfälle als kontrollierte `503` statt unkontrollierte `500` behandelt
- konkurrierende erste Benachrichtigungseinstellungen ohne Unique-Fehler abgesichert
- Performance-Smoke-Test und regelmäßiger Workflow ergänzt

Die final gemessene 1-CPU-API erreichte auf dem großen Datensatz im Mixed-Profil 138,53 erfolgreiche Requests/s bei p95 326,14 ms, p99 543,99 ms und 0 Fehlern. Beim sofortigen Sprung auf 100 Clients wurden zusätzliche Requests kontrolliert als `503` abgewiesen; es gab keine `500` oder Timeouts. Direkt danach erholte sich dieselbe Instanz ohne Neustart auf 144,61 Requests/s bei p95 308,14 ms.

## Detaillierte Nachweise

- Testaufbau und Request-Mix: `PERFORMANCE_TEST_PLAN.md`
- Ausgangswerte: `PERFORMANCE_BASELINE.md`
- Engpässe und Query-Nachweise: `BOTTLENECK_ANALYSIS.md`
- Änderungen und Vorher-/Nachher-Werte: `PERFORMANCE_OPTIMIZATIONS.md`
- Stress, Spike, Chaos und Integrität: `STRESS_TEST_REPORT.md`
- Soak und Heap-Recovery: `SOAK_TEST_REPORT.md`
- Ressourcen- und Skalierungsgrenzen: `CAPACITY_MODEL.md`
- Überlastcodes und Recovery: `OVERLOAD_BEHAVIOR.md`
- reproduzierbare Betriebsbefehle: `PERFORMANCE_RUNBOOK.md`

## Verbleibende Grenzen

Die gemeinsame PostgreSQL-Primary ist bei zwei APIs der erste gemeinsame Skalierungsengpass; die zweite API brachte auf dem mittleren Datensatz 48 % mehr Durchsatz, keine Verdopplung. Drei APIs, Read Replica, WAN-Latenz, reale WebRTC-Medienlast und reale Fremddienste besitzen keine gemessene Kapazitätszahl. Die lokale fünfminütige Soak-Prüfung ersetzt außerdem keinen regelmäßigen mehrstündigen Dauerlauf.

## Abschlussprüfung

| Prüfung                      | Ergebnis                                                 |
| ---------------------------- | -------------------------------------------------------- |
| Lint                         | erfolgreich, 0 Fehler und 0 Warnungen                    |
| Typecheck                    | erfolgreich für API, Web und Shared                      |
| API Unit/Integration         | 66 Suites, 621/621 Tests                                 |
| Web Unit                     | 33 Dateien, 109/109 Tests                                |
| Kritisches API-Coverage-Gate | mindestens 90 % je Metrik, bestanden                     |
| Docker E2E                   | 21/21 Playwright-Tests; zwei APIs und zwei Web-Instanzen |
| Load-Balancer-Smoke im E2E   | 20/20, Verteilung 10/10, 0 Transportfehler               |
| Fresh-/Legacy-Migration      | 13 Migrationen, Drift 0, wiederholtes Deploy idempotent  |
| Finaler Performance-Smoke    | 4.434/4.434, 218,17 req/s, p95 101,38 ms, 0 Fehler       |
| API-/Web-Produktionsimages   | erfolgreich mit Node.js 24 gebaut                        |
| Web-Budgets                  | alle sieben geprüften Routen unter Budget                |
| Dependency-Audit             | keine bekannten Production-Schwachstellen                |
| Backup-/File-Secret-Smokes   | erfolgreich                                              |
| Nginx/Prometheus             | `nginx -t` erfolgreich; 27 Alert-Regeln gültig           |
| Repository-Diff              | `git diff --check` erfolgreich                           |

Ein zeitabhängiger Kontrolltest wurde während des Abschlusslaufs als Flake erkannt und auf eine feste Systemzeit umgestellt. Ein zusätzlich offener Test-HTTP-Listener wird nun explizit geschlossen; der isolierte Admission-Test beendet sich danach reproduzierbar in zehn Sekunden.
