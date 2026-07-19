## Operator notes

Review [CHANGELOG.md](https://github.com/onlybrezel/botparty/blob/main/CHANGELOG.md) before deployment.

### Upgrade

1. Create a release archive with `./scripts/backup-release.sh`.
2. Run `./ops.sh preflight` and attach the recorded review references to the release record.
3. Pull the tagged API and Web images.
4. Run `prisma migrate deploy`; do not use `db push` in production.
5. Deploy API, Web, and nginx, then verify `/api/v1/health/ready` and the release smoke tests.
6. Confirm the robot protocol version and all newly required environment variables in `.env.example`.

### Rollback

Redeploy the preceding immutable image tag. If the release migration changed stored data incompatibly, restore the verified pre-release archive into new volumes and switch traffic after readiness succeeds.

### Breaking changes

- Robot commands require command UUIDs and ACK/NACK responses.
- Robot JWTs are short-lived and existing tokens are revoked when the claim token rotates.
- Production startup fails when required feature, legal, SMTP, provider, or secret configuration is incomplete.
