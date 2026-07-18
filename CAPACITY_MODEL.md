# Kapazitätsmodell

Stand: 18. Juli 2026

Die folgenden Grenzen gelten ausschließlich für den dokumentierten lokalen Host, das geschlossene Mixed-Profil und das Docker-Bridge-Netz. Nutzerzahlen lassen sich daraus nicht seriös ableiten, weil die Request-Rate pro Nutzer und reale Netzwerkzeiten unbekannt sind.

## Gemessene Ressourcenprofile

Großer Datensatz, 20 Clients, eine API, PostgreSQL 2 CPU/2 GiB:

| API-Profil        |    Durchsatz |       p50 |       p95 |       p99 | Fehler |
| ----------------- | -----------: | --------: | --------: | --------: | -----: |
| 0,5 CPU / 512 MiB |  70,92 req/s | 237,02 ms | 688,30 ms | 885,04 ms |      0 |
| 1 CPU / 768 MiB   | 138,53 req/s | 122,06 ms | 326,14 ms | 543,99 ms |      0 |
| 2 CPU / 1.536 MiB | 171,90 req/s | 113,30 ms | 255,22 ms | 315,12 ms |      0 |

Eine Verdopplung von 1 auf 2 API-CPU brachte in diesem DB-lastigen Profil nur 24,1 % mehr Durchsatz. Eine Erhöhung über 2 CPU sollte daher erst nach DB-Messung erfolgen. 0,5 CPU ist für den großen Datensatz funktional, verfehlt aber ein sinnvolles p95-Ziel von 500 ms.

## Datensatzabhängigkeit bei 1 CPU/768 MiB

| Profil | Lauf                        | stabiler Durchsatz |       p95 |       p99 | Fehler |
| ------ | --------------------------- | -----------------: | --------: | --------: | -----: |
| klein  | Mixed, 10 Clients, 20,32 s  |       218,17 req/s | 101,38 ms | 198,16 ms |      0 |
| mittel | Mixed, 20 Clients, 300,33 s |       207,38 req/s | 242,75 ms | 329,24 ms |      0 |
| groß   | Mixed, 20 Clients, 30,09 s  |       138,53 req/s | 326,14 ms | 543,99 ms |      0 |

Der mittlere Lauf profitiert stärker von Cache-Lokalität. Der große Datensatz verschiebt die Grenze zu Such-, Sortier- und Benachrichtigungsabfragen.

## Eine gegen zwei APIs

Mittlerer Datensatz, je API 1 CPU/768 MiB:

| Aufbau    |           Last | Gesamtdurchsatz |              p95 | Fehler |
| --------- | -------------: | --------------: | ---------------: | -----: |
| eine API  |     30 Clients |    209,32 req/s |        362,87 ms |      0 |
| zwei APIs | 2 × 30 Clients |    309,64 req/s | 495,36/483,70 ms |      0 |

Die zweite API erhöhte den Durchsatz um 48 %. Die Verteilung über Nginx war in einem Kontrolllauf 329 zu 331 Antworten. Der Gewinn ist nicht linear, weil beide Prozesse denselben PostgreSQL-Dienst mit 2 CPU teilen. Vor einer dritten API muss deshalb die Datenbanklast gemessen und voraussichtlich zuerst die Primary skaliert werden.

## Betriebsgrenzen

Für ein p95-Ziel von höchstens 500 ms gelten unter dem getesteten Mixed-Profil:

- 0,5 CPU/512 MiB: nicht als großes Produktionsprofil empfohlen; gemessene p95 688 ms.
- 1 CPU/768 MiB: 138,53 req/s bei großem Datensatz; als sichere Dauerlast mit 25 % operativem Puffer höchstens rund 100 req/s einplanen. Dieser Puffer ist eine Betriebsregel, kein zusätzlicher Benchmark.
- 2 CPU/1.536 MiB: 171,90 req/s bei großem Datensatz; mit demselben Puffer rund 125 req/s planen.
- Zwei APIs à 1 CPU: auf dem mittleren Datensatz 309,64 req/s gemessen; sichere Planung rund 230 req/s, sofern DB-p95 und Pool-Wartezeit stabil bleiben.

Kurzfristige Überlast ist bis 100 gleichzeitige Clients getestet. Sie wird durch maximal 32 aktive Requests je 1-CPU-API kontrolliert; der erfolgreiche Durchsatz lag auf großem Datensatz bei 107,74 req/s, p95 699 ms, weitere Anfragen erhielten schnelle `503`.

## Pool- und Worker-Dimensionierung

- Prisma-Pool: 10 Verbindungen je API, `pool_timeout=3`, `connect_timeout=5`.
- Zwei APIs: maximal 20 Verbindungen; der Alert bei 64 lässt 16 Verbindungen Reserve bis zum getesteten DB-Maximum 80.
- Eine größere Poolgröße ist nicht belegt und wird nicht empfohlen; die CPU/Query-Arbeit sättigte vor dem Connection-Limit.
- Job-Parallelität bleibt je API bei Audit 1, Mail 2 und Webhook 4. Der Queue-Benchmark belegt die Queue-Koordination, aber keinen Vorteil höherer Mail-/Webhook-Parallelität. Erhöhung nur anhand Queue-Alter und DB-/Fremddienstlatenz.

## Messwertbasierte Skalierungsregeln

1. Zweite API, wenn API-CPU über mehrere Intervalle nahe 80 % liegt, p95 über dem Ziel liegt und DB-CPU/Pool noch Reserve haben.
2. Primary skalieren oder Queries optimieren, wenn DB-CPU/I/O oder Query-p95 zuerst sättigen; eine weitere API verschärft dies.
3. Worker skalieren, wenn ältester Job und Queue-Tiefe wachsen, während DB und externe Dienste unter ihren Limits bleiben.
4. Read Replica nur für tolerierbar veraltete Reads, wenn gemessene Primary-Readlast dominiert. Konsistenzkritische Reads bleiben auf der Primary.
5. Objekt-Storage extern skalieren, wenn Upload-/Download-I/O oder Speicherplatz statt API-CPU begrenzt.
6. Archivieren/paginieren, wenn Query-Pläne mit wachsender Historie erneut kippen; p95 und Heap sind die Trigger, nicht allein Tabellenzeilen.

## Nicht ermittelte Kapazität

Es gibt keine getestete Zahl für drei oder mehr APIs, eine Read Replica, WAN-Verbindungen, reale LiveKit-Medienlast, Produktions-SMTP oder Payment-Provider. Diese Bereiche dürfen nicht aus den obigen Werten extrapoliert werden.
