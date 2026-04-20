import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ModerationActionType, WS_EVENTS } from '@botparty/shared';
import { ModerationService } from './moderation.service';

function createPipeline() {
  return {
    incr: jest.fn().mockReturnThis(),
    hincrby: jest.fn().mockReturnThis(),
    lpush: jest.fn().mockReturnThis(),
    ltrim: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
}

function buildService() {
  const pipeline = createPipeline();
  const prisma = {
    robot: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    robotModerationEntry: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    lrange: jest.fn().mockResolvedValue([]),
    pipeline: jest.fn().mockReturnValue(pipeline),
  };

  const service = new ModerationService(
    prisma as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, prisma, redis, pipeline };
}

describe('ModerationService text filtering', () => {
  const { service } = buildService();

  it('sanitizes control characters and collapses whitespace', () => {
    const result = service.sanitizeChatContent(' hello\u0000\n\tworld  ');
    expect(result.sanitized).toBe('hello world');
    expect(result.hasIllegalChars).toBe(true);
  });

  it('detects obvious profanity patterns', () => {
    expect(service.containsProfanity('this is shit')).toBe(true);
    expect(service.containsProfanity('friendly message')).toBe(false);
  });

  it('detects forbidden hate symbols and masked hate phrases', () => {
    expect(service.containsForbiddenSymbols('heil hitler')).toBe(true);
    expect(service.containsForbiddenSymbols('normal message')).toBe(false);
  });

  it('masks profane words in normalized content', () => {
    expect(service.maskProfanity('this is shit')).toBe('this is s***');
    expect(service.maskProfanity('clean chat')).toBe('clean chat');
  });
});

describe('ModerationService moderation flows', () => {
  it('denies moderation by non-owners and non-staff users', async () => {
    const { service, prisma } = buildService();
    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'viewer-1', role: 'USER' })
      .mockResolvedValueOnce({ id: 'target-1', role: 'USER', username: 'pilot', displayName: null });

    await expect(
      service.moderate(
        'robot-1',
        { targetUserId: 'target-1', action: ModerationActionType.BAN },
        'viewer-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates an active ban entry and publishes a websocket moderation event', async () => {
    const { service, prisma, redis } = buildService();
    const createdEntry = { id: 'entry-1', action: ModerationActionType.BAN, userId: 'target-1' };
    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'owner-1', role: 'USER' })
      .mockResolvedValueOnce({ id: 'target-1', role: 'USER', username: 'pilot', displayName: 'Pilot' });
    prisma.robotModerationEntry.findFirst.mockResolvedValueOnce(null);
    prisma.robotModerationEntry.create.mockResolvedValueOnce(createdEntry);

    await expect(
      service.moderate(
        'robot-1',
        { targetUserId: 'target-1', action: ModerationActionType.BAN, reason: 'abuse' },
        'owner-1',
      ),
    ).resolves.toEqual(createdEntry);

    expect(prisma.robotModerationEntry.updateMany).toHaveBeenCalledWith({
      where: { robotId: 'robot-1', userId: 'target-1', isActive: true },
      data: { isActive: false },
    });
    expect(prisma.robotModerationEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        robotId: 'robot-1',
        userId: 'target-1',
        action: ModerationActionType.BAN,
        isActive: true,
        moderatorId: 'owner-1',
      }),
    });
    expect(redis.publish).toHaveBeenCalledWith(
      'ws:moderation:robot-1',
      expect.stringContaining(`"event":"${WS_EVENTS.MOD_BAN}"`),
    );
  });

  it('requires durationSec for timeouts', async () => {
    const { service, prisma } = buildService();
    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'owner-1', role: 'USER' })
      .mockResolvedValueOnce({ id: 'target-1', role: 'USER', username: 'pilot', displayName: null });
    prisma.robotModerationEntry.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.moderate(
        'robot-1',
        { targetUserId: 'target-1', action: ModerationActionType.TIMEOUT },
        'owner-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unban requests when the user is not currently banned', async () => {
    const { service, prisma } = buildService();
    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'owner-1', role: 'USER' })
      .mockResolvedValueOnce({ id: 'target-1', role: 'USER', username: 'pilot', displayName: null });
    prisma.robotModerationEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      service.moderate(
        'robot-1',
        { targetUserId: 'target-1', action: ModerationActionType.UNBAN },
        'owner-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores guest timeout restrictions in Redis and publishes the moderation event', async () => {
    const { service, prisma, redis } = buildService();
    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'owner-1', role: 'USER' });
    redis.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK');

    const result = await service.moderate(
      'robot-1',
      { targetUserId: 'guest:viewer-1', action: ModerationActionType.TIMEOUT, durationSec: 60 },
      'owner-1',
    );

    expect(result).toEqual(expect.objectContaining({
      robotId: 'robot-1',
      userId: 'guest:viewer-1',
      action: ModerationActionType.TIMEOUT,
      isActive: true,
    }));
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      'moderation:guest:restriction:robot-1:guest:viewer-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      'ws:moderation:robot-1',
      expect.stringContaining(`"event":"${WS_EVENTS.MOD_TIMEOUT}"`),
    );
  });

  it('expires stale persisted restrictions lazily', async () => {
    const { service, prisma } = buildService();
    prisma.robotModerationEntry.findFirst.mockResolvedValueOnce({
      id: 'entry-1',
      action: ModerationActionType.TIMEOUT,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.getActiveRestriction('robot-1', 'target-1')).resolves.toBeNull();

    expect(prisma.robotModerationEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { isActive: false },
    });
  });

  it('drops malformed guest restriction payloads', async () => {
    const { service, redis } = buildService();
    redis.get.mockResolvedValueOnce('not-json');

    await expect(service.getActiveRestriction('robot-1', 'guest:viewer-1')).resolves.toBeNull();

    expect(redis.del).toHaveBeenCalledWith('moderation:guest:restriction:robot-1:guest:viewer-1');
  });

  it('records profanity metrics via the Redis pipeline', async () => {
    const { service, pipeline, redis } = buildService();

    await service.recordProfanityEvent({
      robotId: 'robot-1',
      userId: 'user-1',
      username: 'pilot',
      content: 'blocked message',
    });

    expect(redis.pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline.incr).toHaveBeenCalledWith('moderation:profanity:robot:robot-1:total');
    expect(pipeline.hincrby).toHaveBeenCalledWith('moderation:profanity:robot:robot-1:by-user', 'user-1', 1);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });
});
