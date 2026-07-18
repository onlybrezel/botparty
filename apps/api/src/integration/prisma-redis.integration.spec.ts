import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { PrismaClient } from '@botparty/prisma';
import Redis from 'ioredis';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer } from 'testcontainers';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === '1';
const describeIf = runIntegration ? describe : describe.skip;

describeIf('Prisma + Redis integration (testcontainers)', () => {
  let prisma: PrismaClient | null = null;
  let redis: Redis | null = null;
  let pgContainer: Awaited<ReturnType<PostgreSqlContainer['start']>> | null = null;
  let redisContainer: Awaited<ReturnType<GenericContainer['start']>> | null = null;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

    const databaseUrl = `${pgContainer.getConnectionUri()}?schema=public`;
    process.env.DATABASE_URL = databaseUrl;

    const repoRoot = path.resolve(process.cwd(), '../..');
    execFileSync(
      'pnpm',
      ['--filter', '@botparty/prisma', 'exec', 'prisma', 'db', 'push', '--skip-generate'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: 'pipe',
      },
    );

    prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });
    await prisma.$connect();

    redis = new Redis(redisContainer.getMappedPort(6379), redisContainer.getHost());
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await redis?.quit();
    await redisContainer?.stop();
    await pgContainer?.stop();
  }, 60_000);

  it('persists data in postgres and redis', async () => {
    if (!prisma || !redis) {
      throw new Error('integration dependencies not initialized');
    }

    const user = await prisma.user.create({
      data: {
        username: 'integration_user',
        email: 'integration_user@example.com',
        passwordHash: 'hash',
      },
    });

    const robot = await prisma.robot.create({
      data: {
        ownerId: user.id,
        name: 'Integration Robot',
        slug: 'integration-robot',
        streamKeyHash: 'a'.repeat(64),
        claimTokenHash: 'b'.repeat(64),
      },
    });

    await redis.set(`integration:robot:${robot.id}`, 'online');

    const [fromDb, fromRedis] = await Promise.all([
      prisma.robot.findUnique({ where: { id: robot.id } }),
      redis.get(`integration:robot:${robot.id}`),
    ]);

    expect(fromDb?.name).toBe('Integration Robot');
    expect(fromRedis).toBe('online');
  });
});
