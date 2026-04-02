import { PrismaClient } from './generated/client/index.js';
import { hash } from 'argon2';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function slugBase(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function createUniqueSlug(base: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${base}-${randomBytes(3).toString('hex')}`;
    const exists = await prisma.robot.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
  }
  throw new Error(`Could not generate unique slug for base ${base}`);
}

async function ensureSeedRobot(input: {
  ownerId: string;
  name: string;
  description: string;
  tags: string[];
}) {
  const base = slugBase(input.name);

  const existing = await prisma.robot.findFirst({
    where: {
      ownerId: input.ownerId,
      OR: [{ name: input.name }, { slug: { startsWith: `${base}-` } }],
    },
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
        maxTurnTime: 60000,
        tags: input.tags,
      },
    });
  }

  const slug = await createUniqueSlug(base);
  return prisma.robot.create({
    data: {
      name: input.name,
      slug,
      description: input.description,
      ownerId: input.ownerId,
      streamKey: randomBytes(32).toString('hex'),
      claimToken: randomBytes(32).toString('hex'),
      visibility: 'PUBLIC',
      accessMode: 'OPEN',
      queueMode: 'FIRST_COME',
      maxTurnTime: 60000,
      tags: input.tags,
    },
  });
}

async function main() {
  console.log('🌱 Seeding BotParty database...');

  // Create admin user
  const adminPassword = await hash('admin123456');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@botparty.io' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@botparty.io',
      passwordHash: adminPassword,
      displayName: 'BotParty Admin',
      role: 'ADMIN',
      balance: 10000,
      credits: 10000,
    },
  });
  console.log(`  ✅ Admin user: ${admin.username} (${admin.email})`);
  console.log(`     Password: admin123456`);

  // Create demo user
  const userPassword = await hash('user123456');
  const user = await prisma.user.upsert({
    where: { email: 'user@botparty.io' },
    update: {},
    create: {
      username: 'demo_user',
      email: 'user@botparty.io',
      passwordHash: userPassword,
      displayName: 'Demo User',
      role: 'USER',
      balance: 500,
      credits: 500,
    },
  });
  console.log(`  ✅ User: ${user.username}`);
  console.log(`     Password: user123456`);

  // Remove old fixed-slug demo robots from previous seed versions.
  await prisma.robot.deleteMany({
    where: {
      slug: { in: ['demo-bot', 'user-bot', 'admin-bot'] },
      ownerId: { in: [user.id, admin.id] },
    },
  });

  // Create/update seed robots with production-like slug format: <name>-<6hex>
  const userBot = await ensureSeedRobot({
    ownerId: user.id,
    name: 'User Bot',
    description: 'Demo robot owned by the regular user account.',
    tags: ['demo', 'user'],
  });

  const adminBot = await ensureSeedRobot({
    ownerId: admin.id,
    name: 'Admin Bot',
    description: 'Demo robot owned by the admin account.',
    tags: ['demo', 'admin'],
  });

  console.log(`  ✅ User robot: ${userBot.name} (${userBot.slug})`);
  console.log(`  ✅ Admin robot: ${adminBot.name} (${adminBot.slug})`);

  // Default control buttons for demo robot
  const defaultButtons = [
    { label: 'Forward', command: 'forward', hotKey: 'w', icon: '⬆️', cooldownMs: 100, position: 0 },
    { label: 'Left',    command: 'left',    hotKey: 'a', icon: '⬅️', cooldownMs: 100, position: 1 },
    { label: 'Back',    command: 'backward',hotKey: 's', icon: '⬇️', cooldownMs: 100, position: 2 },
    { label: 'Right',   command: 'right',   hotKey: 'd', icon: '➡️', cooldownMs: 100, position: 3 },
    { label: 'Action',  command: 'action_1',hotKey: 'f', icon: '⚡', cooldownMs: 500, position: 4 },
  ];

  // Delete and recreate buttons so seed stays idempotent.
  for (const robot of [userBot, adminBot]) {
    await prisma.controlButton.deleteMany({ where: { robotId: robot.id } });
    await prisma.controlButton.createMany({
      data: defaultButtons.map((btn) => ({
        robotId: robot.id,
        label: btn.label,
        command: btn.command,
        hotKey: btn.hotKey,
        icon: btn.icon,
        cooldownMs: btn.cooldownMs,
        access: 'QUEUE_TURN' as const,
        position: btn.position,
        isEnabled: true,
      })),
    });
  }
  console.log(`  ✅ Control buttons: ${defaultButtons.length} added per demo robot`);

  console.log('\n🎉 Seed complete!');
  console.log('\n📋 Login credentials:');
  console.log('   Admin:   admin@botparty.io   / admin123456');
  console.log('   User:    user@botparty.io    / user123456');
  console.log(`   User Bot URL:  /robot/${userBot.slug}`);
  console.log(`   Admin Bot URL: /robot/${adminBot.slug}`);
  console.log('   Web:     http://localhost:3000');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
