# Data Retention Matrix

BotParty applies retention in `MaintenanceService` every six hours by default. Operators may shorten the configurable windows; financial retention is deliberately separate from account-profile deletion.

| Dataset | Default | Enforcement |
|---|---:|---|
| Chat messages | 30 days | Rows older than `CHAT_RETENTION_DAYS` are deleted. |
| Product analytics | 90 days | Rows older than `ANALYTICS_RETENTION_DAYS` are deleted; withdrawing consent deletes that user's events immediately. |
| Billing webhook payloads | 30 days | Payload bodies are replaced by a minimal retention marker after `BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS`; idempotency metadata remains. |
| Inactive moderation entries | 180 days | Expired entries are deactivated, then inactive rows older than `MODERATION_RETENTION_DAYS` are deleted. |
| Admin audit log | 180 days | Rows beyond `ADMIN_AUDIT_LOG_RETENTION_DAYS` or their explicit expiry are deleted. |
| Recording metadata | 30 days | Rows older than `RECORDING_RETENTION_DAYS` are deleted; object lifecycle must use the same window. |
| Notifications | 180 days | Each notification has `expiresAt`; expired feed/outbox rows are deleted. |
| Email verification tokens | Until expiry | Expired token digests and expiry timestamps are cleared. |
| Queue entries | Session policy | Expired entries are deleted; Redis state is reconstructed from durable rows where needed. |
| Runtime telemetry | 90 days | The deployment retention policy covers telemetry snapshots and associated operational storage. |
| Application logs | 30 days | Docker rotation bounds local logs; the external sink must apply the same or shorter lifecycle. |
| Financial ledger, billing and payouts | 10 years | Account deletion anonymizes the user while retaining immutable accounting records and provider references. |

Cleanup results are exposed through `botparty_retention_cleanup_runs_total`, `botparty_retention_cleanup_rows_total`, and `botparty_retention_cleanup_last_success_timestamp_seconds`. Alerts must fire when a scheduled dataset cleanup fails or stops reporting success.

Account export includes account, robots, sessions, chat, moderation, analytics, wallet, billing, payout, and recording data. The export endpoint requires a fresh authenticated session. Account deletion preserves financial rows and replaces identifying profile fields with anonymous values.
