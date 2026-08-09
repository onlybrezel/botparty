# Systemanforderungen und Performance-Sizing

Stand: 9. August 2026

## Benchmark-Referenz

| Komponente     | Referenzsystem                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| CPU            | AMD EPYC 7502P, 1 Sockel, 32 physische Kerne, 64 Hardware-Threads, SMT 2                    |
| NUMA           | 1 Node                                                                                      |
| RAM            | 134.912.626.688 Bytes (125,6 GiB), 4 GiB Swap                                               |
| Betriebssystem | Ubuntu 24.04.4 LTS, Linux 6.8.0-134-generic, x86-64                                         |
| Runtime        | Node.js 24.19.0, pnpm 9.15.4                                                                |
| Container      | Docker Engine 29.7.2, Docker Compose 5.4.0, cgroup v2                                       |
| Datenhaltung   | PostgreSQL 16 Alpine, Redis 7 Alpine                                                        |
| Commit         | `8761fa523b773ccd6df02b97b2f6679c5187b941` mit den in diesem Lauf dokumentierten Änderungen |

Die Hardwaredaten liegen maschinenlesbar in
`data/performance-matrix/host-reference.json`. Alle Läufe verwendeten getrennte
Docker-Netze und Volumes. Ein Host-Gate akzeptierte Messungen nur bei mindestens
75 % Host-Idle und einer 1-Minuten-Load unter 16. Die CPU-, RAM-,
Throttle-, Restart-, OOM-, Event-Loop- und GC-Werte wurden im Sekundentakt aus
cgroup v2 und den Prometheus-Runtime-Metriken erfasst.

## Lastmodell

Der gemischte API-Test bildet folgende Verteilung ab:

- 55 % öffentliche Discovery- und Statistik-Lesezugriffe
- 15 % authentifizierte Benutzerzugriffe
- 12 % Benachrichtigungen mit Pagination und Unread-Zähler
- 8 % Wallet-Lesezugriffe
- 5 % Profil-Schreibzugriffe
- 5 % Analytics-Schreibzugriffe

Die Profile verwenden 4 bis 320 parallele Clients und kleine, mittlere oder
große Datenbestände. Das große Fixture enthält 15.027 Roboter, 150.055 Sessions,
300.000 Benachrichtigungen sowie jeweils 600.000 Audit- und Analytics-Einträge.
Weitere Szenarien für Login, reine Schreiblast, Datei-I/O, WebSockets und
öffentliche Lesezugriffe sind über `scripts/performance-load.mjs` auswählbar.

## Vorher-/Nachher-Matrix

| Profil                        |   vCPU/Threads | API-RAM |  Vorher RPS | Nachher RPS |      Nachher p95/p99 | Max Memory Peak | Empfohlener Einsatzzweck                 |
| ----------------------------- | -------------: | ------: | ----------: | ----------: | -------------------: | --------------: | ---------------------------------------- |
| Ultra-Low / Edge              | 0,5 / 1 Worker | 384 MiB | Startfehler |       99,90 |   101,10 / 197,90 ms |         192 MiB | Private Edge-Installation, kleine Flotte |
| Minimal / Small VPS           |   1 / 1 Worker |   1 GiB |      158,13 |      287,18 |    96,50 / 173,35 ms |         232 MiB | Kleine VPS oder Hobby-Community          |
| Standard / Recommended        |   4 / 4 Worker |   4 GiB |      347,40 |      943,56 |    91,90 / 152,30 ms |         465 MiB | Normale Produktion mit Redundanz         |
| High-Performance / Production |   8 / 8 Worker |  16 GiB |      591,54 |    2.485,58 |    94,57 / 166,10 ms |         568 MiB | Hohe dauerhafte API-Last                 |
| Enterprise / Heavy Scale      | 16 / 16 Worker |  32 GiB |      564,22 |    2.759,87 |    79,15 / 110,89 ms |         587 MiB | Große Einzelhosts oder Orchestrator      |
| Hyperscale / Bare Metal       | 32 / 32 Worker |  64 GiB |    1.012,09 |  1.988,63\* | 277,59 / 379,11 ms\* |         583 MiB | Bare Metal mit getrenntem DB-Tier        |

\* Der optimierte Hyperscale-Lauf überlappte auf ausdrückliche Freigabe mit
fremder Last auf demselben Host (`measurementQuality.accepted=false`). Er hatte
keine Fehler, Restarts oder OOM-Kills, ist aber nicht direkt mit den isolierten
Werten vergleichbar.

