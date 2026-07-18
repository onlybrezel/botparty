# Security-Audit

Stand: 18.07.2026. Whitebox-Prüfung von API, Web, WebSocket, Compose, Images, Abhängigkeiten, Git-Historie und manipulierbaren Requests in einer isolierten Docker-Umgebung.

## Behobene P0-/P1-Befunde

- Private Robotdaten waren über mehrere fachliche Teilendpunkte uneinheitlich geschützt. Robot-Reads/-Writes, Cameras, Telemetrie, Action Queue, Webhooks, Moderation, Sessions, Chat, Queue, Controls, LiveKit und Donations verwenden nun dieselbe serverseitige Eigentümer-/Staff-Prüfung und antworten für fremde private Ressourcen mit 404.
- Robot-Thumbnails waren über einen anonymen MinIO-Bucket und den Nginx-Pfad `/storage/` direkt erreichbar. Beide Buckets sind privat, Nginx antwortet dort 403, private Bilder werden über einen autorisierten API-Stream mit `private, no-store` ausgeliefert. Nutzeravatare nutzen ebenfalls zufällige private Objektschlüssel und einen kontrollierten öffentlichen API-Proxy statt einer Bucket-URL.
- Passwort-, Rollen- und Aktivitätsänderungen ließen ältere Sitzungen nicht überall verlässlich erlöschen. Access-/Refresh-Prüfung und `tokenVersion` widerrufen sie jetzt instanzübergreifend; der E2E-Test bestätigt nach Kontolöschung 401 für alte Tokens.
- Globales Throttling war pro Prozess und damit über zwei APIs umgehbar. Ein atomarer Redis-Speicher erzwingt denselben Zähler auf allen Instanzen und fällt bei Koordinationsverlust geschlossen aus.
- PayPal `ORDER.APPROVED` konnte fachlich zu früh als Zahlung gelten. Nur `PAYMENT.CAPTURE.COMPLETED` mit passender Order-/Capture-ID, Betrag und Währung schreibt Credits gut; Events sind dedupliziert.
- Webhook-Ziele erhielten SSRF-Schutz einschließlich DNS-Auflösung, privater/Loopback-/Link-local-Adressen, Redirectgrenze und Revalidierung. Lieferungen haben Timeout, begrenzte Retries und Dead-Letter-Sichtbarkeit.
- Produktionsfehler gaben uneinheitliche Interna preis. Fehlerantworten sind normalisiert; Request-/Correlation-ID bleiben sichtbar, Stacktraces nur intern.
- CSP verwendet Nonces statt unsicherer Inline-Freigaben. CORS, Cookieattribute, CSRF-Origin, Bodygrößen, Uploadformat und Redirects werden serverseitig geprüft.
- Anwendungsprozesse laufen als Non-Root mit `no-new-privileges`, begrenzten Ressourcen und read-only Root-Filesystemen. Der API-Entrypoint besitzt nur die zum Lesen hostgebundener `0600`-Secrets und zum anschließenden UID-/GID-Drop notwendigen Capabilities; der Node-Prozess läuft als UID 1001. Web und Nginx besitzen keine Capabilities. Datenbank-, Redis- und MinIO-Adminports sind nicht öffentlich gebunden.

## Durchgeführte Angriffstests

Der frische E2E-Lauf verwendete getrennte Eigentümer-/Fremdnutzerkontexte und manipulierte direkte Requests. Geprüft wurden 15 fremde bzw. anonyme Zugriffe auf private Robot-, Thumbnail-, Queue-, Control-, LiveKit-, Session-, Chat-, Camera-, Telemetrie-, Webhook-, Action- und Löschpfade; alle lieferten 404. Ein gefälschter `x-user-role: admin`-Header lieferte 403. Eigentümerzugriff blieb funktionsfähig.

Zusätzlich wurden Replay/Deduplizierung, parallele Wallet-/Payout-/Control-Operationen, abgelaufene Claim-Tokens, Rollenmatrix, CSRF, Webhook-SSRF, Raw-Body-Limits, ungültige MIME-/Bilddaten, Feature-Flags und fehlende externe Credentials getestet. Nginx-Ratenlimit und Redis-Globalzähler wurden über alternierende API-Instanzen belastet.

## Secrets und Lieferkette

- Eine High-Confidence-Suche über alle 177 erreichbaren Git-Revisionen fand keine bestätigten produktiven Secrets.
- Secrets werden in Compose über Dateien geladen; `.env.example` enthält nur Konfigurationsnamen und sichere Hinweise.
- Frontend-Buildargumente sind auf öffentliche Werte begrenzt. Private Credentials werden nicht als Build-Args verwendet.
- Actions und Laufzeitimages sind auf vollständige Commit-/Digestwerte gepinnt.
- Nach den Wartbarkeits- und Lieferkettenaktualisierungen melden sowohl der Produktions- als auch
  der vollständige Dependency-Audit keine bekannten Schwachstellen. Der Paketmanager meldet unter
  Node 24 weiterhin eine transitive `url.parse()`-Deprecation; Anwendungscode verwendet dafür keine
  neu eingeführte Laufzeitabhängigkeit.

## Verbleibende externe Abnahmen

PayPal-/Stripe-Sandbox, produktive SMTP-Zustellung, physischer Robot-/E-Stop, Branch-Protection und rechtliche/KYC-Freigaben benötigen fremde Konten oder verbindliche Betreiberentscheidungen. Die zugehörigen Features bleiben ohne vollständige Konfiguration fail-closed.
