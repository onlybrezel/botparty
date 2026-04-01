import { PrismaClient } from './generated/client/index.js';
import { hash } from 'argon2';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

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

  // Create demo robot
  const robot = await prisma.robot.upsert({
    where: { slug: 'demo-bot' },
    update: {},
    create: {
      name: 'Demo Bot',
      slug: 'demo-bot',
      description: 'A demo robot to test the BotParty platform. Connect your own robot to replace this!',
      ownerId: user.id,
      streamKey: randomBytes(32).toString('hex'),
      claimToken: randomBytes(32).toString('hex'),
      visibility: 'PUBLIC',
      accessMode: 'OPEN',
      queueMode: 'FIRST_COME',
      maxTurnTime: 60000,
      tags: ['demo', 'beginner-friendly'],
    },
  });
  console.log(`  ✅ Demo robot: ${robot.name} (${robot.slug})`);

  // Default control buttons for demo robot
  const defaultButtons = [
    { label: 'Forward', command: 'forward', hotKey: 'w', icon: '⬆️', cooldownMs: 100, position: 0 },
    { label: 'Left',    command: 'left',    hotKey: 'a', icon: '⬅️', cooldownMs: 100, position: 1 },
    { label: 'Back',    command: 'backward',hotKey: 's', icon: '⬇️', cooldownMs: 100, position: 2 },
    { label: 'Right',   command: 'right',   hotKey: 'd', icon: '➡️', cooldownMs: 100, position: 3 },
    { label: 'Action',  command: 'action_1',hotKey: 'f', icon: '⚡', cooldownMs: 500, position: 4 },
  ];

  // Delete and recreate so seed stays idempotent without needing UUID literals
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
  console.log(`  ✅ Control buttons: ${defaultButtons.length} added for Demo Bot`);

  console.log('\n🎉 Seed complete!');
  console.log('\n📋 Login credentials:');
  console.log('   Admin:   admin@botparty.io   / admin123456');
  console.log('   User:    user@botparty.io    / user123456');
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
