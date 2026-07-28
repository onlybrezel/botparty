# Verhalten bei Überlast und Ausfällen

Stand: 18. Juli 2026

## Prioritäten

1. `/health/live`, `/health/ready` und Metrics bleiben vom lokalen Admission-Limit ausgenommen.
2. Normale Reads und Writes teilen eine begrenzte Anzahl aktiver Handler je API.
3. CPU-intensive Logins besitzen zusätzlich ein kleineres Bulkhead und können normale API-Arbeit nicht vollständig verdrängen.
4. Nginx begrenzt Quell-IP-Raten vor der API.
5. Redis-basierte verteilte Limits bleiben für zwei API-Instanzen konsistent und fallen bei Redis-Ausfall geschlossen aus.

Schreibaktionen werden nie als erfolgreich gemeldet, wenn sie nicht abgeschlossen wurden. Die Admission-Control weist vor Controller- und Datenbankarbeit ab.

## Statuscodes

| Situation                                     | Status | Header/Body                                         |
| --------------------------------------------- | ------ | --------------------------------------------------- |
| Nginx-Rate-Limit                              | `429`  | `Retry-After: 1`, konsistentes JSON                 |
| API hat alle aktiven Slots belegt             | `503`  | `Retry-After: 1`, `Service temporarily unavailable` |
| Login-Bulkhead belegt                         | `503`  | wie oben                                            |
| Redis für verteilten Schutz nicht verfügbar   | `503`  | fail-closed, keine lokale uneinheitliche Freigabe   |
| PostgreSQL startet/stoppt/verliert Verbindung | `503`  | sicherer zentraler Fehler, keine Connector-Details  |
| unbekannter interner Fehler                   | `500`  | wird nicht als Überlast umetikettiert               |

Clients sollen nur idempotente Reads automatisch mit Jitter und begrenztem Retry-Budget wiederholen. Writes benötigen ihren vorhandenen Idempotenzmechanismus; ein `503` ist kein Erfolgsnachweis. Der Server erzeugt selbst keine unkontrollierte Request-Retry-Schleife.

## Gemessene Grenzen

- Nginx, eine Quell-IP: etwa 30 erfolgreiche req/s, darüber schnelle `429`, keine `500`/Timeouts.
- 1-CPU-API, großer Datensatz, 100 Clients: 107,74 erfolgreiche req/s und 19.795 `503` in 20,29 s; p95 der Ablehnung 127,31 ms.
- Login, 1-CPU-Profil: maximal ein gleichzeitig zugelassener Login; 2.177 Requests eines Spikes wurden `503`, während Mixed-Last 68,56 req/s behielt.

## Recovery

Slots werden nach Antwort, Request-Abbruch oder tatsächlichem Abschluss der Serverarbeit freigegeben. Nach dem großen Spike erreichte die API ohne Neustart sofort 144,61 req/s bei p95 308,14 ms und 0 Fehlern. CPU fiel auf 0,31 %, PostgreSQL auf 0,01 %, aktive Requests auf 0.

Queue-Jobs bleiben in Redis/BullMQ und werden nach Worker-/Redis-Recovery weiterverarbeitet. Der Queue-Zustand ist durch Eindeutigkeitsregeln und atomare Positionsänderungen geschützt. Es wurde kein unbegrenzter In-Memory-Fallback ergänzt.

## Ausfallmatrix

| Komponente        | Sichtbares Verhalten                                                         | Wiederherstellung                                        |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| eine API von zwei | Nginx kann kurz `503` liefern; andere API hält Bearer-Session und Traffic    | Readiness nimmt die gestartete Instanz wieder auf        |
| PostgreSQL        | abhängige Requests `503`; Liveness bleibt verfügbar, Readiness wird ungesund | Pools verbinden sich nach DB-Start neu                   |
| Redis             | verteilte Schutz-/Queue-Pfade `503`; kein ungeschützter Mehrinstanzmodus     | Redis-Verbindung und Readiness erholen sich              |
| SeaweedFS         | Upload/Download schlägt explizit fehl; kein Erfolg ohne Objekt               | Storage-Readiness und neuer Versuch nach Dienst-Recovery |
| Mailpit/Fremdmail | E-Mail-Job bleibt retryfähig; API-Kerndaten bleiben erhalten                 | begrenzte Job-Retries/Backoff                            |

## Betreiber-Signale

- `botparty_concurrent_requests` zeigt aktive Slots.
- Admission-Rejections und HTTP `429`/`503` zeigen Schutzaktivierung.
- Event-Loop-p99 über 100 ms für zehn Minuten zeigt CPU-/Sync-Arbeit.
- 64 Datenbankverbindungen lösen vor `max_connections=80` einen Alert aus.
- Queue-Tiefe und Alter des ältesten Eintrags unterscheiden kurzfristigen Rückstand von einem festhängenden Worker.

Eine kurze externe Störung darf nicht über Liveness einen Neustart auslösen. Readiness entfernt dagegen eine Instanz, die zentrale Abhängigkeiten nicht bedienen kann.
