import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

const url = process.env.MIGRATION_TEST_DATABASE_URL?.trim();
if (!url) throw new Error('MIGRATION_TEST_DATABASE_URL is required');
const parsed = new URL(url);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  throw new Error('Migration verification is restricted to a local disposable PostgreSQL instance');
}
if (!parsed.pathname.toLowerCase().includes('migration_test')) {
  throw new Error('The disposable database name must contain migration_test');
}
process.env.DATABASE_URL = url;

const schema = 'packages/prisma/prisma/schema.prisma';
const legacySchema = 'packages/prisma/prisma/fixtures/legacy-20260501.prisma';
const legacyMigrations = [
  '20260414_add_robot_slug_aliases',
  '20260416_add_chat_soft_delete_and_admin_audit_log',
  '20260416_add_robot_webhooks',
  '20260416_add_user_email_verification_columns',
  '20260416_ensure_user_email_verified_column',
  '20260429_add_wallet_billing_payouts',
  '20260501_add_subscription_billing',
];

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: url, ...extraEnv },
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function assertNoDrift(label) {
  console.log(`\n[${label}] checking schema drift`);
  run('./node_modules/.bin/prisma', [
    'migrate',
    'diff',
    '--exit-code',
    '--config=packages/prisma/prisma.config.ts',
    '--from-config-datasource',
    '--to-schema',
    schema,
  ]);
}

console.log('\n[fresh] rebuilding from immutable migrations');
run('./node_modules/.bin/prisma', [
  'migrate',
  'reset',
  '--force',
  '--config=packages/prisma/prisma.config.ts',
  `--schema=${schema}`,
]);
assertNoDrift('fresh');
console.log('\n[fresh] verifying idempotent deploy');
run('./node_modules/.bin/prisma', [
  'migrate',
  'deploy',
  '--config=packages/prisma/prisma.config.ts',
  `--schema=${schema}`,
]);

console.log('\n[upgrade] provisioning the anonymized 2026-05-01 schema fixture');
run('./node_modules/.bin/prisma', [
  'db',
  'push',
  '--force-reset',
  '--config=packages/prisma/prisma.config.ts',
  `--schema=${legacySchema}`,
]);
for (const migration of legacyMigrations) {
  run('./node_modules/.bin/prisma', [
    'migrate',
    'resolve',
    '--config=packages/prisma/prisma.config.ts',
    `--schema=${schema}`,
    '--applied',
    migration,
  ]);
}
run(execPath, ['scripts/prepare-prisma-baseline.mjs']);
run('./node_modules/.bin/prisma', [
  'migrate',
  'deploy',
  '--config=packages/prisma/prisma.config.ts',
  `--schema=${schema}`,
]);
assertNoDrift('upgrade');
console.log('\n[upgrade] verifying idempotent deploy');
run('./node_modules/.bin/prisma', [
  'migrate',
  'deploy',
  '--config=packages/prisma/prisma.config.ts',
  `--schema=${schema}`,
]);

console.log('\nPrisma fresh, upgrade, drift, and idempotency verification passed.');
