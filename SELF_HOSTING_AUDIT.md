# Self-Hosting-Audit

Stand: 18.07.2026. Zielplattform: aktuelles Debian/Ubuntu mit Docker Engine und Docker Compose Plugin.

## Installationspfad

Der dokumentierte Ablauf wurde ohne Host-Node, Host-PostgreSQL oder weitere Laufzeitabhängigkeiten geprüft:

1. Repository/Release beziehen und `.env.example` übernehmen.
2. `setup-env.sh` erzeugt lokale Secret-Dateien mit restriktiven Rechten, validiert Pflichtwerte und setzt TLS-Schlüssel auf `0640` für die explizite Nginx-Zusatzgruppe.
3. `docker compose config` prüft die Topologie.
4. Einmalige Container erzeugen LiveKit-Konfiguration, MinIO-Buckets/-Policies, Datenbankschema und Seed-Admin.
5. API, Web, Nginx, Redis, PostgreSQL, MinIO und LiveKit starten über Compose-Healthbedingungen.
6. Login, Upload, öffentliche/private Robotroute, Mail-Testadapter, Backup und Restore wurden im isolierten Dockerpfad ausgeführt.
7. Update und Rollback erfolgen über `ops.sh` mit unveränderlichen Image-Tags und Health-Gates.

Der Dev-/Setup-Smoke und der vollständig frische E2E-Stack bestanden. Das HTTPS-Profil wurde zusätzlich mit selbstsigniertem Testzertifikat als UID 101, read-only, ohne Capabilities sowie mit HTTP-Liveness, Redirect und HTTPS-Startseite gestartet. Die E2E-Umgebung publiziert keine Datenbank-, Redis- oder MinIO-Ports und entfernt Volumes nach dem Lauf.

## Dokumentation und sichere Defaults

README, `.env.example` und Runbook dokumentieren Ports, Volumes, Secret-Dateien, Provider-Flags, Backup, Restore, Update, Rollback, Healthchecks und Diagnose. Produktionsvalidierung verlangt starke Secrets, HTTPS/WSS, SMTP sowie vollständige Konfigurationsgruppen. Billing/Payout/Analytics sind standardmäßig deaktiviert.

Container nutzen Non-Root, `no-new-privileges`, Capability-Drops, read-only Root-Filesysteme und Ressourcenlimits, soweit das jeweilige Fremdimage dies zulässt. Migrationen laufen nicht in jeder API.

## Vor einer fremden Produktivinstallation

Der Betreiber muss DNS/TLS, reale SMTP-/Payment-/Alert-Credentials, Offsite-Backupziel, Secret-Escrow, rechtliche Texte und Monitoringempfänger bereitstellen. Diese externen Werte wurden nicht durch Testwerte ersetzt oder als abgenommen bezeichnet.
