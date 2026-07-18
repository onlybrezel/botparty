# Deployment- und Rollback-Audit

Stand: 18.07.2026.

## Releasepfad

`ops.sh update-local` beziehungsweise der versionierte Releasepfad baut/zieht Images, prüft Backupbereitschaft, führt `minio-init` aus, startet genau einen Migrationscontainer und ersetzt danach API und Web mit Surge-Replikas. Neue Container müssen Docker-Health und Proxy-Admission bestehen, bevor alte Container beendet werden.

Vor dem Surge pinnt Nginx den Upstream atomar auf die bisherigen gesunden Container, weil Docker-DNS neue Compose-Replikas bereits vor bestandener Readiness veröffentlicht. Erst nach Docker-Health und Proxy-Admission wird auf ausschließlich die neuen Container umgeschaltet. Bestehende HTTP-Keep-alive-Verbindungen erhalten begrenzte Handoff-Fenster; alte Replikas werden einzeln und graceful gestoppt. Danach wird die dynamische Docker-DNS-Auflösung wiederhergestellt. WebSockets erhalten vorab eine Redis-Pub/Sub-Shutdown-Mitteilung mit Retryinformation.

## Gefundene und behobene Rolloutfehler

- Reines Docker-DNS-Round-Robin konnte einen laufenden Request an eine kurz darauf entfernte IP binden; Dauerproben reproduzierten 502. Upstream-Pinning und Worker-Handoff beseitigten das Fenster.
- Die erste Surge-Implementierung ließ eine noch ungesunde API bereits in Docker-DNS erscheinen; eine Dauerprobe reproduzierte genau einen weiteren 502 vor dem Health-Gate. Pre-Surge-Pinning auf die alten IPs beseitigte auch dieses Admission-Fenster.
- Ein Rollback auf ein älteres Webimage ohne eigenen `/web-health/live`-Endpunkt scheiterte an der Admission. Nginx akzeptiert für die unmittelbar vorherige Version den 404-Kompatibilitätspfad als Health 200.
- Doppelte Nginx-Reloads konnten Keep-alive-Verbindungen unnötig rotieren. Jeder Service-Drain validiert und lädt die Konfiguration jetzt genau an den erforderlichen Punkten.

## Praktischer Nachweis

- Rollout auf `audit-final10`: API-Liveness, Web-Liveness und Startseite jeweils 8.482/8.482 HTTP 200, null 5xx, null Verbindungsfehler.
- Rollback aktuelle→vorherige Version: jeder der drei Pfade 7.865/7.865 HTTP 200, null 5xx, null Verbindungsfehler.
- Rollforward vorherige→aktuelle Version: API- und Web-Liveness jeweils 7.587/7.587, Startseite 7.588/7.588 HTTP 200; null 5xx und null Verbindungsfehler.
- Finaler Ablehnungstest mit fehlender SMTP-Produktionskonfiguration: 9.958/9.958 Antworten HTTP 200 über die alten Replikas; die ungesunden Surge-Container erhielten keinen Traffic und der Upstream kehrte zu Docker-DNS zurück.
- Der Rollout des abschließend geprüften API-Images wurde zusätzlich 150 Sekunden mit persistenten HTTP-Verbindungen belastet: 146.191 Antworten waren HTTP 200, sieben Versuche endeten als rohe `UND_ERR_SOCKET`-Reconnects (0,0048 %). Eine anschließende 60-Sekunden-Baseline ohne Reload lieferte 44.583/44.583 HTTP 200; ein einzelner isolierter Nginx-Reload reproduzierte drei Socketwechsel. Damit ist die Restgrenze dem einzelnen Reverse-Proxy-Reload zugeordnet und nicht als fehlerfreie Verbindungsmigration ausgegeben.
- Ein nicht startendes Image (Exit 42) und eine API mit unvollständiger SMTP-Produktionskonfiguration wurden vor Admission abgewiesen; alte Replikas blieben erreichbar.
- Frühere API-Stop-/Restart- und Rolloutproben verteilten Requests nachweislich auf beide Instanz-IDs.

Rollback wechselt nur auf ein vorhandenes, verifiziertes Image-Tag. Schemaänderungen werden nicht rückwärts migriert; Release-Migrationen müssen daher mit der vorherigen Version kompatibel bleiben. `latest` ist nicht der dokumentierte Releaseweg.

Der Redis-Hinweis lässt WebSocket-Clients vor dem Handoff kontrolliert neu verbinden. Für strikt verbindungsunterbrechungsfreie HTTP-/WebSocket-Proxyupdates ist ein externer beziehungsweise redundanter L4/L7-Proxy nötig, der Nginx-Instanzen nacheinander aus dem Traffic nimmt; die mitgelieferte Single-Node-Compose-Topologie kann diese Eigenschaft nicht beanspruchen.
