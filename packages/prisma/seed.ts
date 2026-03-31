import { PrismaClient } from '../generated/client/index.js';
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

  // Create demo creator
  const creatorPassword = await hash('creator123456');
  const creator = await prisma.user.upsert({
    where: { email: 'creator@botparty.io' },
    update: {},
    create: {
      username: 'demo_creator',
      email: 'creator@botparty.io',
      passwordHash: creatorPassword,
      displayName: 'Demo Creator',
      role: 'CREATOR',
      balance: 500,
      credits: 500,
    },
  });
  console.log(`  ✅ Creator user: ${creator.username}`);

  // Create demo robot
  const robot = await prisma.robot.upsert({
    where: { slug: 'demo-bot' },
    update: {},
    create: {
      name: 'Demo Bot',
      slug: 'demo-bot',
      description: 'A demo robot to test the BotParty platform. Connect your own robot to replace this!',
      ownerId: creator.id,
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

  console.log('\n🎉 Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
