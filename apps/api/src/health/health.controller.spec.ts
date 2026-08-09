import { register } from 'prom-client';
import { PayloadTooLargeException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthMetricsService } from './health-metrics.service';
import { HealthService } from './health.service';

type HealthServiceParameters = ConstructorParameters<typeof HealthService>;
type HealthMetricsServiceParameters = ConstructorParameters<typeof HealthMetricsService>;

function createReply() {
  return {
    header: jest.fn().mockReturnThis(),
    code: jest.fn().mockReturnThis(),
    send: jest.fn((body: string) => body),
  };
}

function createConfig(values: Record<string, string | boolean | undefined> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function createController(
  prisma: HealthServiceParameters[0],
  redis: HealthServiceParameters[1],
  gateway: HealthMetricsServiceParameters[1],
  config: HealthServiceParameters[2],
  livekitService: HealthServiceParameters[3],
  mailService: HealthServiceParameters[4],
  featureFlags: HealthServiceParameters[5],
  readPrisma: HealthServiceParameters[6],
) {
  const health = createHealthService(
    prisma,
    redis,
    config,
    livekitService,
    mailService,
    featureFlags,
    readPrisma,
  );
  const metrics = new HealthMetricsService(health, gateway);
  return new HealthController(health, metrics, config);
}

function createHealthService(
  prisma: HealthServiceParameters[0],
  redis: HealthServiceParameters[1],
  config: HealthServiceParameters[2],
  livekitService: HealthServiceParameters[3],
  mailService: HealthServiceParameters[4],
  featureFlags: HealthServiceParameters[5],
  readPrisma: HealthServiceParameters[6],
): HealthService {
  return new HealthService(
    prisma,
    redis,
    config,
    livekitService,
    mailService,
    featureFlags,
    readPrisma,
  );
}

const livekit = { listRooms: jest.fn().mockResolvedValue([]) };
const mail = {
  isEnabled: jest.fn().mockReturnValue(true),
  isAvailable: jest.fn().mockReturnValue(true),
};
const features = { isEnabled: jest.fn().mockReturnValue(false) };

const thumbnailStorageConfig = {
  THUMBNAIL_S3_BUCKET: 'botparty-thumbnails',
  THUMBNAIL_S3_REGION: 'us-east-1',
  THUMBNAIL_S3_ENDPOINT: 'http://seaweedfs:8333',
  THUMBNAIL_S3_ACCESS_KEY_ID: 'test-access',
  THUMBNAIL_S3_SECRET_ACCESS_KEY: 'test-secret',
};
function createReadPrisma(
  client: PublicDatabaseOverrides | HealthDatabaseOverrides,
  isReplicaConfigured = false,
  available = true,
): HealthServiceParameters[6] {
  return {
    client: createPublicDatabase(client),
    isReplicaConfigured,
    isAvailable: jest.fn().mockResolvedValue(available),
  };
}

type PublicDatabaseOverrides = {
  user?: { count?: jest.Mock };
  robot?: { count?: jest.Mock; aggregate?: jest.Mock };
  queueEntry?: { count?: jest.Mock };
  session?: { count?: jest.Mock };
};

function createPublicDatabase(
  overrides: PublicDatabaseOverrides = {},
): HealthServiceParameters[6]['client'] {
  return {
    user: { count: overrides.user?.count ?? jest.fn() },
    robot: {
      count: overrides.robot?.count ?? jest.fn(),
      aggregate: overrides.robot?.aggregate ?? jest.fn(),
    },
    queueEntry: { count: overrides.queueEntry?.count ?? jest.fn() },
    session: { count: overrides.session?.count ?? jest.fn() },
  };
}

type HealthDatabaseOverrides = {
  $queryRaw?: jest.Mock;
  user?: { count?: jest.Mock };
  queueEntry?: { count?: jest.Mock; findFirst?: jest.Mock };
  billingIntent?: { count?: jest.Mock };
  notification?: { count?: jest.Mock };
  robotWebhook?: { count?: jest.Mock };
  robot?: { count?: jest.Mock; aggregate?: jest.Mock; findMany?: jest.Mock };
  session?: { count?: jest.Mock };
};

function createDatabase(overrides: HealthDatabaseOverrides = {}): HealthServiceParameters[0] {
  const publicDatabase = createPublicDatabase(overrides);
  return {
    ...publicDatabase,
    $queryRaw: overrides.$queryRaw ?? jest.fn(),
    queueEntry: {
      ...publicDatabase.queueEntry,
      findFirst: overrides.queueEntry?.findFirst ?? jest.fn(),
    },
    billingIntent: { count: overrides.billingIntent?.count ?? jest.fn() },
    notification: { count: overrides.notification?.count ?? jest.fn() },
    robotWebhook: { count: overrides.robotWebhook?.count ?? jest.fn() },
    robot: {
      ...publicDatabase.robot,
      findMany: overrides.robot?.findMany ?? jest.fn(),
    },
  };
}

function createRedis(
  overrides: {
    ping?: jest.Mock;
    info?: jest.Mock;
    mget?: jest.Mock;
  } = {},
): HealthServiceParameters[1] {
  return {
    ping: overrides.ping ?? jest.fn(),
    info: overrides.info ?? jest.fn(),
    mget: overrides.mget ?? jest.fn(),
  };
}

describe('HealthController.metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('publishes dependency, websocket, queue, and robot telemetry metrics', async () => {
    const now = Date.now();
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([{ count: 4n }]),
      queueEntry: {
        count: jest.fn().mockResolvedValue(3),
        findFirst: jest.fn().mockResolvedValue({ joinedAt: new Date(now - 5_000) }),
      },
      billingIntent: { count: jest.fn().mockResolvedValue(2) },
      notification: { count: jest.fn().mockResolvedValue(1) },
      robotWebhook: { count: jest.fn().mockResolvedValue(2) },
      robot: { findMany: jest.fn().mockResolvedValue([{ id: 'robot-1' }, { id: 'robot-2' }]) },
    };
    const redis = {
      ping: jest.fn().mockResolvedValue('PONG'),
      info: jest.fn().mockResolvedValue('used_memory:12345\r\n'),
      mget: jest.fn().mockResolvedValue([
        JSON.stringify({
          ts: now,
          cpuPercent: 55,
          memoryPercent: 40,
          temperatureC: 61.5,
          controlConnected: true,
          livekitConnected: true,
        }),
        JSON.stringify({
          ts: now - 400_000,
          cpuPercent: 80,
          memoryPercent: 70,
          temperatureC: 70,
          controlConnected: true,
          livekitConnected: false,
        }),
      ]),
    };
    const gateway = {
      getRuntimeMetricsSnapshot: jest.fn().mockReturnValue({
        connectedClients: 6,
        connectedRobotClients: 2,
        activeRooms: 4,
        roomMemberships: 9,
        activeTurns: 1,
        controlCooldowns: 2,
      }),
    };

    const controller = createController(
      createDatabase(prisma),
      createRedis(redis),
      gateway,
      createConfig({ NODE_ENV: 'development' }),
      livekit,
      mail,
      features,
      createReadPrisma(prisma),
    );
    const reply = createReply();

    await controller.metrics(undefined, reply);

    expect(reply.header).toHaveBeenCalledWith('Content-Type', register.contentType);

    const sentMetrics = reply.send.mock.calls.at(-1)?.[0];
    if (typeof sentMetrics !== 'string') {
      throw new Error('Expected metrics response to be a string');
    }
    const metrics = sentMetrics;
    expect(metrics).toContain('botparty_dependency_database_up 1');
    expect(metrics).toContain('botparty_dependency_redis_up 1');
    expect(metrics).toContain('botparty_ws_connected_clients 6');
    expect(metrics).toContain('botparty_queue_depth 3');
    expect(metrics).toContain('botparty_robot_telemetry_fresh_robots 1');
    expect(metrics).toContain('botparty_robot_telemetry_control_connected_robots 1');
    expect(metrics).toContain('botparty_robot_telemetry_livekit_connected_robots 1');
    expect(metrics).toContain('botparty_robot_telemetry_avg_cpu_percent 55');
    expect(metrics).toContain('botparty_robot_telemetry_avg_memory_percent 40');
    expect(metrics).toContain('botparty_robot_telemetry_avg_temperature_c 61.5');
    expect(metrics).toContain('botparty_queue_oldest_entry_age_seconds');
    expect(metrics).toContain('botparty_billing_needs_review 2');
    expect(metrics).toContain('botparty_notification_email_failed 1');
    expect(metrics).toContain('botparty_webhook_delivery_failed 2');
    expect(metrics).toContain('botparty_database_connections 4');
    expect(metrics).toContain('botparty_redis_memory_used_bytes 12345');
    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 250,
    });
    expect(redis.mget).toHaveBeenCalledWith(
      'robot:telemetry:robot-1:latest',
      'robot:telemetry:robot-2:latest',
    );
  });

  it('falls back to zeroed dependency-backed metrics when prisma or redis are unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('db down')),
      queueEntry: {
        count: jest.fn().mockRejectedValue(new Error('db down')),
        findFirst: jest.fn().mockRejectedValue(new Error('db down')),
      },
      billingIntent: { count: jest.fn().mockRejectedValue(new Error('db down')) },
      notification: { count: jest.fn().mockRejectedValue(new Error('db down')) },
      robotWebhook: { count: jest.fn().mockRejectedValue(new Error('db down')) },
      robot: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    const redis = {
      ping: jest.fn().mockRejectedValue(new Error('redis down')),
      info: jest.fn().mockRejectedValue(new Error('redis down')),
      mget: jest.fn(),
    };
    const gateway = {
      getRuntimeMetricsSnapshot: jest.fn().mockReturnValue({
        connectedClients: 0,
        connectedRobotClients: 0,
        activeRooms: 0,
        roomMemberships: 0,
        activeTurns: 0,
        controlCooldowns: 0,
      }),
    };

    const controller = createController(
      createDatabase(prisma),
      createRedis(redis),
      gateway,
      createConfig({ NODE_ENV: 'development' }),
      livekit,
      mail,
      features,
      createReadPrisma(prisma, true, false),
    );
    const reply = createReply();

    await controller.metrics(undefined, reply);

    const sentMetrics = reply.send.mock.calls.at(-1)?.[0];
    if (typeof sentMetrics !== 'string') {
      throw new Error('Expected metrics response to be a string');
    }
    const metrics = sentMetrics;
    expect(metrics).toContain('botparty_dependency_database_up 0');
    expect(metrics).toContain('botparty_dependency_redis_up 0');
    expect(metrics).toContain('botparty_queue_depth 0');
    expect(metrics).toContain('botparty_robot_telemetry_fresh_robots 0');
    expect(redis.mget).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated metrics requests when metrics auth is required', async () => {
    const gateway = {
      getRuntimeMetricsSnapshot: jest.fn(),
    };

    const controller = createController(
      createDatabase({
        $queryRaw: jest.fn(),
        queueEntry: { count: jest.fn() },
        robot: { findMany: jest.fn() },
      }),
      createRedis({ ping: jest.fn(), mget: jest.fn() }),
      gateway,
      createConfig({
        NODE_ENV: 'production',
        METRICS_AUTH_REQUIRED: true,
        METRICS_USERNAME: 'metrics',
        METRICS_PASSWORD: 'super-secret-password',
      }),
      livekit,
      mail,
      features,
      createReadPrisma({}),
    );
    const reply = createReply();

    await controller.metrics(undefined, reply);

    expect(reply.header).toHaveBeenCalledWith('www-authenticate', 'Basic realm="BotParty Metrics"');
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Authentication required' });
    expect(gateway.getRuntimeMetricsSnapshot).not.toHaveBeenCalled();
  });

  it('accepts CSP violation reports without throwing', () => {
    const controller = createController(
      createDatabase({
        $queryRaw: jest.fn(),
        queueEntry: { count: jest.fn() },
        robot: { findMany: jest.fn() },
      }),
      createRedis({ ping: jest.fn(), mget: jest.fn() }),
      { getRuntimeMetricsSnapshot: jest.fn() },
      createConfig({ NODE_ENV: 'development' }),
      livekit,
      mail,
      features,
      createReadPrisma({}),
    );

    expect(
      controller.cspReport({ 'csp-report': { 'violated-directive': 'script-src-elem' } }),
    ).toBeUndefined();

    expect(() =>
      controller.cspReport({ 'csp-report': { 'violated-directive': 'ü'.repeat(9_000) } }),
    ).toThrow(PayloadTooLargeException);
  });
});

