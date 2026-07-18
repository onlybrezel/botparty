# Unabhängiger Abschlussreview

Stand: 18.07.2026. Dieser Review betrachtet den gesamten Arbeitsdiff als fremde Änderung und führt keine Produktbehauptung ohne Testnachweis fort.

## Reviewfokus

Geprüft wurden Architekturkomplexität, tote/temporäre Pfade, Abhängigkeiten, `any`/`ts-ignore`/Regeldeaktivierungen, leere Catch-Blöcke, unkontrollierte Retries, Timeouts, Secret-/Testzugänge, Containerprivilegien, Testaussagekraft, Dokumentation und Codeabgleich.

## Feststellungen

- Die neuen Sicherheitsentscheidungen liegen in gemeinsamen Services/Helfern statt in UI-Ausblendungen. Eigentümerprüfungen laufen vor Status-/Featureauswertung.
- Redis-, Storage-, Billing- und Rolloutadapter besitzen begrenzte Timeouts/Retrypfade; Fehler werden nicht leer verschluckt.
- Migrations-, MinIO-Init- und Rolloutlogik sind einmalige Betriebsprozesse und nicht in jede API-Replika dupliziert.
- Der Nginx-Drain wurde anhand realer 502-Nachweise zweimal korrigiert: zunächst das Entfernen alter DNS-Peers, danach die vorzeitige Veröffentlichung ungesunder Surge-Replikas. Pre-Surge-Pinning, Instanz-Admission und Worker-Handoff bestanden Rollout, Rollback und Rollforward mit zusammen 71.803 HTTP-200-Antworten ohne Fehler; der finale Ablehnungstest ergänzte 9.958 fehlerfreie Antworten über die alte Version.
- Der zunächst fehlgeschlagene private Upload führte zu einer echten Compose-Startreihenfolgenreparatur und einem vollständigen 21/21-Retest; der Test wurde nicht abgeschwächt.
- Der Review fand außerdem direkte Avatar-Storage-URLs, verwaisbare Avatar-/Thumbnailobjekte, einen für Non-Root unlesbaren TLS-Schlüsselpfad und einen veralteten Restore-Smoke nach der Eigentümerhärtung. API-Proxies, eindeutige Objektkeys, transaktionale Prefix-/Key-Outbox, TLS-Zusatzgruppe und rollenrichtiger Restore-Smoke wurden implementiert und praktisch nachgetestet.
- Die abschließende Race-Prüfung fand Rollenänderungen zwischen Vorprüfung und Staff-Kontoänderung/-löschung sowie einen getrennten Profil-/Balance-Ledger-Commit. Deterministische Akteur-/Ziel-Row-Locks, erneute aktive Adminprüfung und ein gemeinsamer Transaktionscommit schließen diese Zeitfenster; Downgrade-, Ledger- und Löschpfade sind regressionsgetestet. Anonymisierte Konten können über den Staff-Endpunkt nicht reaktiviert werden.
- Die finale Keep-alive-Probe relativierte die früheren verbindungsfrischen Nullfehler-Rolloutläufe: sieben von 146.198 Versuchen mussten beim Nginx-Reload neu verbinden. Instrumentierung, Baseline und isolierter Reload ordnen dies dem einzelnen Proxy-Master zu; der Bericht behauptet daher keine verbindungsunterbrechungsfreie Proxy-HA.
- OpenAPI und die Markdown-Referenz sind deterministisch. Der ungenutzte generierte TypeScript-
  Client und sein Generator wurden entfernt; der produktive fokussierte Browser-Client bleibt.
- Abhängigkeits- und Imagepinning wurden beibehalten. Neu hinzugefügte Laufzeitpakete dienen konkreten Redis-/S3-/Observabilitypfaden; unnötige Ersatzframeworks wurden nicht eingeführt.

## Testkritik

Der finale autorisierte Dockerlauf bestand 65/65 API-Suites und 608/608 Tests einschließlich echter PostgreSQL-/Redis-Testcontainer. Die Websuite bestand 33/33 Dateien und 109/109 Tests. Der frische Docker-E2E-Lauf baute Produktionsimages, erzeugte neue Volumes, führte zwölf Migrationen samt Seed aus, startete je zwei API-/Web-Replikas und bestand 21/21 Tests einschließlich Avatar-Lifecycle und Eigentümerisolation. Tests wurden nicht auf `skip`, `todo` oder `only` gesetzt; ein früherer Test mit ausschließlich bedingungslos erfolgreichen Assertions wurde entfernt.

Der Schlusslauf fand keine Testabschaltung, TypeScript-Unterdrückung, aktive ESLint-Deaktivierung, leere Catch-Blöcke oder TODO-/FIXME-Reste im handgeschriebenen Änderungsumfang. Explizite `any`-Typen wurden nicht ergänzt. `shellcheck`, `bash -n`, alle drei Compose-Renderings und `git diff --check` sind ohne Befund durchgelaufen. Die Hochkonfidenzsuche im Änderungsumfang, die Image-Umgebungen/-Historien und die 177 Git-Revisionen ergaben kein bestätigtes Secret. Produktions- und vollständiger Dependency-Audit melden keine bekannten Schwachstellen.

Der Wartbarkeitsreview entfernte zudem den Nest-`forwardRef`-Zyklus, die doppelte Browser-Client-
Implementierung, den ESLint-Kompatibilitätslayer, tote DTO-/Locale-/Loadtestpfade und ungenutzte
direkte Dependencies. Relative Importzyklen in API, Web und Shared liegen bei null. Sicherheits-,
Mandanten-/Eigentümer-, Transaktions-, Redis- und Dockergrenzen blieben bewusst erhalten.

## Reviewentscheidung

Im technisch getesteten Core verbleibt kein unbehandelter P0-Befund. Öffentliche Monetarisierung, Auszahlung, Rechtstexte, physische Robot-Sicherheit und GitHub-Branch-Gates bleiben bis zu externer Abnahme deaktiviert beziehungsweise als Blocker dokumentiert. Der nach allen Reviewreparaturen wiederholte Diff-, Secret-, Dependency-, Shell-, Compose-, Docker-, Rollout- und Restore-Check war erfolgreich.
