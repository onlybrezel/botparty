import { spawnSync } from 'node:child_process';
import { PrismaClient } from '../packages/prisma/generated/client/index.js';

const BASELINE = '20260413_initial_baseline';
const FIRST_LEGACY_MIGRATION = '20260414_add_robot_slug_aliases';
const prisma = new PrismaClient();

async function migrationWasApplied(name) {
  const table = await prisma.$queryRaw`
    SELECT to_regclass('public._prisma_migrations')::text AS name
  `;
  if (!table[0]?.name) return false;

  const rows = await prisma.$queryRaw`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE migration_name = ${name} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    LIMIT 1
  `;
  return rows.length === 1;
}

try {
  const [hasBaseline, hasLegacyHistory] = await Promise.all([
    migrationWasApplied(BASELINE),
    migrationWasApplied(FIRST_LEGACY_MIGRATION),
  ]);

  if (!hasBaseline && hasLegacyHistory) {
    const result = spawnSync(
      './node_modules/.bin/prisma',
      ['migrate', 'resolve', '--schema=packages/prisma/prisma/schema.prisma', '--applied', BASELINE],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`Could not record the controlled ${BASELINE} upgrade marker`);
    }
  }
} finally {
  await prisma.$disconnect();
}
