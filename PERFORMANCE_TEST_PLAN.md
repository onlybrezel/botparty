# Performance-Testplan

Stand: 18. Juli 2026

## Ziel und Sicherheitsrahmen

Dieser Plan misst die Kapazität des realen Docker-Pfads und prüft kontrollierte Überlast. Alle Daten sind synthetisch, alle Ziele liegen in privaten Docker-Netzen. Mail geht ausschließlich an Mailpit, Dateien ausschließlich an den lokalen SeaweedFS-Testdienst. Das Lastwerkzeug lehnt öffentliche Ziele ab.

Abbruchkriterien sind Datenfehler, unkontrollierte `500`, ein OOM-Kill, wiederholte Containerneustarts, anhaltende Timeouts oder fehlende Erholung nach Lastende. Erfolgsantworten sind ausschließlich Status `2xx`/`3xx`; `429` und `503` werden getrennt als kontrollierte Überlast gezählt.

## Testsystem

Host:

- Intel Core i9-9900K, 8 Kerne/16 Threads, 62 GiB RAM
- Linux 6.8.0-136-generic, Docker Engine 29.6.2, cgroup v2
- lokales Docker-Bridge-Netz ohne künstliche Netzwerklatenz

Reproduzierbares Profil aus `docker-compose.yml` und `docker-compose.performance.yml`:

| Dienst        | Image/Laufzeit                         | Limit                     |
| ------------- | -------------------------------------- | ------------------------- |
| Nginx         | Reverse Proxy und Load Balancer        | 0,5 CPU, 256 MiB          |
| API           | Node.js 24.18.0, NestJS/Fastify        | 1 CPU, 768 MiB je Instanz |
| PostgreSQL    | PostgreSQL 16.14, `max_connections=80` | 2 CPU, 2 GiB              |
| Redis         | Rate-Limit, Queue und Pub/Sub          | 0,5 CPU, 256 MiB          |
| Web           | Next.js                                | 1 CPU, 768 MiB            |
| Lastgenerator | Node.js 24 Alpine                      | 2 CPU, 1 GiB              |
| Mailpit       | lokaler SMTP-Sink                      | 0,25 CPU, 128 MiB         |

PostgreSQL verwendet `shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=4GB`, `pg_stat_statements` und `track_io_timing`. Jede API hat einen Prisma-Pool mit maximal 10 Verbindungen, 3 Sekunden Pool-Wartezeit und 5 Sekunden Verbindungsaufbau. Zwei APIs beanspruchen damit höchstens 20 von 80 Datenbankverbindungen.

## Request-Pfad

`Lastgenerator → Nginx → Fastify Admission-Control → CSRF/Auth → Rollenprüfung → Service → Prisma-Pool → PostgreSQL`

Daneben verwenden Auth-Limits und Queues Redis. Uploads laufen über die API zum gemeinsamen SeaweedFS-Speicher. Health-Liveness bleibt unabhängig von Datenbank und Redis erreichbar; Readiness prüft erforderliche Abhängigkeiten.

## Reproduzierbare Datenprofile

`scripts/seed-performance.mjs` erzeugt deterministische UUIDs und Daten in Batches. Der Seed ist nur mit `PERFORMANCE_FIXTURE_ALLOW_WRITES=true` und ausschließlich für eine Datenbank namens `botparty_performance` freigeschaltet.

| Profil | Nutzer | Roboter | Sessions | Benachrichtigungen |   Audit | Analytics |    Chat | Queue |
| ------ | -----: | ------: | -------: | -----------------: | ------: | --------: | ------: | ----: |
| klein  |    100 |     500 |    5.000 |             10.000 |  20.000 |    20.000 |  10.000 |   100 |
| mittel |  1.000 |   5.000 |   50.000 |            100.000 | 200.000 |   200.000 | 100.000 | 1.000 |
| groß   |  2.500 |  15.000 |  150.000 |            300.000 | 600.000 |   600.000 | 300.000 | 1.000 |

Der bestehende Admin und zwei Baseline-Roboter kommen hinzu. Lange Beschreibungen, Tags, unterschiedliche Zustände, Historien und 1.000 Queue-Positionen decken Sortierungen, Filter, Relationen und Grenzdaten ab. Fixture-Zeitstempel werden relativ zur Ausführung erzeugt, damit Retention-Jobs die Testhistorie nicht vorzeitig löschen.

## Lastprofile

`scripts/performance-load.mjs` bietet folgende geschlossene Lastmodelle:

- `stats`: öffentliche aggregierte Statistik.
- `public-read`: gleichmäßig Listen nach Popularität und Neuheit, Suche, Featured, Overview und Statistik.
- `mixed`: 55 % öffentliche Reads, 15 % `/users/me`, 12 % Benachrichtigungen, 8 % Wallet, 5 % Profiländerungen, 5 % Analytics-Schreibzugriffe.
- `write`: wiederholte authentifizierte, idempotent verträgliche Profiländerungen.
- `login`: vollständiger CSRF- und Argon2-Login.
- `file`: 20 % echte JPEG-Uploads, 80 % Downloads über den gemeinsamen Speicher.
- `websocket`: Aufbau, Raumbeitritt und sauberer Verbindungsabbau.

Die Tests verwenden echte Authentifizierung. Simulierte Client-IP-Adressen aus `198.18.0.0/15` trennen Benutzerlimits; Nginx-Tests mit einer Quell-IP messen bewusst zusätzlich das Proxy-Limit.

## Teststufen

| Test              | Dauer und Last                                  | Zweck                                         |
| ----------------- | ----------------------------------------------- | --------------------------------------------- |
| Performance-Smoke | 20 s, 10 Clients, kleiner Datensatz             | grobe CI-Regression                           |
| Baseline          | 20–30 s, 20 Clients                             | reproduzierbarer Vergleich vor/nach Änderung  |
| Laststufe         | 20–30 s, 20/30/50 Clients                       | Knickpunkt von p95 und Durchsatz              |
| Stress/Spike      | 20 s, sofort 100 Clients                        | Admission-Control und kontrollierte Ablehnung |
| Soak              | 300 s, 20 Clients                               | Heap, Handles, GC und Latenztrend             |
| Recovery          | 20 s, 20 Clients direkt nach Stress             | selbstständige Normalisierung                 |
| Zwei APIs         | zwei parallele Generatoren mit je 30 Clients    | horizontale Skalierung und DB-Grenze          |
| Chaos             | Last während API-, DB- oder Redis-Unterbrechung | Fehlerformat, Datenintegrität, Recovery       |

Zielwerte des kleinen CI-Smoke-Tests sind p95 höchstens 1.000 ms, Fehlerquote 0 und mindestens 20 erfolgreiche Requests/s. Kapazitätswerte werden nicht aus diesem großzügigen Gate abgeleitet, sondern aus den dokumentierten Messläufen.

## Messgrößen

- Durchsatz, Statuscodes, Fehlerrate, p50/p90/p95/p99/maximal, Antwortbytes
- API-Instanz-Verteilung, CPU, RSS/Heap, Event-Loop-Lag, Containerneustarts/OOM
- PostgreSQL-CPU, Verbindungen, `pg_stat_statements`, Query-Pläne und Indexnutzung
- Redis-CPU/Speicher, Queue-Tiefe und ältester Eintrag
- Datenintegrität: Zählungen, Foreign-Key-Waisen, doppelte Queue-Positionen und aktive Sessions

## Befehle

Der vollständige Ablauf steht in `PERFORMANCE_RUNBOOK.md`. Der automatische Smoke-Test läuft mit:

```bash
sg docker -c './scripts/run-performance-smoke.sh'
```
