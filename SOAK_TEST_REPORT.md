# Soak- und Speicherbericht

Stand: 18. Juli 2026

## Aufbau

- eine API, 1 CPU und 768 MiB
- PostgreSQL 2 CPU/2 GiB, Redis 0,5 CPU/256 MiB
- mittlerer Datensatz
- gemischtes authentifiziertes Profil
- 20 gleichzeitige Clients, 300,33 Sekunden
- Produktionsimage mit Node.js 24.18.0

## Ergebnis

| Messwert                 |                      Wert |
| ------------------------ | ------------------------: |
| Requests                 | 62.283/62.283 erfolgreich |
| Durchsatz                |              207,38 req/s |
| p50                      |                  90,53 ms |
| p95                      |                 242,75 ms |
| p99                      |                 329,24 ms |
| maximal                  |                  1.399 ms |
| Überlast/Fehler/Timeouts |                         0 |
| Containerneustarts/OOM   |                         0 |

API und PostgreSQL nutzten während der Dauerlast jeweils ungefähr einen CPU-Kern. Die API blieb weit unter ihrem Speicherlimit.

## Speicher- und Event-Loop-Verlauf

| Zeitpunkt         |        RSS |     Heap |                  Event-Loop p99 |
| ----------------- | ---------: | -------: | ------------------------------: |
| Beginn unter Last |  240,6 MiB | 82,2 MiB |                         46,7 ms |
| Mitte             |  249,7 MiB | 86,4 MiB |                         75,0 ms |
| direktes Ende     |  248,4 MiB | 92,5 MiB | nicht als Leerlaufwert gewertet |
| 45 s nach Last    | 248,55 MiB | 73,4 MiB |                        11,87 ms |

Die Docker-Arbeitsspeichernutzung lag stabil bei ungefähr 165 MiB. Der Heap fiel nach Lastende unter den Startwert zurück, aktive Requests lagen bei 0. Für die getesteten fünf Minuten gibt es keinen Hinweis auf einen kontinuierlichen Heap-, Handle- oder Event-Listener-Leak.

## Grenzen der Aussage

Fünf Minuten decken schnelle Leaks, GC-Verhalten und Recovery ab, ersetzen aber keinen mehrstündigen oder nächtlichen Produktions-Soak. Mail- und Webhook-Retry-Zyklen mit realer Fremddienstlatenz waren nicht Teil dieses Laufs. Der regelmäßige Workflow sollte deshalb zusätzlich einen längeren Soak mit denselben Daten und Ressourcen ausführen; dafür akzeptiert das Lastskript Laufzeiten bis 3.600 Sekunden.
