# Lizenz-, Paket- und Feature-Entitlement-Audit

Stand: 18.07.2026.

## Tatsächliches Modell

Das Repository enthält kein Offline-Lizenzfile, keine Installationsbindung und keinen separaten Lizenzserver. Diese Szenarien wurden deshalb nicht als vorhanden behauptet. Produktzugriff wird durch serverseitige Feature-Flags, Rollen, Robot-Eigentum und planabhängige Limits gesteuert.

Feature-Flags: Billing, Donations, Payouts, Paid Controls und Subscriptions. Ohne vollständige Provider-/Secretkonfiguration schlägt die Produktionsvalidierung fehl oder das Feature antwortet `FEATURE_DISABLED`; reine Frontend-Ausblendung ist nicht die Schutzschicht. PayPal-Subscriptions sind ausdrücklich nicht verfügbar und werden serverseitig abgewiesen.

## Limits und Parallelität

Robot-, Webhook- und Control-Limits werden in der API geprüft. Die kritischen Check-and-create-Pfade sperren die Robot-/Owner-Zeile beziehungsweise verwenden serialisierbare Transaktionen, sodass zwei API-Instanzen das Limit nicht gleichzeitig überschreiten. Datenbank-Unique-Constraints sichern Queue-, Idempotency-, Provider- und Deduplizierungsgrenzen zusätzlich.

Unit-/Paralleltests prüfen unter, am und über dem relevanten Limit sowie konkurrierende Erstellung. Manipulierte Bodywerte, JWT-/Rollenheader und direkte API-Aufrufe auf deaktivierte Funktionen ändern das Entitlement nicht.

## Statuswechsel

BillingIntent und Payout verwenden explizite Statusautomaten. Downgrade oder deaktiviertes Feature löscht keine bestehenden Daten; es verhindert neue kostenpflichtige Aktionen und lässt lesbare Historie bestehen. Abgelaufene oder nicht erreichbare externe Provider führen nicht zu lokalen Erfolgsgutschriften.

## Externe Grenze

Soll künftig ein kommerzielles Self-Hosted-Lizenzmodell eingeführt werden, sind signierte Claims, Installationsbindung, Clock-Rollback-Schutz, Grace-Period und Offline-Recovery neu zu spezifizieren. Dafür existiert derzeit bewusst keine Scheinimplementierung.
