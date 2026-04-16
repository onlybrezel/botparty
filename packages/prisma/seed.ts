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
  const tableCounts = await prisma.$transaction([
    prisma.user.count(),
    prisma.robot.count(),
    prisma.robotAllowedUser.count(),
    prisma.transaction.count(),
    prisma.session.count(),
    prisma.queueEntry.count(),
    prisma.chatMessage.count(),
    prisma.swarmGroup.count(),
    prisma.analyticsEvent.count(),
    prisma.controlButton.count(),
    prisma.robotModerationEntry.count(),
  ]);
  const totalRows = tableCounts.reduce((sum, value) => sum + value, 0);

  if (totalRows > 0) {
    console.log(`⏭️  Seed skipped: database is not empty (${totalRows} existing rows).`);
    return;
  }

  console.log('🌱 Seeding BotParty database...');
  const appUrl = process.env.APP_URL ?? 'https://botparty.live';
  const isProduction = process.env.NODE_ENV === 'production';
  const adminPasswordPlain = process.env.SEED_ADMIN_PASSWORD?.trim() || (isProduction ? '' : 'admin123456');
  const demoUserPasswordPlain =
    process.env.SEED_DEMO_USER_PASSWORD?.trim() || (isProduction ? '' : 'user123456');

  if (!adminPasswordPlain) {
    throw new Error('SEED_ADMIN_PASSWORD is required to initialize an empty production database.');
  }

  // Create admin user
  const adminPassword = await hash(adminPasswordPlain);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@botparty.live' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@botparty.live',
      passwordHash: adminPassword,
      displayName: 'BotParty Admin',
      role: 'ADMIN',
      balance: 10000,
      credits: 10000,
    },
  });
  console.log(`  ✅ Admin user: ${admin.username} (${admin.email})`);
  if (!isProduction) {
    // Show dev-only credentials in stdout (not in logs). Never run seed in production.
    process.stdout.write(`     Password: ${adminPasswordPlain}\n`);
  }

  let user:
    | Awaited<ReturnType<typeof prisma.user.upsert>>
    | null = null;

  if (demoUserPasswordPlain) {
    const userPassword = await hash(demoUserPasswordPlain);
    user = await prisma.user.upsert({
      where: { email: 'user@botparty.live' },
      update: {},
      create: {
        username: 'demo_user',
        email: 'user@botparty.live',
        passwordHash: userPassword,
        displayName: 'Demo User',
        role: 'USER',
        balance: 500,
        credits: 500,
      },
    });
    console.log(`  ✅ User: ${user.username}`);
    if (!isProduction) {
      process.stdout.write(`     Password: ${demoUserPasswordPlain}\n`);
    }
  } else {
    console.log('  ℹ️  Demo user skipped (SEED_DEMO_USER_PASSWORD not set).');
  }

  // Create seed robots
  const userBot = user
    ? await ensureSeedRobot({
        ownerId: user.id,
        name: 'User Bot',
        description: 'Demo robot owned by the regular user account.',
        tags: ['demo', 'user'],
      })
    : null;

  const adminBot = await ensureSeedRobot({
    ownerId: admin.id,
    name: 'Admin Bot',
    description: 'Demo robot owned by the admin account.',
    tags: ['demo', 'admin'],
  });

  if (userBot) {
    console.log(`  ✅ User robot: ${userBot.name} (${userBot.slug})`);
  }
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
  for (const robot of [userBot, adminBot].filter((value): value is NonNullable<typeof value> => value !== null)) {
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
  if (!isProduction) {
    console.log('\n📋 Login credentials:');
    console.log(`   Admin:   admin@botparty.live   / ${adminPasswordPlain}`);
    if (user && demoUserPasswordPlain) {
      console.log(`   User:    user@botparty.live    / ${demoUserPasswordPlain}`);
    }
  } else {
    console.log('\n🔐 Initial admin account created from SEED_ADMIN_PASSWORD.');
  }
  if (userBot) {
    console.log(`   User Bot URL:  /robot/${userBot.slug}`);
  }
  console.log(`   Admin Bot URL: /robot/${adminBot.slug}`);
  console.log(`   Web:     ${appUrl}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