describe('HealthController readiness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is ready only when schema, database, redis, video, and storage are available', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([{ total: 10n, pending: 0n }]),
    };
    const redis = { ping: jest.fn().mockResolvedValue('PONG') };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const controller = createController(
      createDatabase(prisma),
      createRedis(redis),
      { getRuntimeMetricsSnapshot: jest.fn() },
      createConfig(thumbnailStorageConfig),
      livekit,
      mail,
      features,
      createReadPrisma(prisma),
    );

    await expect(controller.check()).resolves.toMatchObject({
      status: 'healthy',
      checks: {
        discovery: 'ok',
        migrations: 'ok',
        auth: 'ok',
        control: 'ok',
        video: 'ok',
        storage: 'ok',
      },
    });
  });

  it('rejects readiness when no completed migration exists or storage is unavailable', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([{ total: 0n, pending: 0n }]),
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const controller = createController(
      createDatabase(prisma),
      createRedis({ ping: jest.fn().mockResolvedValue('PONG') }),
      { getRuntimeMetricsSnapshot: jest.fn() },
      createConfig(thumbnailStorageConfig),
      livekit,
      mail,
      features,
      createReadPrisma(prisma),
    );
    const reply = createReply();

    await controller.ready(reply);

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        checks: expect.objectContaining({ migrations: 'error', storage: 'error' }),
      }),
    );
  });

  it('returns degraded within the dependency deadline when database checks hang', async () => {
    jest.useFakeTimers();
    const never = new Promise<never>(() => undefined);
    const prisma = { $queryRaw: jest.fn().mockReturnValue(never) };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const controller = createController(
      createDatabase(prisma),
      createRedis({ ping: jest.fn().mockResolvedValue('PONG') }),
      { getRuntimeMetricsSnapshot: jest.fn() },
      createConfig(),
      livekit,
      mail,
      features,
      createReadPrisma(prisma),
    );
    const reply = createReply();

    const readiness = controller.ready(reply);
    await jest.advanceTimersByTimeAsync(2_000);
    await readiness;

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        checks: expect.objectContaining({ discovery: 'error', migrations: 'error' }),
      }),
    );
    jest.useRealTimers();
  });
});

describe('HealthService public stats', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces concurrent refreshes and reuses the short-lived public snapshot', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-18T12:00:00.000Z') });
    const database = {
      user: { count: jest.fn().mockResolvedValue(10) },
      robot: {
        count: jest.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(3),
        aggregate: jest.fn().mockResolvedValue({ _sum: { viewerCount: 40 } }),
      },
      queueEntry: { count: jest.fn().mockResolvedValue(5) },
      session: { count: jest.fn().mockResolvedValue(6) },
    };
    const health = createHealthService(
      createDatabase(database),
      createRedis(),
      createConfig(),
      livekit,
      mail,
      features,
      createReadPrisma(database),
    );

    const [first, concurrent] = await Promise.all([
      health.getPublicStats(),
      health.getPublicStats(),
    ]);
    const cached = await health.getPublicStats();

    expect(concurrent).toBe(first);
    expect(cached).toBe(first);
    expect(database.user.count).toHaveBeenCalledTimes(1);
    expect(database.robot.count).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(5_001);
    await health.getPublicStats();

    expect(database.user.count).toHaveBeenCalledTimes(2);
    expect(database.robot.count).toHaveBeenCalledTimes(4);
  });
});
