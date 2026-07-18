# Datenschutz- und Datenlebenszyklus-Audit

Stand: 18.07.2026. Technische Analyse, keine Rechtsberatung.

## Dateninventar

| Speicherort | Personenbezug |
| --- | --- |
| PostgreSQL `users` | E-Mail, Username, Anzeigename, Avatarreferenz, Rolle, Präferenzen, Auth-/Aktivitätsstatus |
| Robot-/Session-/Queue-/Chatmodelle | Eigentümer/Teilnehmer, Commands, Zeitstempel, Moderations- und Nutzungsmetadaten |
| Billing/Wallet/Payout | pseudonyme User-ID, Beträge, Providerreferenzen, Einwilligungsfassung, verschlüsseltes und maskiertes Auszahlungsziel |
| Audit/Analytics/Notifications | Actor-/User-ID, Zweckevent, Status und Zeitstempel; Analytics nur nach Produktanalytics-Opt-in |
| MinIO | Nutzeravatare, Robot-Thumbnails und Aufnahmen; private Buckets, Zugriff nur über API-Proxy, autorisierte oder zeitlich signierte Pfade |
| Redis/Queue | kurzlebige Rate-, Turn-, Lock-, Pub/Sub- und Jobdaten; keine dauerhafte Primärquelle |
| Browser | notwendige Auth-Cookies sowie dokumentierte UI-/Locale-/Onboarding-Präferenzen; optionale Analyticswrites hinter Consent |
| Backups | verschlüsselter Snapshot der vorgenannten DB-/Objektdaten bis zum Ablauf der Betreiberrotation |

Logs enthalten keine vollständigen Tokens, Cookies, Payout-Ziele oder Uploadinhalte. Externe Datenflüsse bestehen konfigurationsabhängig zu SMTP, Stripe/PayPal und LiveKit; Features bleiben ohne vollständige Credentials deaktiviert.

## Export und Löschung

Benutzerexporte liefern lesbare, strukturierte Kontodaten und Beziehungen nur für den authentifizierten Benutzer. Staff-/Owner-Scopes und private Dateien verwenden dieselbe serverseitige Isolation wie die normalen Endpunkte.

Kontolöschung widerruft Tokens, deaktiviert Login, anonymisiert direkte Profil-/öffentliche Inhalte, entfernt Sessions/Notifications und plant Avatar-, Robot-Thumbnail- und Recording-Prefixe über die persistente Outbox zur Löschung. Roboterlöschung plant ebenfalls Thumbnail und Aufnahmen transaktional nach. Unveränderliche Ledger-, Billing- und Payoutrelationen bleiben unter pseudonymer Actor-ID erhalten, damit Salden und Streitfallnachweise nicht beschädigt werden. Backups werden nicht nachträglich mutiert; Löschungen wirken nach Ablauf der festzulegenden Backuprotation.

Auditlogs und Notifications besitzen standardmäßig einen indexierten 180-Tage-Ablauf und Cleanup-Jobs. Analytics hat Schema-Version, Opt-in und Retention-Cleanup. Die konkrete rechtliche Aufbewahrungsmatrix, Rechtsgrundlagen und endgültige Texte benötigen Betreiber-/Rechtsfreigabe.

## Dokumentationsabgleich

Cookie-/Storage-Inventar, Datenschutz-, Terms-, Cookie- und Impressumsseiten wurden mit dem technischen Verhalten abgeglichen. Sichtbare Templatehinweise wurden entfernt, Funktionen und Einwilligungsfassungen sind versioniert. Juristische Inhalte wurden nicht als rechtsverbindlich freigegeben; Abweichungen bleiben in `AUDIT.md` als externe Abnahme markiert.
