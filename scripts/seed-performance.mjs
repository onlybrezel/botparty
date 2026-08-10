import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const profiles = {
  small: {
    users: 100,
    robots: 500,
    sessions: 5_000,
    notifications: 10_000,
    auditLogs: 20_000,
    analyticsEvents: 20_000,
    chatMessages: 10_000,
  },
  medium: {
    users: 1_000,
    robots: 5_000,
    sessions: 50_000,
    notifications: 100_000,
    auditLogs: 200_000,
    analyticsEvents: 200_000,
    chatMessages: 100_000,
  },
  large: {
    users: 2_500,
    robots: 15_000,
    sessions: 150_000,
    notifications: 300_000,
    auditLogs: 600_000,
    analyticsEvents: 600_000,
    chatMessages: 300_000,
  },
};

const profileName = process.env.PERFORMANCE_DATASET ?? 'small';
const profile = profiles[profileName];
const databaseUrl = process.env.DATABASE_URL ?? '';
if (process.env.PERFORMANCE_FIXTURE_ALLOW_WRITES !== 'true') {
  throw new Error('PERFORMANCE_FIXTURE_ALLOW_WRITES=true is required.');
}
if (!profile) {
  throw new Error(`Unknown PERFORMANCE_DATASET ${profileName}.`);
}
if (!/\/botparty_performance(?:\?|$)/.test(databaseUrl)) {
  throw new Error('Performance fixtures require the botparty_performance database.');
}

const clientPath =
  process.env.PERFORMANCE_PRISMA_CLIENT_PATH ?? '/app/packages/prisma/generated/client/index.js';
const { PrismaClient } = await import(pathToFileURL(clientPath).href);
const { createPrismaAdapter } = await import('../packages/prisma/client.js');
const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
const disabledPasswordHash =
  '$argon2id$v=19$m=65536,t=3,p=4$disabled-disabled-disabled-disabled$disabled-disabled-disabled-disabled-disabled-disabled-disabled';

