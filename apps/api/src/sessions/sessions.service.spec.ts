import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
    session: {
      findMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    robot: { findUnique: jest.Mock; update: jest.Mock };
    analyticsEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let robotsService: {
    validateRoomAccess: jest.Mock;
    resolveGuestActorId: jest.Mock;
  };
  let robotWebhookService: {
    emitSessionStarted: jest.Mock;
    emitSessionEnded: jest.Mock;
  };
  let recordingAdminService: {
    findReplayCandidatesForSession: jest.Mock;
  };
  let analytics: {
    recordConsented: jest.Mock;
  };
  let service: SessionsService;

  beforeEach(() => {
    const session = {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    };
    const robot = {
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      session,
      robot,
      analyticsEvent: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn(
        async (callback: (tx: { session: typeof session; robot: typeof robot }) => unknown) =>
          callback({ session, robot }),
      ),
    };
    robotsService = {
      validateRoomAccess: jest.fn(),
      resolveGuestActorId: jest.fn(),
    };
    robotWebhookService = {
      emitSessionStarted: jest.fn(),
      emitSessionEnded: jest.fn(),
    };
    recordingAdminService = {
      findReplayCandidatesForSession: jest.fn().mockResolvedValue([]),
    };
    analytics = { recordConsented: jest.fn().mockResolvedValue({ accepted: true }) };
    service = new SessionsService(
      prisma as never,
      robotsService as never,
      robotWebhookService as never,
      recordingAdminService as never,
      analytics as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates a session atomically and relies on the active-session database constraint', async () => {
    prisma.session.create.mockResolvedValue({
      id: 'new-session',
      robotId: 'robot-1',
      userId: 'user-1',
    });
    prisma.robot.update.mockResolvedValue({ id: 'robot-1' });

    const session = await service.create('robot-1', 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: { id: undefined, robotId: 'robot-1', userId: 'user-1' },
    });
    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(robotWebhookService.emitSessionStarted).toHaveBeenCalledWith({
      id: 'new-session',
      robotId: 'robot-1',
      userId: 'user-1',
    });
    expect(session.id).toBe('new-session');
  });

  it('ends an active session and emits analytics and webhooks', async () => {
    const startedAt = new Date(Date.now() - 45_000);
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      robotId: 'robot-1',
      userId: 'user-1',
      status: 'ACTIVE',
      startedAt,
    });
    prisma.session.update.mockImplementation(async ({ data }) => ({
      id: 'session-1',
      robotId: 'robot-1',
      userId: 'user-1',
      status: data.status,
      startedAt,
      endedAt: data.endedAt,
      durationMs: data.durationMs,
    }));

    const ended = await service.end('session-1');

    expect(ended?.status).toBe('ENDED');
    expect(ended?.durationMs).toBeGreaterThanOrEqual(45_000);
    expect(robotWebhookService.emitSessionEnded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1' }),
    );
    expect(analytics.recordConsented).toHaveBeenCalledWith(
      'user-1',
      'SESSION_END',
      'robot-1',
      expect.objectContaining({ sessionId: 'session-1' }),
    );
  });

  it('rejects unauthenticated session-history access', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', visibility: 'PUBLIC' });
    robotsService.resolveGuestActorId.mockReturnValue('guest-1');

    await expect(service.findByRobotForRequester('robot-1', null)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not disclose private robots through session-history authorization errors', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'private-robot', visibility: 'PRIVATE' });
    robotsService.resolveGuestActorId.mockReturnValue('guest-1');
    robotsService.validateRoomAccess.mockResolvedValue(false);

    await expect(
      service.findByRobotForRequester('private-robot', null),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.findByRobotForRequester('private-robot', 'foreign-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps forbidden semantics for inaccessible public session history', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'public-robot', visibility: 'PUBLIC' });
    robotsService.validateRoomAccess.mockResolvedValue(false);

    await expect(
      service.findByRobotForRequester('public-robot', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects session-history access when the robot does not exist', async () => {
    prisma.robot.findUnique.mockResolvedValue(null);

    await expect(service.findByRobotForRequester('robot-1', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns requester-scoped robot sessions when room access is valid', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', visibility: 'PUBLIC' });
    robotsService.validateRoomAccess.mockResolvedValue(true);
    prisma.session.findMany.mockResolvedValue([{ id: 'session-1' }]);

    const sessions = await service.findByRobotForRequester('robot-1', 'user-1', 25, 'access-token');

    expect(robotsService.validateRoomAccess).toHaveBeenCalledWith({
      robotId: 'robot-1',
      actorId: 'user-1',
      roomAccessToken: 'access-token',
    });
    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { robotId: 'robot-1' }, take: 25 }),
    );
    expect(sessions).toEqual([{ id: 'session-1' }]);
  });

  it('returns replay details for the session owner', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      robotId: 'robot-1',
      status: 'ENDED',
      startedAt: new Date('2026-04-29T10:00:00.000Z'),
      endedAt: new Date('2026-04-29T10:10:00.000Z'),
      durationMs: 600_000,
      recordingUrl: null,
      peakViewers: 12,
      totalCommands: 40,
      avgLatencyMs: 90,
      metadata: null,
      robot: {
        id: 'robot-1',
        name: 'Test Robot',
        slug: 'test-robot',
        thumbnailUrl: null,
        ownerId: 'owner-1',
        owner: {
          id: 'owner-1',
          username: 'owner',
          displayName: 'Owner',
        },
      },
      user: {
        id: 'user-1',
        username: 'driver',
        displayName: 'Driver',
        avatarUrl: null,
      },
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    recordingAdminService.findReplayCandidatesForSession.mockResolvedValue([
      { fileName: 'session-1.mp4' },
    ]);

    const session = await service.findDetailForRequester('session-1', 'user-1');

    expect(recordingAdminService.findReplayCandidatesForSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
    });
    expect(session).toEqual(
      expect.objectContaining({
        id: 'session-1',
        replayCandidates: [{ fileName: 'session-1.mp4' }],
      }),
    );
  });

  it('reconciles orphaned active sessions on startup', async () => {
    const startedAt = new Date(Date.now() - 30_000);
    prisma.session.findMany.mockResolvedValue([{ id: 'session-1', startedAt }]);
    prisma.session.update.mockResolvedValue({ id: 'session-1' });

    await service.endAllActiveSessions();

    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({ status: 'ENDED' }),
      }),
    );
  });
});
