# Datenbank- und Migrationsaudit

Stand: 09.08.2026. Datenbank: PostgreSQL 18; ORM: Prisma 6.19.2.

## Schema

Das Schema enthält 19 Fachmodelle und explizite Enums für Rollen, Sichtbarkeit, Access, Queue, Billing, Payout, Control, Session und Moderation. Primärschlüssel, Foreign Keys, `Restrict` für Finanzdaten, Kaskaden für klar eigentumsgebundene Daten, Nullability, Zeitstempel und Indizes wurden mit den realen Querypfaden abgeglichen.

Wesentliche Invarianten sind in der Datenbank verankert: eindeutige Usernamen/E-Mails und Tokenhashes, Robot-Slug/Claim-/Streamhash, ACL pro Robot/User, Queueposition und -mitgliedschaft, Provider-/Webhook-/Idempotency-Referenzen, Control-Ledgerbezug, Payoutreferenz, Recording-Objektschlüssel, Notification-Deduplizierung und Storage-Outbox-Key. Finanzrelationen löschen nicht kaskadierend.

## Migrationspfad

Vierzehn Migrationen werden in Reihenfolge auf einer leeren Datenbank ausgeführt:

1. `20260413_initial_baseline`
2. `20260414_add_robot_slug_aliases`
3. `20260416_add_chat_soft_delete_and_admin_audit_log`
4. `20260416_add_robot_webhooks`
5. `20260416_add_user_email_verification_columns`
6. `20260416_ensure_user_email_verified_column`
7. `20260429_add_wallet_billing_payouts`
8. `20260501_add_subscription_billing`
9. `20260717_release_invariants`
10. `20260718_add_notification_unread_index`
11. `20260718_add_storage_deletion_outbox`
12. `20260718_private_thumbnail_storage`
13. `20260718_proxy_avatar_storage`
14. `20260809_add_discovery_read_indexes`

Die Thumbnail-Migration wurde zunächst mit einem falschen Tabellenbezeichner reproduzierbar abgewiesen (`P3018`) und anschließend auf den realen Tabellennamen `robots` korrigiert. Die additive Avatar-Migration ersetzt alte direkte Storage-URLs durch den API-Proxy. Der finale Test umfasste: frische Migration 0→aktuell, `migrate status`, Driftprüfung, idempotente Wiederholung, Upgrade einer realistischen älteren Schemafassung und erneute Driftprüfung. Alle finalen Schritte waren erfolgreich.

## PostgreSQL 18

Die Referenz-Compose-Topologie verwendet das offizielle PostgreSQL-18-Alpine-Image mit
Multi-Arch-Digest. Der persistente Mount liegt entsprechend dem PostgreSQL-18-Image unter
`/var/lib/postgresql`; `PGDATA` ist `/var/lib/postgresql/18/docker`. Neue Cluster werden mit
Datenprüfsummen initialisiert.

`scripts/upgrade-postgres-16-to-18.sh` migriert bestehende PostgreSQL-16-Volumes offline über einen
Custom-Format-Dump in ein separates PostgreSQL-18-Volume. Quell- und Zielvolume werden nie
vertauscht oder überschrieben. Der Abschluss setzt PostgreSQL 18, aktivierte Datenprüfsummen und
identische Zeilenzahlen in allen Anwendungstabellen voraus. Das PostgreSQL-16-Volume bleibt für
einen kontrollierten Rollback erhalten.

Fresh-DB, Legacy-Upgrade, Driftprüfung und idempotenter Deploy wurden mit allen vierzehn
Migrationen auf PostgreSQL 18 erfolgreich ausgeführt. Ein zusätzlicher Volume-Test migrierte eine
beschriebene PostgreSQL-16-Datenbank nach PostgreSQL 18 und bestätigte Version, Datenprüfsummen und
Inhalt nach einem vollständigen Neustart des Zielcontainers.

## Parallelität und Releases

Migrationen laufen nicht im API-Entrypoint. Ein dedizierter `migrate`-Container führt Schema, Legacy-Secret-Migration und idempotenten Seed genau einmal vor API-Start aus. Zwei parallel gestartete Migrationscontainer konvergierten ohne doppelte Daten oder beschädigtes Schema. API, Worker-/Schedulerlogik und vorherige Releaseimages wurden gegen das additive Schema während Rollback/Rollforward betrieben.

Komplexe Änderungen folgen dem Expand-/Migrate-/Contract-Prinzip. Der getestete Rollback kehrt Images zurück, niemals Datenbankmigrationen. Destruktive Contract-Migrationen sind nicht Teil dieses Releases.

## Read Replica

`DATABASE_WRITE_URL` und `DATABASE_READ_URL` sind getrennt. Alle Writes sowie Auth-, Berechtigungs-, Status-, Ledger- und Read-after-write-Pfade verwenden Primary. Die Compose-Referenz enthält keine Replica und kein automatisches Failover; Replikationslatenzwerte wurden daher nicht erfunden.
