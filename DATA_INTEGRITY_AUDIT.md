# Datenintegritäts- und Race-Condition-Audit

Stand: 18.07.2026.

## Kritische Aktionen und Absicherung

| Aktion | Absicherung |
| --- | --- |
| Registrierung, E-Mail- und Passworttokens | eindeutige Hashwerte, Ablauf, Rate Limit, Tokenrotation |
| Robotanlage und paketabhängige Limits | Owner-Row-Lock und Transaktion über alle API-Instanzen |
| Queuebeitritt/Position | `@@unique([robotId,userId])`, eindeutige Position, Robot-Lock |
| Control-Befehl und Credittransfer | UUID/Command-ID, serialisierbare Ledgertransaktion, eindeutiger Ledgerbezug |
| Billing-Webhooks | `@@unique([provider,eventId])`, Statusmaschine, Betrag-/Währungsprüfung |
| Wallet-Operationen | Idempotency-Key mit `IN_PROGRESS/COMPLETED`, serialisierbare Retries für 40001/40P01 |
| Payout | atomare Statusübergänge, eindeutige Ledger-/Providerreferenz, getrennte Akteure |
| Staff-Kontoänderung/-löschung | deterministische Akteur-/Ziel-Row-Locks, erneute Rollenprüfung und atomare Profil-/Balance-/Ledgeränderung |
| Notification/Mail | eindeutiger `dedupeKey`, Queue-Retry und Zustellstatus |
| Scheduler/Cron | Redis-Lock mit eindeutiger Job-ID; mehrere API-Instanzen erzeugen keinen Doppeljob |
| Avatar-/Thumbnail-/Recording-Löschung | persistente Storage-Deletion-Outbox mit Bucket-/Key-Unique, Prefix-Aufräumung und Retrytermin |

## Reproduzierte Fehler und Reparaturen

- Prozesslokale Raten- und Schedulerzustände ließen sich über zwei API-Instanzen duplizieren; beide sind jetzt Redis-koordiniert.
- Limitprüfung und Insert waren bei Robots, Webhooks und Controls nicht überall atomar; Row-Locks/serialisierbare Transaktionen schließen das Check-then-act-Fenster.
- Zahlung, Payout und Control konnten bei Retry doppelte Ledgerwirkungen riskieren; Datenbank-Unique-Constraints und idempotente Statusautomaten verhindern dies.
- Objektlöschung konnte nach erfolgreicher DB-Änderung verloren gehen; die transaktional erzeugte Outbox hält den Löschauftrag bis zur erfolgreichen Storage-Ausführung.
- Kontolöschung konnte Finanzrelationen kaskadieren; Finanzdaten verwenden `Restrict` und das Konto wird sicher deaktiviert/anonymisiert.
- Staff-Kontolöschung prüfte Rolle und Ziel vor dem Transaktionslock; Akteur und Ziel werden nun in stabiler Reihenfolge gesperrt und die aktuelle aktive Adminrolle wird nach dem Lock erneut geprüft.
- Staff-Profiländerung und Balance-Ledger waren getrennte Transaktionen. Beide laufen nun zusammen unter denselben Akteur-/Ziel-Locks; ein paralleler Rollenentzug wird kontrolliert abgewiesen und anonymisierte Konten können nicht reaktiviert werden.
- Avatar-/Thumbnail-Ersetzung konnte Storageobjekte verwaisen oder nach einer DB-Störung eine inkonsistente Referenz hinterlassen. Eindeutige Objektschlüssel, Row-Locks, Kompensationslöschung und transaktionale Outbox-Aufträge schließen diese Teilzustände; Robot- und Kontolöschung räumen Prefixe samt Aufnahmen nach.

## Prüfungen

Parallel- und Deduplizierungstests sind Bestandteil der 611 bestandenen API-Tests. Die PostgreSQL-/Redis-Testcontainersuite lief gegen echte Container. Der E2E-Lauf prüfte direkte Doppel-/Fremdrequests sowie Avatar-Upload, -Abruf, -Löschung und erneuten Upload im frischen Stack. Ein Orphan-Check nach Backup/Restore ergab null verwaiste Kernrelationen.

## Konsistenzgrenzen

Schreibzugriffe und Reads nach Auth-, Rollen-, Status- oder Ledgeränderungen gehen zur Primary. `DATABASE_READ_URL` ist nur für ausdrücklich stale-tolerante Reads vorgesehen. Eine Read Replica wurde nicht als automatisches Failover ausgegeben.
