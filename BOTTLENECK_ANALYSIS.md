# Engpassanalyse

Stand: 18. Juli 2026

## 1. Öffentliche Statistik führte sechs Counts je Request aus

- **Symptom:** 201,79 req/s, p95 127,64 ms; PostgreSQL 201 % CPU, API 83 %.
- **Ursache:** jeder Request wiederholte sechs identische Aggregate. Viele gleichzeitige Requests starteten dieselbe Arbeit parallel.
- **Änderung:** instanzlokaler Snapshot mit 5 Sekunden TTL und Zusammenführung gleichzeitig laufender Refreshes. Der Read-Replica-Pfad bleibt für tolerierbar veraltete Statistik erhalten.
- **Ergebnis:** 2.068,11 req/s, p50 6,89 ms, p95 22,72 ms, p99 67,68 ms. PostgreSQL fiel auf 3,25 %; in 30 Sekunden liefen nur sechs Counts.
- **Risiko:** bis zu fünf Sekunden alte öffentliche Zähler sind fachlich akzeptiert. Der Cache ist bewusst pro Instanz und benötigt keine Redis-Koordination.

## 2. Öffentliche Roboterlisten serialisierten private Felder

- **Symptom:** 145,39 req/s, p95 305,20 ms, 90,3 MiB Antworten im Lauf.
- **Ursache:** öffentliche Listen selektierten vollständige Roboterdatensätze einschließlich privater Hash-/Tokenfelder, obwohl der Serializer diese nicht ausgeben sollte.
- **Änderung:** explizite öffentliche Prisma-Projektion mit ausschließlich benötigten Feldern.
- **Ergebnis:** 157,89 req/s (+8,6 %), p50 143,99 ms, p95 284,96 ms (−6,6 %). Ein Test prüft, dass Hashes und Passwörter nicht selektiert werden.
- **Risiko:** neue öffentliche Felder müssen bewusst in die Projektion aufgenommen werden.

## 3. Ungelesen-Zählung skalierte mit 60.000 Admin-Benachrichtigungen

- **Symptom:** großer Mixed-Lauf warm 121,77 req/s, p95 405,70 ms; die Einzelabfrage benötigte warm 51,47 ms und las 7.894 Heap-Blöcke.
- **Ursache:** Filter auf `userId`, `readAt IS NULL` und `expiresAt` konnte nur den allgemeinen User-/CreatedAt-Index verwenden.
- **Änderung:** partieller Index `notifications_unread_user_expires_idx` auf (`userId`, `expiresAt`) für `readAt IS NULL`.
- **Query-Ergebnis:** Index-only Scan, 0 Heap Fetches, 7,899 ms (−84,7 %). Indexgröße auf dem großen Datensatz: 9.976 KiB.
- **Last-Ergebnis:** 138,53 req/s (+13,8 %), p95 326,14 ms (−19,6 %), p99 543,99 ms (−10,3 %), 0 Fehler.
- **Risiko:** zusätzliche Schreib- und Speicherarbeit für ungelesene Benachrichtigungen. Der partielle Index begrenzt diese Kosten; Auswirkungen sind bei wesentlich höherer Schreibrate erneut zu messen.

Zwei testweise ergänzte Roboter-Sortierindizes hatten auch auf 15.002 Robotern `idx_scan=0` und wurden wieder entfernt. Sie sind nicht Teil des Repositorys.

## 4. Unbegrenzte aktive Requests verschlechterten Überlast

- **Symptom:** bei 100 Clients nur 110,06 erfolgreiche req/s, 17 Timeouts, p99 4.845 ms.
- **Ursache:** zu viele parallele Handler konkurrierten um CPU und Datenbank; zusätzliche Arbeit erhöhte Warteschlangen statt Durchsatz.
- **Änderung:** Fastify Admission-Control mit getrenntem Login-Bulkhead, Health-Ausnahme, `Retry-After`, Prometheus-Zähler und sicherer Freigabe auch bei Socket-Abbruch.
- **Ergebnis:** Limit 32 erreichte im mittleren Test 174,58 erfolgreiche req/s, p95 463,52 ms und keine Timeouts/`500`. Im großen 100-Client-Test gab es 19.795 kontrollierte `503`, aber keine unkontrollierten Fehler; Recovery war unmittelbar vollständig.
- **Risiko:** Limit ist je Instanz. Bei anderer CPU-Zuteilung muss es mit identischem Profil neu dimensioniert werden.

## 5. Argon2-Login verdrängte normale Requests

- **Symptom:** fünf Clients sättigten die 1-CPU-API bei 3,34 Logins/s; vier gleichzeitig zugelassene Logins senkten paralleles Mixed auf 44,54 req/s.
- **Ursache:** Passwortprüfung ist absichtlich CPU- und speicherintensiv.
- **Änderung:** getrenntes Login-Bulkhead; 1 paralleler Login im 1-CPU-Testprofil, Default 2 für das 2-CPU-Produktionsprofil.
- **Ergebnis:** paralleles Mixed 68,56 req/s (+54 %), 30 erfolgreiche Logins und 2.177 kontrollierte `503`.
- **Risiko:** Login-Spitzen werden abgewiesen statt gepuffert. Clients sollen `Retry-After` beachten; die globale Redis-Rate-Begrenzung bleibt zusätzlich aktiv.

## 6. Datenbankneustart erschien als interner Fehler

- **Symptom:** während einer fünfsekündigen DB-Unterbrechung entstanden neun `500`.
- **Ursache:** Prisma kapselte PostgreSQL-SQLSTATE 57P01/57P02/57P03 und Verbindungsabbrüche als unbekannten Request-Fehler.
- **Änderung:** eng begrenzte Erkennung transienter Prisma-/Connector-Muster im zentralen Exception-Filter.
- **Ergebnis:** identischer Wiederholungstest: 69 `503`, 0 `500`, 0 Transportfehler; beide APIs erholten sich.
- **Risiko:** unbekannte, nicht transiente Prisma-Fehler bleiben korrekt `500` und werden nicht verschluckt.

## 7. Gleichzeitige erste Benachrichtigungsaufrufe kollidierten

- **Symptom:** ein Fresh-Smoke erzeugte bei 3.794 Requests genau einen `500` im Benachrichtigungspfad.
- **Ursache:** mehrere Requests legten gleichzeitig die noch fehlenden `notification_preferences` an. Ein isolierter Datenbanktest mit 100 parallelen Prisma-Upserts reproduzierte 98 Erfolge und zwei `P2002`-Unique-Fehler.
- **Änderung:** nach einem konkurrierenden Insert lädt `getPreferences` den erzeugten Datensatz; `updatePreferences` wendet das gewünschte Update auf den Gewinnerdatensatz an.
- **Ergebnis:** zwei Regressionstests bestanden; das neu gebaute Produktionsimage verarbeitete auf einer weiteren frischen Datenbank 4.434/4.434 Mixed-Requests bei 0 Fehlern.
- **Risiko:** zwei gleichzeitig unterschiedliche Preference-Updates behalten die normale Last-Write-Wins-Semantik; es gehen keine Constraints oder Nutzergrenzen verloren.

## Verbleibender erster Engpass

Bei einer API und großem Datensatz sättigen API-CPU und die gemeinsame Primary bei Listen-, Such- und Benachrichtigungsabfragen. Zwei API-Instanzen skalieren deshalb nur um 48 %. Der nächste sinnvolle Schritt bei weiter steigender Last ist zuerst Query-/DB-I/O-Messung und Primary-Skalierung, nicht blind eine dritte API.
