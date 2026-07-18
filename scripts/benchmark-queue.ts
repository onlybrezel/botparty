import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaClient } from '../packages/prisma/generated/client/index.js';
import { QueueService } from '../apps/api/src/queue/queue.service.js';

const databaseUrl = process.env.DATABASE_URL ?? '';
const parsed = new URL(databaseUrl);
if (process.env.QUEUE_BENCHMARK_ALLOW_WRITES !== 'true' || !/benchmark/.test(parsed.pathname)) {
  throw new Error(
    'Queue benchmark requires QUEUE_BENCHMARK_ALLOW_WRITES=true and a database name containing benchmark',
  );
}
const prisma = new PrismaClient();
const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});
const prefix = `benchmark_${Date.now()}`;
const ownerId = randomUUID();
const robotId = randomUUID();
const users = Array.from({ length: 1025 }, (_, index) => ({
  id: randomUUID(),
  username: `${prefix}_${index}`.slice(0, 32),
  email: `${prefix}_${index}@example.invalid`,
  passwordHash: 'benchmark-disabled',
  emailVerified: true,
}));

function percentile(samples: number[], value: number) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * value) - 1)] ?? 0;
}

async function measure(operation: () => Promise<unknown>, runs = 20) {
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return { p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), samples };
}

async function main() {
  try {
    await prisma.user.create({
      data: {
        id: ownerId,
        username: `${prefix}_owner`.slice(0, 32),
        email: `${prefix}_owner@example.invalid`,
        passwordHash: 'benchmark-disabled',
        emailVerified: true,
      },
    });
    await prisma.user.createMany({ data: users });
    await prisma.robot.create({
      data: {
        id: robotId,
        ownerId,
        name: 'Queue benchmark',
        slug: `${prefix}-robot`,
        streamKeyHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        claimTokenHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        status: 'ONLINE',
        queueMode: 'FIRST_COME',
      },
    });
    await prisma.queueEntry.createMany({
      data: users
        .slice(0, 1000)
        .map((user, index) => ({ robotId, userId: user.id, position: index + 1 })),
    });

    const robots = {
      getAccessPolicy: async () => ({ control: 'AUTHENTICATED' }),
      findById: async () => ({ status: 'ONLINE' }),
      validateRoomAccess: async () => true,
      resolveGuestActorId: () => null,
    };
    const config = { get: () => '0' };
    const queue = new QueueService(
      prisma as never,
      redis as never,
      robots as never,
      config as never,
    );
    const read = await measure(() => queue.getQueue(robotId));

    const mutationSamples: number[] = [];
    for (const user of users.slice(1000, 1020)) {
      let started = performance.now();
      await queue.join(robotId, user.id);
      mutationSamples.push(performance.now() - started);
      started = performance.now();
      await queue.leave(robotId, user.id);
      mutationSamples.push(performance.now() - started);
    }
    const mutationP95 = percentile(mutationSamples, 0.95);
    const duplicatePositions = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT position FROM queue_entries WHERE "robotId" = ${robotId}::uuid GROUP BY position HAVING COUNT(*) > 1
    ) duplicate_positions
  `;
    const report = {
      queueSize: 1000,
      readP50Ms: Math.round(read.p50Ms * 100) / 100,
      readP95Ms: Math.round(read.p95Ms * 100) / 100,
      joinLeaveP95Ms: Math.round(mutationP95 * 100) / 100,
      duplicatePositions: Number(duplicatePositions[0]?.count ?? 0),
      budgets: { readP95Ms: 250, joinLeaveP95Ms: 500 },
    };
    console.log(JSON.stringify(report, null, 2));
    if (
      report.readP95Ms > report.budgets.readP95Ms ||
      report.joinLeaveP95Ms > report.budgets.joinLeaveP95Ms ||
      report.duplicatePositions !== 0
    ) {
      throw new Error('Queue benchmark budget failed');
    }
  } finally {
    await prisma.robot.deleteMany({ where: { id: robotId } }).catch(() => undefined);
    await prisma.user
      .deleteMany({
        where: { OR: [{ id: ownerId }, { username: { startsWith: prefix.slice(0, 20) } }] },
      })
      .catch(() => undefined);
    await redis.quit();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
