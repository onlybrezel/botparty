# Stress-, Spike- und Recovery-Bericht

Stand: 18. Juli 2026

## Lastgrenze ohne Admission-Control

Auf dem mittleren Datensatz blieb das gemischte Profil bei 20 und 30 Clients fehlerfrei. Bei 50 Clients wurden noch 195,41 erfolgreiche req/s erreicht, p95 stieg jedoch auf 619 ms. Bei 100 Clients fiel der erfolgreiche Durchsatz auf 110,06 req/s; es traten 17 Client-Timeouts auf, p99 lag bei 4.845 ms. Mehr Parallelität verringerte also die nutzbare Kapazität und hielt Arbeit unnötig lange im Prozess.

## Dimensionierung der Admission-Control

Die Grenzen 64, 48 und 32 wurden mit demselben 100-Client-Profil verglichen:

| Maximal aktive Requests | erfolgreicher Durchsatz | p95 erfolgreicher Requests | Verhalten                                                                 |
| ----------------------: | ----------------------: | -------------------------: | ------------------------------------------------------------------------- |
|                      64 |            110,00 req/s |      nicht separat erfasst | kontrollierte `503`, aber zu viel aktive Arbeit                           |
|                      48 |            132,80 req/s |                  884,90 ms | bessere Rate, noch hohe Tail-Latenz                                       |
|                      32 |            174,58 req/s |                  463,52 ms | bester getesteter Kompromiss; 18.734 schnelle `503`, keine Timeouts/`500` |

Das Performance-Profil verwendet deshalb 32 aktive Requests je API. Der Produktionsdefault bleibt 64, weil die Produktionscontainer 2 CPU/1.536 MiB besitzen; beide Werte sind validiert und konfigurierbar.

## Großer Datensatz: finaler Spike

Konfiguration: eine API mit 1 CPU/768 MiB, PostgreSQL 2 CPU/2 GiB, Redis 0,5 CPU/256 MiB, großer Datensatz, sofortiger Sprung auf 100 geschlossene Clients für 20,29 Sekunden.

| Messwert                         |             Ergebnis |
| -------------------------------- | -------------------: |
| Versuche                         |               21.981 |
| Erfolgreich                      | 2.186 / 107,74 req/s |
| Kontrollierte `503`              |               19.795 |
| `500`, Transportfehler, Timeouts |                    0 |
| p95 erfolgreich                  |            699,18 ms |
| p99 erfolgreich                  |            973,36 ms |
| p95 kontrollierte Ablehnung      |            127,31 ms |
| API-CPU während Last             |             101,51 % |
| PostgreSQL-CPU während Last      |             129,97 % |
| API-Speicher                     |  172 MiB von 768 MiB |

Die harte Grenze war CPU/DB-Arbeit, nicht RAM. Überlast wurde vor weiterer Arbeit abgewiesen und führte nicht zu Warteschlangenwachstum oder Retry-Stürmen.

## Recovery

Direkt nach dem Spike lief dasselbe große Mixed-Profil 20,11 Sekunden mit 20 Clients:

- 2.908/2.908 erfolgreich, 144,61 req/s
- p50 126,03 ms, p95 308,14 ms, p99 410,72 ms
- keine `429`, `503`, `500` oder Timeouts
- anschließend API 0,31 % CPU/170,3 MiB, PostgreSQL 0,01 %, Redis 0,51 %
- kein Containerneustart und kein manueller Eingriff

## Login-Spike und Bulkhead

Vier gleichzeitig zugelassene Argon2-Logins reduzierten einen parallelen Mixed-Lauf auf 44,54 req/s. Mit einem separaten Login-Limit von 1 stieg derselbe Mixed-Lauf auf 68,56 req/s (+54 %); 30 Logins waren erfolgreich, 2.177 wurden kontrolliert als `503` abgewiesen. Der allgemeine Request-Pfad blieb fehlerfrei. Der Produktionsdefault ist 2, das 1-CPU-Performance-Profil verwendet 1.

Ein abgebrochener Client deckte zunächst einen Kapazitätszähler auf, der bei einem Socket-Abbruch nicht sicher freigegeben wurde. Die Freigabe berücksichtigt nun Request-Abbruch und tatsächliches Ende der Serverarbeit; ein realer Socket-Regressionstest sichert den Fall.

## Chaos unter Last

| Fehler                                      | Erfolgreich |                        kontrolliert | unkontrolliert | Recovery                                                    |
| ------------------------------------------- | ----------: | ----------------------------------: | -------------: | ----------------------------------------------------------- |
| API 1 stoppen/neustarten, 30 s über Nginx   |         957 |               76.512 `429`, 3 `503` |              0 | API 2 hielt Sessions, API 1 wurde gesund wieder aufgenommen |
| PostgreSQL 5 s stoppen, nach Fehler-Mapping |         820 |              69 `503`, 52.483 `429` |              0 | beide APIs wieder healthy                                   |
| Redis 5 s stoppen                           |         747 | 213 fail-closed `503`, 66.020 `429` |              0 | Rate-Limit/Queue-Verbindung erholte sich                    |

Vor der Korrektur erzeugte der PostgreSQL-Test zusätzlich neun `500`, weil Prisma Shutdown-/Startup-SQLSTATEs als `PrismaClientUnknownRequestError` meldete. Diese Muster werden nun sicher als temporäre `503` mit `Retry-After` abgebildet.

## Datenintegrität nach Extremtests

Auf dem großen Datensatz wurden anschließend 2.503 Nutzer, 15.002 Roboter, 150.000 Sessions, 300.000 Benachrichtigungen, 600.000 Audit-Einträge, 605.450 Analytics-Ereignisse, 300.000 Chat-Nachrichten und 1.000 Queue-Einträge gezählt. Die zusätzlichen Analytics-Einträge stammen aus erfolgreichen Testschreibvorgängen.

Alle neun geprüften Parent-Beziehungen hatten 0 Waisen. Es gab 0 doppelte Queue-Positionen und 0 Roboter mit mehreren aktiven Sessions.
