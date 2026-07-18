# Performance-Baseline

Stand: 18. Juli 2026

Alle Werte stammen aus der in `PERFORMANCE_TEST_PLAN.md` beschriebenen lokalen Docker-Umgebung. Die API-Läufe gingen direkt an eine API-Instanz, sofern nicht ausdrücklich Nginx genannt ist. Dadurch misst die Baseline die Anwendungskapazität und nicht das absichtlich niedrigere Proxy-Limit.

## Ausgangszustand

| Datensatz/Szenario                           |        Last |       Erfolg |       p50 |       p95 |       p99 | Fehler | Erste Sättigung                            |
| -------------------------------------------- | ----------: | -----------: | --------: | --------: | --------: | -----: | ------------------------------------------ |
| mittel, Statistik vor Cache                  |    20, 30 s | 201,79 req/s |  97,36 ms | 127,64 ms | 198,16 ms |      0 | PostgreSQL, 6 Counts je Request, 201 % CPU |
| mittel, Public Read vor schlanker Projektion |    20, 30 s | 145,39 req/s | 164,44 ms | 305,20 ms | 376,53 ms |      0 | API 100 %, DB 124 %                        |
| mittel, Mixed optimierter Zwischenstand      |    20, 20 s | 205,33 req/s |  92,77 ms | 225,42 ms | 298,95 ms |      0 | API und DB je ungefähr 1 CPU               |
| groß, Mixed warm ohne Benachrichtigungsindex | 20, 30,15 s | 121,77 req/s | 142,66 ms | 405,70 ms | 606,26 ms |      0 | Benachrichtigungszählung/DB                |

Der erste halbkalte Großlauf lag bei 100,25 req/s, p95 504,98 ms und p99 867 ms. Kapazitätsvergleiche verwenden daher den warmen Lauf und nennen Warm/Kalt ausdrücklich.

## Proxy-Baseline

Eine einzelne Quell-IP erzeugte 30 Sekunden lang 107.967 Statistik-Requests gegen Nginx. 958 Requests waren erfolgreich (31,93 req/s), 107.009 wurden kontrolliert als `429` abgewiesen. Es gab weder `500` noch Timeouts. Das bestätigt das konfigurierte Limit von 30 req/s mit Burst; es ist keine Aussage zur gesamten Mehrbenutzerkapazität, da Nginx pro IP begrenzt.

## Authentifizierung

Mit einer auf 1 CPU begrenzten API erreichten fünf gleichzeitige Login-Clients 3,34 vollständige Argon2-Logins/s; p95 lag bei 1.785 ms. Zehn Clients erhöhten den Durchsatz nicht, p95 stieg auf etwa 3.499 ms. CPU-intensive Passwortprüfung ist damit die Login-Grenze.

## Datei- und WebSocket-Pfade

| Szenario                              | Last/Dauer          |                                          Ergebnis |                                  p95 |
| ------------------------------------- | ------------------- | ------------------------------------------------: | -----------------------------------: |
| Datei, 20 % Upload/80 % Download      | 5 Clients, 15,42 s  | 544 Downloads + 29 Uploads, 37,16 req/s, 0 Fehler | Download 219,36 ms; Upload 715,53 ms |
| WebSocket verbinden/beitreten/trennen | 20 Clients, 20,24 s |                 1.566/1.566, 77,36 Verbindungen/s |                            270,51 ms |
| Write-Profil                          | 20 Clients, 20,07 s |                         4.278/4.278, 213,15 req/s |             171,89 ms; p99 264,97 ms |

## Kleiner frischer Smoke-Test

Der erste Abschlusslauf deckte einen Race beim gleichzeitigen ersten Erzeugen von Benachrichtigungseinstellungen auf und wurde wegen eines `500` korrekt abgebrochen. Nach der Korrektur verarbeitete eine vollständig neu erstellte Umgebung mit allen Migrationen und kleinem Seed in 20,32 Sekunden 4.434/4.434 Requests: 218,17 req/s, p50 30,78 ms, p95 101,38 ms, p99 198,16 ms, maximal 574,19 ms. Alle CI-Grenzwerte wurden eingehalten; Volumes und Container wurden danach entfernt.

## Datenbank- und Queue-Baseline

Der Queue-Benchmark mit 1.000 Positionen, PostgreSQL 2 CPU/2 GiB und Redis 0,5 CPU/256 MiB ergab p50 47,65 ms und p95 72,76 ms für Reads; Join/Leave lag bei p95 28,16 ms. Es entstanden keine doppelten Positionen.

## Interpretationsgrenzen

- Das lokale Bridge-Netz bildet keine WAN-Latenz oder Paketverluste ab.
- Die Werte gelten für synthetische, aber relationale Daten und die dokumentierten Containerlimits.
- Mail-, Payment- und LiveKit-Fremddienste wurden nicht unter externer Produktionslatenz gemessen.
- Eine Read Replica wurde nicht provisioniert; `DATABASE_READ_URL`-Vorbereitung blieb erhalten, liefert aber hier keine Kapazitätszahl.
