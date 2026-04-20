import { register } from 'prom-client';
import { HealthController } from './health.controller';

function createReply() {
  return {
    header: jest.fn().mockReturnThis(),
    send: jest.fn((body: string) => body),
  };
}

describe('HealthController.metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('publishes dependency, websocket, queue, and robot telemetry metrics', async () => {
    const now = Date.now();
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
      queueEntry: { count: jest.fn().mockResolvedValue(3) },
      robot: { findMany: jest.fn().mockResolvedValue([{ id: 'robot-1' }, { id: 'robot-2' }]) },
    };
    const redis = {
      ping: jest.fn().mockResolvedValue('PONG'),
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

    const controller = new HealthController(prisma as never, redis as never, gateway as never);
    const reply = createReply();

    await controller.metrics(reply as never);

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
  });

  it('falls back to zeroed dependency-backed metrics when prisma or redis are unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('db down')),
      queueEntry: { count: jest.fn().mockRejectedValue(new Error('db down')) },
      robot: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    const redis = {
      ping: jest.fn().mockRejectedValue(new Error('redis down')),
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

    const controller = new HealthController(prisma as never, redis as never, gateway as never);
    const reply = createReply();

    await controller.metrics(reply as never);

    const sentMetrics = reply.send.mock.calls.at(-1)?.[0];
    expect(typeof sentMetrics).toBe('string');
    const metrics = sentMetrics as string;
    expect(metrics).toContain('botparty_dependency_database_up 0');
    expect(metrics).toContain('botparty_dependency_redis_up 0');
    expect(metrics).toContain('botparty_queue_depth 0');
    expect(metrics).toContain('botparty_robot_telemetry_fresh_robots 0');
    expect(redis.mget).not.toHaveBeenCalled();
  });
});