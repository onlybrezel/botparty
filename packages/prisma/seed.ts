import { PrismaClient } from './generated/client/index.js';
import { hash } from 'argon2';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();
const PLATFORM_USER_ID = '00000000-0000-0000-0000-00000000fee5';
const DISABLED_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$disabled-disabled-disabled-disabled$disabled-disabled-disabled-disabled-disabled-disabled-disabled';

function tokenHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === 'true';
}

function slugBase(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function createUniqueSlug(base: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${base}-${randomBytes(3).toString('hex')}`;
    const exists = await prisma.robot.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new Error(`Could not generate unique slug for base ${base}`);
}

async function ensurePlatformUser() {
  await prisma.user.upsert({
    where: { id: PLATFORM_USER_ID },
    update: { role: 'ADMIN', isActive: true, emailVerified: true },
    create: {
      id: PLATFORM_USER_ID,
      username: '__platform__',
      email: 'platform@botparty.internal',
      passwordHash: DISABLED_PASSWORD_HASH,
      displayName: 'BotParty Platform',
      role: 'ADMIN',
      isActive: true,
      emailVerified: true,
    },
  });
  console.log('✅ Platform ledger user is present.');
}

async function ensureInitialAdmin() {
  const password = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!password) {
    console.log('ℹ️  Initial admin skipped (SEED_ADMIN_PASSWORD is not set).');
    return null;
  }
  if (password.length < 16) {
    throw new Error('SEED_ADMIN_PASSWORD must contain at least 16 characters.');
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@localhost.invalid';
  const username = process.env.SEED_ADMIN_USERNAME?.trim() || 'admin';
  const passwordHash = await hash(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      username,
      email,
      passwordHash,
      displayName: 'Administrator',
      role: 'ADMIN',
      emailVerified: true,
    },
  });
  console.log(`✅ Initial admin is present (${admin.email}).`);
  return admin;
}

async function ensureSeedRobot(input: {
  ownerId: string;
  name: string;
  description: string;
  tags: string[];
  fixedSlug?: string;
}) {
  const base = slugBase(input.name);
  const existing = input.fixedSlug
    ? await prisma.robot.findUnique({ where: { slug: input.fixedSlug } })
    : await prisma.robot.findFirst({
        where: { ownerId: input.ownerId, OR: [{ name: input.name }, { slug: { startsWith: `${base}-` } }] },
        orderBy: { createdAt: 'asc' },
      });

  if (existing) {
    return prisma.robot.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        ownerId: input.ownerId,
        visibility: 'PUBLIC',
        accessMode: 'OPEN',
        queueMode: 'FIRST_COME',
        maxTurnTime: 60_000,
        tags: input.tags,
      },
    });
  }

  return prisma.robot.create({
    data: {
      name: input.name,
      slug: input.fixedSlug ?? (await createUniqueSlug(base)),
      description: input.description,
      ownerId: input.ownerId,
      streamKeyHash: tokenHash(randomBytes(32).toString('hex')),
      claimTokenHash: tokenHash(randomBytes(32).toString('hex')),
      visibility: 'PUBLIC',
      accessMode: 'OPEN',
      queueMode: 'FIRST_COME',
      maxTurnTime: 60_000,
      tags: input.tags,
    },
  });
}

async function ensureButtons(robotId: string) {
  const buttons = [
    { label: 'Forward', command: 'forward', hotKey: 'w', icon: '⬆️', cooldownMs: 100, position: 0 },
    { label: 'Left', command: 'left', hotKey: 'a', icon: '⬅️', cooldownMs: 100, position: 1 },
    { label: 'Back', command: 'backward', hotKey: 's', icon: '⬇️', cooldownMs: 100, position: 2 },
    { label: 'Right', command: 'right', hotKey: 'd', icon: '➡️', cooldownMs: 100, position: 3 },
    { label: 'Action', command: 'action_1', hotKey: 'f', icon: '⚡', cooldownMs: 500, position: 4 },
  ];
  for (const button of buttons) {
    const existing = await prisma.controlButton.findFirst({
      where: { robotId, position: button.position },
      select: { id: true },
    });
    if (existing) {
      await prisma.controlButton.update({ where: { id: existing.id }, data: button });
    } else {
      await prisma.controlButton.create({
        data: { ...button, robotId, access: 'QUEUE_TURN', isEnabled: true },
      });
    }
  }
}

async function ensureDemoData(admin: NonNullable<Awaited<ReturnType<typeof ensureInitialAdmin>>>) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SEED_DEMO_DATA and SEED_E2E_FIXTURES are forbidden in production.');
  }

  const demoPassword = process.env.SEED_DEMO_USER_PASSWORD?.trim();
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error('SEED_DEMO_USER_PASSWORD with at least 12 characters is required for demo data.');
  }
  const user = await prisma.user.upsert({
    where: { email: 'user@botparty.local' },
    update: {},
    create: {
      username: 'demo_user',
      email: 'user@botparty.local',
      passwordHash: await hash(demoPassword),
      displayName: 'Demo User',
      role: 'USER',
      emailVerified: true,
    },
  });
  const robot = await ensureSeedRobot({
    ownerId: user.id,
    name: 'Demo Robot',
    description: 'Local demo robot.',
    tags: ['demo'],
  });
  await ensureButtons(robot.id);

  if (enabled('SEED_E2E_FIXTURES')) {
    const testRobot = await ensureSeedRobot({
      ownerId: admin.id,
      name: 'Test Robot',
      description: 'Deterministic Playwright fixture.',
      tags: ['test', 'e2e'],
      fixedSlug: 'test-robot',
    });
    await ensureButtons(testRobot.id);
  }
  console.log('✅ Optional local seed data converged.');
}

async function main() {
  await ensurePlatformUser();
  const admin = await ensureInitialAdmin();
  if (enabled('SEED_DEMO_DATA') || enabled('SEED_E2E_FIXTURES')) {
    if (!admin) throw new Error('SEED_ADMIN_PASSWORD is required when optional fixtures are enabled.');
    await ensureDemoData(admin);
  }
}

main()
  .catch((error) => {
    console.error(`Seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