function stableUuid(namespace, index) {
  const value = createHash('sha256').update(`${namespace}:${index}`).digest('hex').slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function stableHash(namespace, index) {
  return createHash('sha256').update(`${namespace}:${index}`).digest('hex');
}

async function createInBatches(label, total, build, write, batchSize = 1_000) {
  for (let offset = 0; offset < total; offset += batchSize) {
    const end = Math.min(offset + batchSize, total);
    const rows = Array.from({ length: end - offset }, (_, position) => build(offset + position));
    await write(rows);
    if (end === total || end % 50_000 === 0) {
      console.log(`${label}: ${end}/${total}`);
    }
  }
}

const userId = (index) => stableUuid('performance-user', index);
const robotId = (index) => stableUuid('performance-robot', index);
const largestHistory = Math.max(
  profile.sessions,
  profile.notifications,
  profile.auditLogs,
  profile.analyticsEvents,
  profile.chatMessages,
);
const startedAt = process.env.PERFORMANCE_FIXTURE_BASE_TIME
  ? new Date(process.env.PERFORMANCE_FIXTURE_BASE_TIME)
  : new Date(Date.now() - (largestHistory + 60) * 1_000);
if (Number.isNaN(startedAt.getTime())) {
  throw new Error('PERFORMANCE_FIXTURE_BASE_TIME must be an ISO-8601 timestamp.');
}

try {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.PERFORMANCE_EMAIL ?? 'admin@botparty.test' },
    select: { id: true },
  });
  await prisma.user.update({
    where: { id: admin.id },
    data: { productAnalyticsEnabled: true, productAnalyticsConsentAt: new Date() },
  });

  await createInBatches(
    'users',
    profile.users,
    (index) => ({
      id: userId(index),
      username: `perf_user_${String(index).padStart(6, '0')}`,
      email: `perf-user-${index}@example.invalid`,
      passwordHash: disabledPasswordHash,
      displayName: `Performance User ${index}`,
      emailVerified: true,
      createdAt: startedAt,
      updatedAt: startedAt,
    }),
    (data) => prisma.user.createMany({ data, skipDuplicates: true }),
  );

  await createInBatches(
    'robots',
    profile.robots,
    (index) => ({
      id: robotId(index),
      ownerId: index === 0 ? admin.id : userId(index % profile.users),
      name: index === 0 ? 'Performance Primary Robot' : `Performance Robot ${index}`,
      slug: index === 0 ? 'perf-primary' : `perf-robot-${index}`,
      description: `Synthetic performance fixture ${index} ${'x'.repeat(index % 128)}`,
      visibility: 'PUBLIC',
      accessMode: 'OPEN',
      status: index % 5 === 0 ? 'ONLINE' : index % 7 === 0 ? 'BUSY' : 'OFFLINE',
      isFeatured: index % 50 === 0,
      viewerCount: index % 250,
      totalSessions: index * 3,
      totalViewers: index * 5,
      tags: [`group-${index % 20}`, index % 2 === 0 ? 'indoor' : 'outdoor'],
      streamKeyHash: stableHash('performance-stream', index),
      claimTokenHash: stableHash('performance-claim', index),
      createdAt: new Date(startedAt.getTime() + index * 1_000),
      updatedAt: startedAt,
    }),
    (data) => prisma.robot.createMany({ data, skipDuplicates: true }),
  );

  await createInBatches(
    'sessions',
    profile.sessions,
    (index) => ({
      id: stableUuid('performance-session', index),
      robotId: robotId(index % profile.robots),
      userId: userId(index % profile.users),
      status: 'ENDED',
      startedAt: new Date(startedAt.getTime() + index * 1_000),
      endedAt: new Date(startedAt.getTime() + index * 1_000 + 60_000),
      durationMs: 60_000,
      peakViewers: index % 50,
      totalCommands: index % 200,
      avgLatencyMs: 15 + (index % 50),
      createdAt: new Date(startedAt.getTime() + index * 1_000),
    }),
    (data) => prisma.session.createMany({ data, skipDuplicates: true }),
  );

  await createInBatches(
    'notifications',
    profile.notifications,
    (index) => ({
      id: stableUuid('performance-notification', index),
      userId: index % 5 === 0 ? admin.id : userId(index % profile.users),
      kind: 'PERFORMANCE',
      category: 'SYSTEM',
      title: `Performance notification ${index}`,
      body: `Synthetic notification body ${index}`,
      dedupeKey: `performance:${index}`,
      emailStatus: 'SKIPPED',
      createdAt: new Date(startedAt.getTime() + index * 1_000),
      updatedAt: startedAt,
    }),
    (data) => prisma.notification.createMany({ data, skipDuplicates: true }),
  );

  await createInBatches(
    'audit logs',
    profile.auditLogs,
    (index) => ({
      id: stableUuid('performance-audit', index),
      actorId: admin.id,
      action: `performance_${index % 8}`,
      targetType: 'robot',
      targetId: robotId(index % profile.robots),
      payload: { fixture: true, sequence: index },
      createdAt: new Date(startedAt.getTime() + index * 1_000),
    }),
    (data) => prisma.adminAuditLog.createMany({ data, skipDuplicates: true }),
  );

  await createInBatches(
    'analytics events',
    profile.analyticsEvents,
    (index) => ({
      id: stableUuid('performance-analytics', index),
      robotId: robotId(index % profile.robots),
      userId: index % 5 === 0 ? admin.id : userId(index % profile.users),
      event: index % 10 === 0 ? 'PERFORMANCE_WEB_VITAL' : 'DISCOVERY_ROBOT_VIEW',
      payload:
        index % 10 === 0 ? { metric: 'LCP', value: 1_500 + (index % 1_000) } : { fixture: true },
      createdAt: new Date(startedAt.getTime() + index * 1_000),
    }),
    (data) => prisma.analyticsEvent.createMany({ data, skipDuplicates: true }),
  );

  await createInBatches(
    'chat messages',
    profile.chatMessages,
    (index) => ({
      id: stableUuid('performance-chat', index),
      robotId: robotId(index % profile.robots),
      userId: userId(index % profile.users),
      clientMessageId: stableUuid('performance-chat-client', index),
      content: `Synthetic chat message ${index}`,
      createdAt: new Date(startedAt.getTime() + index * 1_000),
    }),
    (data) => prisma.chatMessage.createMany({ data, skipDuplicates: true }),
  );

  const queueSize = Math.min(profile.users, 1_000);
  await prisma.queueEntry.deleteMany({ where: { robotId: robotId(0) } });
  await prisma.queueEntry.createMany({
    data: Array.from({ length: queueSize }, (_, index) => ({
      id: stableUuid('performance-queue', index),
      robotId: robotId(0),
      userId: userId(index),
      position: index + 1,
      joinedAt: new Date(startedAt.getTime() + index * 1_000),
    })),
  });

  await prisma.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_stat_statements_reset(); END $$');
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.robot.count(),
    prisma.session.count(),
    prisma.notification.count(),
    prisma.adminAuditLog.count(),
    prisma.analyticsEvent.count(),
    prisma.chatMessage.count(),
    prisma.queueEntry.count(),
  ]);
  console.log(
    JSON.stringify(
      {
        profile: profileName,
        counts: {
          users: counts[0],
          robots: counts[1],
          sessions: counts[2],
          notifications: counts[3],
          auditLogs: counts[4],
          analyticsEvents: counts[5],
          chatMessages: counts[6],
          queueEntries: counts[7],
        },
        primaryRobotId: robotId(0),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