Gegenüber der Baseline steigt der erfolgreiche Durchsatz im isolierten
High-Performance-Profil um 320 % und im Enterprise-Profil um 389 %. Von 8 auf
16 API-vCPU steigt er nur noch um 11 %. Der aktuelle Single-Host-Aufbau skaliert
damit nicht annähernd linear bis 32 oder 64 Threads. Ab Profil 5 begrenzen der
gemeinsame PostgreSQL-Write-Pfad, konkurrierende Updates auf denselben Benutzer
und der 2-vCPU-Lastgenerator den Durchsatz. Für weitere Skalierung sind ein
externer PostgreSQL-Cluster, mehrere Lastgeneratoren und nach Schlüssel
partitionierte Schreiblast erforderlich; zusätzliche API-Worker allein reichen
nicht.

`Memory Peak` ist `memory.peak` des größten API-Containers einschließlich
Warm-up und Messphase. Bei mehreren API-Containern ist dies kein Summenwert.
RPS zählen ausschließlich erfolgreiche HTTP-Antworten. p95/p99 beziehen sich
ebenfalls nur auf erfolgreiche Antworten.

### Runtime-Beobachtungen nach der Optimierung

| Profil           | API CPU Ø / Peak | Event-Loop p99 / Max | beobachtete GC-Zyklen | gedrosselte CPU-Perioden | API-Restarts / OOM |
| ---------------- | ---------------: | -------------------: | --------------------: | -----------------------: | -----------------: |
| Ultra-Low        |        3 % / 5 % |    88,60 / 203,29 ms |                     0 |                163 / 260 |              0 / 0 |
| Minimal          |        1 % / 1 % |    72,61 / 105,58 ms |                     0 |                153 / 194 |              0 / 0 |
| Standard         |    133 % / 389 % |    54,53 / 112,85 ms |                    17 |                339 / 771 |              0 / 0 |
| High-Performance |    271 % / 775 % |    47,32 / 132,12 ms |                   0\* |              630 / 1.541 |              0 / 0 |
| Enterprise       |    335 % / 946 % |    13,13 / 127,66 ms |                    92 |              118 / 2.909 |              0 / 0 |
| Hyperscale\*     |    291 % / 796 % |    20,35 / 167,64 ms |                    89 |               97 / 6.472 |              0 / 0 |

100 % Docker-CPU entsprechen einem vollständig belegten logischen Prozessor.
Die Prometheus-Abfrage erreicht in einem Cluster-Container jeweils einen Worker;
Event-Loop- und GC-Werte sind deshalb beobachtete Worker-Werte, keine garantierte
Summe aller Worker. Ein Zählerwechsel zwischen zwei Workern kann negativ wirken
und wird in der Tabelle als 0 ausgewiesen. cgroup-CPU, Throttling, RAM und
OOM-Zustand gelten dagegen für den vollständigen Container.

## Sizing Guide

### Ultra-Low / Edge

- API: 0,5 vCPU, 384 MiB RAM, 1 Worker, 192 MiB V8 Old Space
- PostgreSQL: 0,5 vCPU, 512 MiB; Redis: 0,25 vCPU, 128 MiB
- Pool: 3 Verbindungen; maximal 8 parallele API-Anfragen
- Geeignet für private Edge-Installationen mit kleiner Flotte und niedriger
  Gleichzeitigkeit. Für Builds, Migrationen und Seed-Läufe vorübergehend 2 vCPU
  bereitstellen.

### Minimal / Small VPS

- API: 1 vCPU, 1 GiB RAM, 1 Worker, 512 MiB V8 Old Space
- PostgreSQL: 1 vCPU, 1 GiB; Redis: 192 MiB
- Pool: 6 Verbindungen; maximal 24 parallele API-Anfragen
- Geeignet für kleine öffentliche Instanzen und Hobby-Communities.

### Standard / Recommended

- API: 2 Container × 2 vCPU und 2 GiB RAM; 4 Worker insgesamt
- PostgreSQL: 2 vCPU, 4 GiB; Redis: 512 MiB
- Pool: 8 Verbindungen je Worker, maximal 48 parallele Anfragen je Container
- Empfohlene Untergrenze für Produktion mit Redundanz.

### High-Performance / Production

- API: 4 Container × 2 vCPU und 4 GiB RAM; 8 Worker insgesamt
- PostgreSQL: 4 vCPU, 8 GiB; Redis: 1 vCPU, 512 MiB
- Pool: 10 Verbindungen je Worker
- Für hohe dauerhafte Last und Rolling Deployments.

### Enterprise / Heavy Scale

- API: 8 Container × 2 vCPU und 4 GiB RAM; 16 Worker insgesamt
- PostgreSQL: 8 vCPU, 16 GiB; Redis: 2 vCPU, 1 GiB
- Pool: 12 Verbindungen je Worker
- Für große Einzelhosts oder einen Orchestrator mit getrenntem Datenbank-Tier.

### Hyperscale / Bare Metal

- API: 16 Container × 2 vCPU und 4 GiB RAM; 32 Worker insgesamt
- PostgreSQL: 16 vCPU, 32 GiB; Redis und Gateway: jeweils 4 vCPU
- Gemessenes Stack-Limit: 56 vCPU und 100 GiB; der Rest bleibt für
  Load-Generator, Kernel, Dateicache und Systemreserve frei.
