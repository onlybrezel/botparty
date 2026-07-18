# Backup-/Restore-Audit

Stand: 18.07.2026. Prüfung ausschließlich mit isolierten Testdaten.

## Ausgeführter Restore-Drill

1. Seed-, Benutzer-, Rollen-, Robot-, Relation-, Audit- und MinIO-Testdaten wurden im Docker-Stack erzeugt.
2. `scripts/backup-release.sh` erstellte PostgreSQL-Dump, MinIO-Archiv, Metadaten, SHA-256-Prüfsummen und ein verschlüsseltes Releasearchiv.
3. Das finale geprüfte Archiv war `/tmp/botparty-final-audit-backups/botparty-release-20260718T145911Z.tar.gz.enc`, 15.130 Byte, Dateimodus 0600.
4. Die isolierte Zielumgebung wurde frisch aufgebaut und mit `scripts/restore-drill.sh` wiederhergestellt.
5. Alle zwölf Migrationen, Schemadrift, Beziehungen, Admin-Login, autorisierte Moderationsabfrage und Recording-Download wurden über das finale API-Image geprüft. Beide Buckets wurden zurückgespiegelt und bytegleich verglichen. Der nach allen API-Korrekturen wiederholte Nachweis liegt in `data/restore-drills/restore-drill-20260718T155634Z-1508560.json`; Laufzeit 30 s.
6. Der Orphan-Check ergab null verwaiste Kernrelationen.

Der erste Abschlusslauf erkannte eine veraltete Smoke-Annahme: Ein Admin durfte fremde Robots nach der Eigentümerhärtung korrekterweise nicht mehr über `/robots/my` sehen. Der Drill verwendet nun den rollenautorisierten Moderations-Endpunkt; die Produktberechtigung wurde nicht abgeschwächt. Der vollständige Restore war anschließend erfolgreich. Ein Backup wird in diesem Projekt erst nach diesem Restore-Nachweis als verwendbar bezeichnet.

## Fehlerfälle

Ein beschädigtes verschlüsseltes Archiv und ein falscher Schlüssel wurden separat geprüft; beide Prozesse endeten mit Exit-Code 1 und stellten keine Teildaten als erfolgreich dar. URL-/Passwortsonderzeichen und kryptografischer Roundtrip besitzen eigene Shelltests.

## Konsistenz und Betrieb

PostgreSQL wird mit `pg_dump` konsistent gesichert. Objektspeicher und Datenbank werden gemeinsam manifestiert; das Manifest erlaubt die Erkennung fehlender oder veränderter Teile. Releases können vor dem Update ein Backup erzwingen. Ein fehlerhafter Backupschritt beendet den Releasepfad.

Empfohlene Betreiberstrategie: verschlüsselte Offsite-Kopie, getrenntes Secret-Escrow, Rotation nach dokumentierter Aufbewahrungsmatrix, Kapazitätsalarm und automatisierter Restore-Drill. Point-in-Time-Recovery erfordert zusätzlich archiviertes PostgreSQL-WAL und wurde in der gelieferten Single-Node-Compose-Topologie nicht behauptet. RPO/RTO benötigen eine Betreiberentscheidung und wurden nicht geschätzt.
