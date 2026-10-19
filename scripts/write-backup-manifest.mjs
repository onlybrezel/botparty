import { writeFileSync } from 'node:fs';

const outputPath = process.argv[2];
if (!outputPath) throw new Error('manifest output path is required');

const versionNumText = process.env.BACKUP_POSTGRES_VERSION_NUM ?? '';
const versionNum = Number(versionNumText);
if (!/^\d+$/.test(versionNumText) || !Number.isSafeInteger(versionNum) || versionNum < 100000) {
  throw new Error('A valid PostgreSQL source server_version_num is required');
}

const manifest = {
  formatVersion: 2,
  encryption: 'AES-256-GCM+scrypt',
  createdAt: process.env.BACKUP_CREATED_AT,
  appVersion: process.env.BACKUP_APP_VERSION,
  gitCommit: process.env.BACKUP_GIT_COMMIT,
  postgresMajor: Math.floor(versionNum / 10000),
  buckets: (process.env.BACKUP_BUCKETS ?? '').split(/\s+/).filter(Boolean),
  requiredSecretFiles: [
    'api_database_url',
    'jwt_secret',
    'jwt_refresh_secret',
    'robot_jwt_secret',
    'webhook_secret_encryption_key',
    'payout_destination_encryption_key',
    'livekit_api_secret',
    'redis_password',
    'object_storage_secret_access_key',
    'metrics_password',
  ],
  restoreCommand:
    'BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup_encryption_key ./scripts/restore-drill.sh <archive>',
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
