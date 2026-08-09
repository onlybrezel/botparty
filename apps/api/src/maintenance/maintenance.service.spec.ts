import { MaintenanceService } from './maintenance.service';

class TestMaintenanceService extends MaintenanceService {
  rotateExpiredRobotStreamKeys() {
    return this._rotateExpiredRobotStreamKeys();
  }

  flushViewerCountsUnlocked() {
    return this._flushViewerCountsUnlocked();
  }
}

describe('MaintenanceService retention', () => {
  function createDatabase() {
    return {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      adminAuditLog: { deleteMany: jest.fn() },
      analyticsEvent: { deleteMany: jest.fn() },
      chatMessage: { deleteMany: jest.fn() },
      notification: { deleteMany: jest.fn() },
      queueEntry: { deleteMany: jest.fn() },
      robot: { findMany: jest.fn(), update: jest.fn() },
      robotModerationEntry: { deleteMany: jest.fn(), updateMany: jest.fn() },
      user: { updateMany: jest.fn() },
    };
  }
  it('purges or minimizes every configured content class while retaining newer rows by cutoff', async () => {
    const prisma = {
      ...createDatabase(),
      chatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $executeRaw: jest.fn().mockResolvedValue(3),
      robotModerationEntry: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      recording: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'recording-1', objectKey: 'sessions/a/camera.mp4' },
          { id: 'recording-2', objectKey: 'sessions/b/camera.mp4' },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    const storageDeletion = {
      recordingBucket: 'botparty-recordings',
      enqueue: jest.fn().mockResolvedValue(undefined),
      processDue: jest.fn().mockResolvedValue(0),
    };
    const service = new MaintenanceService(
      prisma,
      { set: jest.fn(), eval: jest.fn(), mget: jest.fn() },
      storageDeletion,
    );

    await service.enforceContentRetention();

    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.robotModerationEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, expiresAt: { lt: expect.any(Date) } },
      }),
    );
    expect(storageDeletion.enqueue).toHaveBeenCalledWith(prisma, 'botparty-recordings', [
      'sessions/a/camera.mp4',
      'sessions/b/camera.mp4',
    ]);
    expect(prisma.recording.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['recording-1', 'recording-2'] } },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('executes a maintenance task only for the API instance holding the Redis lock', async () => {
    const redis = {
      set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      eval: jest.fn().mockResolvedValue(1),
      mget: jest.fn().mockResolvedValue([]),
    };
    const service = new MaintenanceService(createDatabase(), redis, {
      recordingBucket: 'recordings',
      enqueue: jest.fn(),
      processDue: jest.fn(),
    });
    const work = jest.fn().mockResolvedValue(undefined);
    await expect(service.withDistributedLock('maintenance:test', 5_000, work)).resolves.toBe(true);
    await expect(service.withDistributedLock('maintenance:test', 5_000, work)).resolves.toBe(false);

    expect(work).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('rotates stream keys in bounded cursor pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `robot-${String(index).padStart(3, '0')}`,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      metadata: null,
    }));
    const lastRobot = {
      id: 'robot-100',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      metadata: null,
    };
    const prisma = createDatabase();
    prisma.robot.findMany.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([lastRobot]);
    prisma.robot.update.mockResolvedValue({ id: 'updated' });
    const service = new TestMaintenanceService(
      prisma,
      { set: jest.fn(), eval: jest.fn(), mget: jest.fn() },
      { recordingBucket: 'recordings', enqueue: jest.fn(), processDue: jest.fn() },
    );

    await service.rotateExpiredRobotStreamKeys();

    expect(prisma.robot.findMany).toHaveBeenNthCalledWith(1, {
      select: { id: true, createdAt: true, metadata: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    expect(prisma.robot.findMany).toHaveBeenNthCalledWith(2, {
      select: { id: true, createdAt: true, metadata: true },
      orderBy: { id: 'asc' },
      take: 100,
      cursor: { id: 'robot-099' },
      skip: 1,
    });
    expect(prisma.robot.update).toHaveBeenCalledTimes(101);
  });

  it('flushes viewer counts with bounded database, Redis, and transaction batches', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `robot-${String(index).padStart(3, '0')}`,
      viewerCount: 0,
    }));
    const prisma = createDatabase();
    prisma.robot.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ id: 'robot-100', viewerCount: 0 }]);
    prisma.robot.update.mockResolvedValue({ id: 'updated' });
    prisma.$transaction.mockResolvedValue([]);
    const redis = {
      set: jest.fn(),
      eval: jest.fn(),
      mget: jest
        .fn()
        .mockResolvedValueOnce(Array.from({ length: 100 }, () => '1'))
        .mockResolvedValueOnce(['1']),
    };
    const service = new TestMaintenanceService(prisma, redis, {
      recordingBucket: 'recordings',
      enqueue: jest.fn(),
      processDue: jest.fn(),
    });

    await service.flushViewerCountsUnlocked();

    expect(redis.mget).toHaveBeenCalledTimes(2);
    expect(redis.mget.mock.calls[0]).toHaveLength(100);
    expect(redis.mget.mock.calls[1]).toEqual(['robot:viewer-count:robot-100']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction.mock.calls[0]?.[0]).toHaveLength(100);
    expect(prisma.$transaction.mock.calls[1]?.[0]).toHaveLength(1);
  });
});
