import { register } from 'prom-client';
import { PayloadTooLargeException } from '@nestjs/common';
import { HealthController } from './health.controller';

function createReply() {
  return {
    header: jest.fn().mockReturnThis(),
    code: jest.fn().mockReturnThis(),
    send: jest.fn((body: string) => body),
  };
}

function createConfig(values: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

const livekit = { listRooms: jest.fn().mockResolvedValue([]) };
const mail = { isEnabled: jest.fn().mockReturnValue(true) };
const features = { isEnabled: jest.fn().mockReturnValue(false) };

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

    const controller = new HealthController(
      prisma as never,
      redis as never,
      gateway as never,
      createConfig({ NODE_ENV: 'development' }) as never,
      livekit as never,
      mail as never,
      features as never,
    );
    const reply = createReply();

    await controller.metrics(undefined, reply as never);

    expect(reply.header).toHaveBeenCalledWith('Content-Type', register.contentType);

    const sentMetrics = reply.send.mock.calls.at(-1)?.[0];
    expect(typeof sentMetrics).toBe('string');
    const metrics = sentMetrics as string;
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

    const controller = new HealthController(
      prisma as never,
      redis as never,
      gateway as never,
      createConfig({ NODE_ENV: 'development' }) as never,
      livekit as never,
      mail as never,
      features as never,
    );
    const reply = createReply();

    await controller.metrics(undefined, reply as never);

    const sentMetrics = reply.send.mock.calls.at(-1)?.[0];
    expect(typeof sentMetrics).toBe('string');
    const metrics = sentMetrics as string;
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

    const controller = new HealthController(
      {
        $queryRaw: jest.fn(),
        queueEntry: { count: jest.fn() },
        robot: { findMany: jest.fn() },
      } as never,
      { ping: jest.fn(), mget: jest.fn() } as never,
      gateway as never,
      createConfig({
        NODE_ENV: 'production',
        METRICS_USERNAME: 'metrics',
        METRICS_PASSWORD: 'super-secret-password',
      }) as never,
      livekit as never,
      mail as never,
      features as never,
    );
    const reply = createReply();

    await controller.metrics(undefined, reply as never);

    expect(reply.header).toHaveBeenCalledWith('www-authenticate', 'Basic realm="BotParty Metrics"');
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ message: 'Authentication required' });
    expect(gateway.getRuntimeMetricsSnapshot).not.toHaveBeenCalled();
  });

  it('accepts CSP violation reports without throwing', () => {
    const controller = new HealthController(
      {
        $queryRaw: jest.fn(),
        queueEntry: { count: jest.fn() },
        robot: { findMany: jest.fn() },
      } as never,
      { ping: jest.fn(), mget: jest.fn() } as never,
      { getRuntimeMetricsSnapshot: jest.fn() } as never,
      createConfig({ NODE_ENV: 'development' }) as never,
      livekit as never,
      mail as never,
      features as never,
    );

    expect(
      controller.cspReport({ 'csp-report': { 'violated-directive': 'script-src-elem' } }),
    ).toBeUndefined();

    expect(() =>
      controller.cspReport({ 'csp-report': { 'violated-directive': 'ü'.repeat(9_000) } }),
    ).toThrow(PayloadTooLargeException);
  });
});