- Poolbudget: 384 API-Verbindungen bei `max_connections=420`.
- Für 64 API-Worker muss die Datenbank extern laufen oder der Host mehr als 64
  Threads bereitstellen. Auf dem Referenzhost sind 32 API-Worker plus lokales
  PostgreSQL die ausgewogene Grenze.

## Technische Konfiguration

### CPU und Prozesse

- `scripts/api-cluster.mjs` erkennt cgroup-v2-CPU-Quoten und startet bis zu 64
  Node-Worker. `API_WORKERS` kann die Erkennung explizit überschreiben.
- Ein Worker läuft pro zugeteilter vCPU. Docker-Compose-Replikate verteilen die
  Worker über getrennte cgroups und Nginx verteilt per DNS-Upstream.
- `UV_THREADPOOL_SIZE` reicht profilabhängig von 2 bis 8. Mehr Threads werden
  nicht pauschal erzeugt, da der Test überwiegend Netzwerk- und Datenbank-I/O
  ausführt.
- Der Cluster berechnet ohne explizites `NODE_OPTIONS` ein Heap-Limit aus dem
  cgroup-RAM: 65 % des Containerlimits werden gleichmäßig auf die Worker
  verteilt, begrenzt auf 128 bis 2.048 MiB je Worker.

### Datenbank

- Die Prisma-Pools skalieren je Profil von 3 bis 12 Verbindungen pro Worker.
  `Worker × connection_limit` bleibt unter PostgreSQL `max_connections` und
  lässt Reserve für Migration und Administration.
- Neue zusammengesetzte Indizes decken die Discovery-Sortierungen nach
  Erstellungszeit, Sessionzahl, Featured-Status und Viewerzahl ab.
- Die Notification-Pagination nutzt einen deterministischen Index auf
  `(userId, createdAt DESC, id DESC)`; Liste und Unread-Zähler laufen parallel.
- Öffentliche API-Projektionen laden nur die tatsächlich ausgelieferten Felder.

### Cache und Speicher

- Öffentliche Robot-Listen besitzen pro Worker einen 5-Sekunden-Cache mit
  Single-Flight gegen Cache-Stampedes und einem festen Maximum von 64 Einträgen.
- Schreibvorgänge invalidieren den lokalen Discovery-Cache sofort; andere
  Replikate konvergieren spätestens nach fünf Sekunden.
- Große Datei-Endpunkte behalten Streaming beziehungsweise begrenzte Payloads;
  V8-Heaps sind pro Profil hart gedeckelt.
- Der Ultra-Low-Lauf verwendet längere Redis-Verbindungsfristen, damit starke
  CPU-Drosselung nicht zu einem Startloop führt.

### HTTP und Betriebssystemgrenzen

- Nginx nutzt automatische Worker-Prozesse, 8.192 Verbindungen pro Worker,
  Upstream-Keep-Alive und deaktiviertes Access-Logging im Benchmark.
- Fastify hört mit Backlog 2.048; Keep-Alive liegt bei 65 Sekunden,
  `headersTimeout` bei 66 Sekunden und `requestTimeout` bei 30 Sekunden.
- Das API-Limit für offene Dateien liegt bei 65.536.
- `MAX_CONCURRENT_REQUESTS` und `MAX_CONCURRENT_LOGIN_REQUESTS` begrenzen Last
  vor Heap, Passwort-Hashing und Datenbankpool.

## Reproduzieren

```bash
# Baseline oder optimierter Lauf; optional Profile per Komma begrenzen
PERFORMANCE_MATRIX_PHASE=optimized \
PERFORMANCE_MATRIX_PROFILES=ultra-low,minimal,standard,high-performance,enterprise,hyperscale \
./scripts/run-performance-matrix.sh

# Verifikation
pnpm test
pnpm typecheck
```

Rohdaten liegen unter `data/performance-matrix/<phase>/<profil>/`. Ein Lauf ist
nur vergleichbar, wenn `measurementQuality.accepted=true`, keine API-Restarts
und keine OOM-Kills vorliegen.

## Grenzen der Messung

- Der Referenzhost hat 32 physische Kerne und 64 SMT-Threads. SMT entspricht
  nicht der Leistung von 64 physischen Kernen.
- API, PostgreSQL, Redis, Gateway und Load-Generator teilen sich einen Host.
  Die Matrix misst daher das vollständige Single-Host-System, nicht nur einen
  isolierten HTTP-Prozess.
- Lineare Skalierung endet, sobald Datenbank, gemeinsame Schreibzeilen oder der
  Lastgenerator limitieren. Die gemessenen Werte sind Kapazitätsdaten, keine
  Garantie für andere Datenbestände oder Zugriffsmuster.
