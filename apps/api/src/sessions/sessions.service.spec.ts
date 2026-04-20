import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let prisma: {
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
      session,
      robot,
      analyticsEvent: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn(async (callback: (tx: { session: typeof session; robot: typeof robot }) => unknown) =>
        callback({ session, robot })),
    };
    robotsService = {
      validateRoomAccess: jest.fn(),
      resolveGuestActorId: jest.fn(),
    };
    robotWebhookService = {
      emitSessionStarted: jest.fn(),
      emitSessionEnded: jest.fn(),
    };
    service = new SessionsService(prisma as never, robotsService as never, robotWebhookService as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('ends prior active sessions before creating a new one', async () => {
    const startedAt = new Date('2024-01-01T00:00:00.000Z');
    const now = new Date('2024-01-01T00:01:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.session.findMany.mockResolvedValue([{ id: 'old-session', startedAt }]);
    prisma.session.create.mockResolvedValue({ id: 'new-session', robotId: 'robot-1', userId: 'user-1' });
    prisma.robot.update.mockResolvedValue({ id: 'robot-1' });

    const session = await service.create('robot-1', 'user-1');

    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-session' },
        data: expect.objectContaining({ status: 'ENDED', durationMs: 60_000 }),
      }),
    );
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
    expect(robotWebhookService.emitSessionEnded).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ event: 'session_end' }) }),
    );
  });

  it('rejects unauthenticated session-history access', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1' });
    robotsService.resolveGuestActorId.mockReturnValue('guest-1');

    await expect(service.findByRobotForRequester('robot-1', null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects session-history access when the robot does not exist', async () => {
    prisma.robot.findUnique.mockResolvedValue(null);

    await expect(service.findByRobotForRequester('robot-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns requester-scoped robot sessions when room access is valid', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1' });
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