# Audit der Daten- und Eigentümerisolation

Stand: 18.07.2026.

## Modellgrenze

Das Produkt besitzt kein `Tenant`, `Organization`- oder `Location`-Modell. Getestet wurde deshalb die tatsächlich implementierte Sicherheitsgrenze: Benutzer A als Eigentümer eines privaten Robots gegen Benutzer B, anonyme Zugriffe sowie die globalen Rollen `USER`, `MOD` und `ADMIN`. Ein späterer Organisationsbetrieb benötigt ein eigenes Tenant-Schema und kann nicht aus der jetzigen Eigentümerprüfung abgeleitet werden.

## Testmatrix

| Bereich | Eigentümer | fremder USER / anonym | MOD/ADMIN |
| --- | --- | --- | --- |
| Robot-Detail und Thumbnail | erlaubt | 404 | gemäß Staff-Policy erlaubt |
| Robot-Änderung/Löschung | erlaubt | 404 | nur ausdrücklich freigegebene Staff-Aktion |
| Cameras, Telemetrie, Actions, Webhooks | erlaubt | 404 | serverseitige Rollenmatrix |
| Controls, Queue, Chat, LiveKit | gemäß Robot-Access | private Existenz bleibt 404 | Moderationsrechte getrennt |
| Sessions und Historie | Eigentümer/Teilnehmer gemäß Route | 404 | Staff-Route mit Rolle |
| Donations | öffentlich bzw. berechtigt | privates Ziel 404 | kein Header-Override |

Der Docker-E2E-Test registriert zwei reale Benutzer, erstellt einen privaten Robot, lädt Thumbnail und Avatar hoch und ruft die geschützten Pfade direkt auf. Der Avatar wird nur über den API-Proxy ausgeliefert und nach Löschung mit 404 beantwortet; der Bucket bleibt privat. 21/21 E2E-Tests bestanden; die Isolationsprüfung umfasst 15 fremde/anonyme Robot-Requests. Weder Dateiname noch Status, Zählwert oder Existenz der privaten Robotressource werden über unterschiedliche 403/404-Antworten offengelegt.

## Architekturmaßnahmen

- `RobotAccessService` und gemeinsame Access-Helfer werden vor Status-, Feature- oder Policy-Auswertung aufgerufen.
- Owner-ID stammt aus dem verifizierten JWT, nie aus einem Client-Header oder frei übernehmbaren Bodyfeld.
- Queue-, Webhook- und Control-Limits werden unter Robot-Lock bzw. serialisierbarer Transaktion geprüft.
- Private Thumbnailobjekte sind nicht anonym lesbar. Die API prüft Owner/Staff vor S3-Read und setzt `private, no-store`.
- WebSocket-Join, Chat, Control und Turn verwenden dieselbe Robot-Access-Entscheidung und Redis-koordinierten Zustand.
- Such-, Explore- und öffentliche Übersichten filtern nach Sichtbarkeit; private Ressourcen werden nicht gezählt oder autovervollständigt.

## Ergebnis

Für das vorhandene Eigentümermodell wurde keine bekannte horizontale oder vertikale Rechteausweitung reproduziert. Das Ergebnis gilt nicht als Nachweis für ein noch nicht implementiertes B2B-Mandantenmodell.
