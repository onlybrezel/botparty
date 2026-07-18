# Chaos- und Ausfalltestbericht

Stand: 18.07.2026. Ziel war die kontrollierte Reaktion, nicht künstliche Dauerverfügbarkeit jedes Single Points of Failure.

| Störung | Beobachtung | Ergebnis |
| --- | --- | --- |
| API-Instanz stoppen/neustarten | final 10.065/10.065 Requests über verbleibende API erfolgreich; gestoppte Replika wurde gesund wieder aufgenommen | toleriert |
| Redis stoppen | Liveness 200, Readiness und öffentliche API wegen globalem Rate-Limiter 503; kein Restartloop; nach Start Readiness und API wieder 200 | sicher fail-closed und selbstheilend |
| PostgreSQL stoppen | Liveness 200, Readiness 503 mit `discovery/migrations/auth/control=error`; nach Start wieder 200 | kontrolliert, kein Endloshang |
| MinIO stoppen | Liveness und öffentliche DB-Abfrage 200, Readiness 503 mit `storage=error`; keine anonyme Ersatzablage; nach Start wieder 200 | kontrolliert |
| LiveKit stoppen | Video-/Realtime-Abhängigkeit wird in Readiness/Diagnostik sichtbar; normale HTTP-Liveness bleibt | kontrolliert |
| fehlerhaftes API-Image | Testimage beendet sich mit Exit 42; Health-Gate entfernt nur neue Replikas, alte Version blieb erreichbar | Rollout abgebrochen |
| SMTP nicht konfiguriert | neue Produktions-API erreicht Readiness nicht; Pre-Surge-Pinning hält 9.958/9.958 Antworten auf alten Replikas bei HTTP 200 | fail-closed ohne Trafficverlust |
| Storage-Init fehlt | frischer E2E-Upload reproduzierte 500; API/Egress warten jetzt auf erfolgreichen Init-Container; 21/21 Retest | behoben |

## Diagnosefähigkeit

Alle Ausfälle waren über getrennte `/health/live`- und `/health/ready`-Antworten, Containerstatus, strukturierte API-Logs und Prometheusmetriken zuzuordnen. Request- und Instanz-IDs blieben erhalten; öffentliche Fehler enthielten keine Stacktraces. Kurzzeitige externe Störungen lösen keinen Liveness-Restart aus.

## Ressourcenprüfung

Die Compose-Dienste besitzen CPU-/RAM-Grenzen; E2E-Runner zusätzlich PID-, CPU- und RAM-Limits. Im 60-Sekunden-Dauertest sank die gemeinsame API-Speichernutzung nach Idle von 464,3 MiB auf 446,0 MiB; es gab weder OOM-Kill noch Containerrestart. Das ist ein Smoke gegen offensichtliches Wachstum, kein Langzeitbeweis.

## Verbleibende Topologiegrenzen

Ausfall des einzigen Nginx, PostgreSQL-Primary, Redis, MinIO oder LiveKit-Knotens unterbricht die jeweilige Funktion. Kontrollierte Fehler und Restore sind umgesetzt; echte Hochverfügbarkeit benötigt externe Cluster-/Failover-Topologien.
