import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RobotActionQueueService } from './robot-action-queue.service';

describe('RobotActionQueueService', () => {
  let service: RobotActionQueueService;
  let prisma: {
    robot: {
      findUnique: jest.Mock;
    };
  };
  let redis: {
    lrange: jest.Mock;
    del: jest.Mock;
    rpush: jest.Mock;
    ltrim: jest.Mock;
    expire: jest.Mock;
  };
  let access: {
    getStreamPolicy: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      robot: {
        findUnique: jest.fn().mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' }),
      },
    };
    redis = {
      lrange: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
      rpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      expire: jest.fn().mockResolvedValue(1),
    };
    access = {
      getStreamPolicy: jest.fn().mockResolvedValue({ targetBitrateKbps: 1200 }),
    };
    service = new RobotActionQueueService(prisma as any, redis as any, access as any);
  });

  it('deduplicates queued actions by type', async () => {
    redis.lrange.mockResolvedValueOnce([
      JSON.stringify({ id: 'action-1', type: 'restart_video', createdAt: 1234 }),
    ]);

    const result = await service.enqueueActionForRobot('robot-1', { type: 'restart_video' });

    expect(result).toEqual({
      id: 'action-1',
      type: 'restart_video',
      createdAt: 1234,
      alreadyQueued: true,
    });
    expect(redis.rpush).not.toHaveBeenCalled();
  });

  it('queues new actions, trims history, and clears logs for log-stream actions', async () => {
    const result = await service.enqueueAction('robot-1', 'owner-1', { type: 'set_log_stream', durationSec: 30 });

    expect(result).toEqual(
      expect.objectContaining({
        type: 'set_log_stream',
        durationSec: 30,
        alreadyQueued: false,
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('robot:logs:robot-1');
    expect(redis.rpush).toHaveBeenCalledWith(
      'robot:actions:robot-1',
      expect.stringContaining('set_log_stream'),
    );
    expect(redis.ltrim).toHaveBeenCalledWith('robot:actions:robot-1', -50, -1);
    expect(redis.expire).toHaveBeenCalledWith('robot:actions:robot-1', 900);
  });

  it('returns pending actions and consumes them with current stream policy', async () => {
    redis.lrange
      .mockResolvedValueOnce([
        JSON.stringify({ id: 'action-1', type: 'restart_chat', createdAt: 1 }),
      ])
      .mockResolvedValueOnce([
        JSON.stringify({ id: 'action-2', type: 'restart_control', createdAt: 2 }),
      ]);

    const pending = await service.getPendingActions('robot-1', 'owner-1');
    const consumed = await service.consumeActionsByRobotId('robot-1');

    expect(pending).toEqual({
      robotId: 'robot-1',
      actions: [{ id: 'action-1', type: 'restart_chat', createdAt: 1 }],
    });
    expect(consumed).toEqual({
      robotId: 'robot-1',
      stream: { targetBitrateKbps: 1200 },
      actions: [{ id: 'action-2', type: 'restart_control', createdAt: 2 }],
    });
    expect(redis.del).toHaveBeenCalledWith('robot:actions:robot-1');
  });

  it('enforces robot existence and owner access', async () => {
    prisma.robot.findUnique.mockResolvedValueOnce(null);
    await expect(service.enqueueActionForRobot('robot-404', { type: 'restart_video' })).rejects.toThrow(
      NotFoundException,
    );

    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-2' });
    await expect(service.getPendingActions('robot-1', 'owner-1')).rejects.toThrow(ForbiddenException);
  });
});