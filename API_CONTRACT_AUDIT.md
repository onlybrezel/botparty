# API-Vertrags- und Integrationsaudit

Stand: 18.07.2026.

## Inventar

Das generierte OpenAPI-Dokument enthält 110 Pfade und 126 Operationen. Hinzugekommen ist der öffentliche API-Proxy für platformgespeicherte Avatare; direkte Bucketpfade bleiben gesperrt. Erfasst sind öffentliche, authentifizierte, Staff-, Billing-/Webhook-, Datei-, Health-, Export- und Betriebsendpunkte. WebSockets besitzen zusätzlich einen getesteten Ereignisvertrag.

`docs/openapi.json` wird aus den Nest-Controllern gebaut; `docs/api-client.md` wird daraus als Referenz generiert. Der Export setzt nur lokale Metadaten-Defaults und benötigt weder `.env` noch produktive Credentials. Der während dieses Audits ebenfalls erzeugte TypeScript-Client hatte keinen Laufzeitnutzer und wurde im anschließenden Wartbarkeitsaudit entfernt. Das Frontend verwendet ausschließlich die getesteten Module unter `apps/web/src/lib/api/`.

## Verträge und Fehler

- DTO-/Zod-/Class-Validator-Schemas begrenzen Pflichtfelder, Enums, Zahlen, Bodygrößen, Pagination, Sortierung und Filter.
- Fehler besitzen ein einheitliches Format mit HTTP-Status, Code, Nachricht, Pfad, Zeit und Request-ID.
- Authentifizierung liefert 401, Rollen/Policy 403, nicht sichtbare fremde Ressourcen 404, Konflikte/Idempotenz 409, Eingabe 400/422, Rate Limit 429 und abhängige Ausfälle 503/504.
- Normale Validierungsfehler werden nicht als 500 und Fehlerobjekte nicht mit 200 zurückgegeben.
- Zeitwerte sind ISO-8601/UTC; fachliche Zeitzonen werden separat gespeichert.

## Integrationen

Stripe/PayPal prüfen Webhooksignatur und deduplizieren Events. PayPal schreibt ausschließlich nach verifiziertem Capture gut. Externe HTTP-Ziele besitzen Timeout, begrenzte Retries und SSRF-/Redirectschutz. SMTP und LiveKit werden in Readiness/Diagnostik sichtbar, ohne kurze externe Störung als Livenessfehler zu behandeln.

Der finale frische Docker-Lauf bestand 21/21 E2E-Tests. 611 API-Tests einschließlich echter PostgreSQL-/Redis-Testcontainer und 108 Web-Tests waren grün. Staff-ID-Parameter werden vor Datenbankzugriff als UUID validiert.
