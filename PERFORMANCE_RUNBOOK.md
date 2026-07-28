# Performance-Runbook

Stand: 18. Juli 2026

## Voraussetzungen

- Linux mit Docker Engine und Compose-Plugin
- Ausführung im Repository-Stamm
- keine produktiven URLs oder Secrets
- Docker-Zugriff über die lokale Gruppe, hier: `sg docker -c '<Befehl>'`

Die Testskripte akzeptieren nur localhost, die Docker-Service-Namen `api`/`nginx` oder private IP-Adressen. Performance-Seeds verweigern jede Datenbank, deren Name nicht `botparty_performance` ist.

## Schneller reproduzierbarer Check

```bash
sg docker -c './scripts/run-performance-smoke.sh'
```

Der Ablauf erstellt einen eindeutigen Compose-Projektnamen, temporäre Test-Secrets, frische Volumes und das kleine Datenprofil. Er baut die API, migriert, seedet, führt 20 Sekunden Mixed-Last aus und entfernt die Umgebung per Trap. Bericht: `data/performance-smoke/result.json`.

Nützliche, bewusst lockere CI-Parameter:

```bash
PERFORMANCE_SMOKE_DURATION_SECONDS=60 \
PERFORMANCE_SMOKE_CONCURRENCY=20 \
PERFORMANCE_SMOKE_MAX_P95_MS=1000 \
PERFORMANCE_SMOKE_MIN_RPS=20 \
sg docker -c './scripts/run-performance-smoke.sh'
```

## Vollständige Umgebung

Eine `.env` und File-Secrets werden wie in `DEVELOPER_GUIDE.md` erzeugt. Danach:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml --profile performance config --quiet'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml up --build -d postgres redis seaweedfs object-storage-init livekit-config livekit livekit-ingress mail-test'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml run --rm migrate'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml up -d --scale api=2 api web nginx'
```

Seed innerhalb einer API:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml exec -T -e PERFORMANCE_FIXTURE_ALLOW_WRITES=true -e PERFORMANCE_DATASET=medium api sh -c ". /load-file-secrets.sh; node /performance/seed-performance.mjs"'
```

`PERFORMANCE_DATASET` ist `small`, `medium` oder `large`. Der Seed ist wiederholbar, ersetzt aber Queue-Einträge des synthetischen Primärroboters. Deshalb ausschließlich im isolierten Performance-Projekt verwenden.

## Last ausführen

Beispiel Mixed:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml --profile performance run --rm \
  -e PERFORMANCE_SCENARIO=mixed \
  -e PERFORMANCE_DURATION_SECONDS=30 \
  -e PERFORMANCE_CONCURRENCY=20 \
  load-generator'
```

Weitere Szenarien: `stats`, `public-read`, `write`, `login`, `file`, `websocket`. Für vergleichbare Vorher-/Nachher-Werte bleiben Datensatz, Ziel, Dauer, Concurrency, Ressourcen und Warmzustand unverändert.

Optionale Regression-Gates:

```text
PERFORMANCE_MAX_SUCCESSFUL_P95_MS=500
PERFORMANCE_MAX_ERROR_RATE=0
PERFORMANCE_MIN_SUCCESS_RPS=100
```

## Metriken beobachten

```bash
sg docker -c 'docker stats --no-stream'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml ps'
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml logs --since=5m api nginx postgres redis'
```

PostgreSQL:

```sql
SELECT calls, mean_exec_time, total_exec_time, rows, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state;
```

Für eine konkrete langsame Query `EXPLAIN (ANALYZE, BUFFERS)` mit synthetischen Parametern ausführen. Einen Index erst übernehmen, wenn der unveränderte Lastlauf und der Plan beide einen Nutzen zeigen.

## Überlast diagnostizieren

1. Statuscodes trennen: `429` ist Proxy-/Rate-Limit, `503` Admission oder Abhängigkeit, `500` ist ein Fehler.
2. API-CPU, Event-Loop-p99, Heap und aktive Requests prüfen.
3. DB-CPU, aktive Verbindungen, Pool-Wartefehler, Top-Queries und Lock-Waits prüfen.
4. Redis-Verfügbarkeit sowie Queue-Tiefe/ältesten Job prüfen.
5. Instanzverteilung im Lastbericht prüfen; stark einseitige Antworten deuten auf Load-Balancer/Readiness.
6. Nach Lastende aktive Requests, Queue-Alter, Heap und p95 erneut messen. Ein Neustart ist keine gültige Recovery.

## Skalieren

API skalieren, wenn die API zuerst sättigt und DB/Redis Reserve haben:

```bash
sg docker -c 'docker compose -f docker-compose.yml -f docker-compose.performance.yml up -d --scale api=2 --no-deps api'
```

Vor mehr als zwei APIs die Poolrechnung prüfen: `API-Anzahl × connection_limit + Worker/Scheduler/Migration/Reserve < max_connections`. Im getesteten Profil sind es 2 × 10 bei DB-Maximum 80.

Worker-Parallelität erst erhöhen, wenn Queue-Alter wächst und DB/Storage/Fremddienste Reserve besitzen. Eine Read Replica nur für explizit stale-tolerante Reads konfigurieren; sie ist kein Failover.

## Kontrollierte Chaos-Tests

Nur im eindeutig benannten Performance-Projekt:

```bash
sg docker -c 'docker compose -p <projekt> -f docker-compose.yml -f docker-compose.performance.yml stop api'
sg docker -c 'docker compose -p <projekt> -f docker-compose.yml -f docker-compose.performance.yml start api'
```

Für PostgreSQL oder Redis denselben Stop/Start nur während eines begrenzten Lastlaufs verwenden. Vorher Container-/Volume-Namen prüfen. Erwartet werden temporäre `503`, keine `500`, keine doppelten Writes und automatische Readiness-Recovery.

## Integrität nach Extremtests

- Tabellenzähler vor/nachher gegen erfolgreiche Writes vergleichen.
- Foreign-Key-Waisen für Sessions, Notifications, Analytics, Chat und Queue suchen.
- doppelte (`robotId`, `position`) und mehrere aktive Sessions pro Roboter prüfen.
- Upload-Download-Smoke für das geschriebene Objekt wiederholen.
- Containerneustarts und OOM-Zähler prüfen.

## Sichere Rückkehr und Cleanup

Lastgenerator beenden, Queue-Alter auf Normalwert abwarten, Readiness aller Instanzen prüfen und erst danach skalieren. Bei einer festhängenden Queue keine Jobs löschen; Ursache und Idempotenz zuerst prüfen.

```bash
sg docker -c 'docker compose -p <projekt> -f docker-compose.yml -f docker-compose.performance.yml --profile performance down -v --remove-orphans'
```

`-v` löscht sämtliche Testdaten. Der Befehl darf nur für den isolierten Performance-Projektnamen verwendet werden.
