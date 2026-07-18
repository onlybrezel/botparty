import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { QueueService } from './queue.service';

const mockPrisma = {
  queueEntry: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  robot: {
    findUnique: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  hset: jest.fn(),
  hgetall: jest.fn(),
  eval: jest.fn(),
  publish: jest.fn().mockResolvedValue(undefined),
  smembers: jest.fn().mockResolvedValue([]),
  sadd: jest.fn(),
  srem: jest.fn(),
};

const mockRobotsService = {
  findById: jest.fn(),
  getAccessPolicy: jest.fn(),
  validateRoomAccess: jest.fn().mockResolvedValue(true),
  resolveGuestActorId: jest.fn().mockReturnValue(null),
};

const mockConfig = {
  get: jest.fn(),
};

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
      callback(mockPrisma as never),
    );
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.robot.findUnique.mockResolvedValue({ queueMode: 'STANDARD' });
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
    mockRobotsService.validateRoomAccess.mockResolvedValue(true);
    mockRobotsService.resolveGuestActorId.mockReturnValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.hgetall.mockResolvedValue({});
    mockRedis.hset.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.eval.mockResolvedValue(1);
    mockRedis.publish.mockResolvedValue(undefined);
    mockRedis.smembers.mockResolvedValue([]);
    mockConfig.get.mockReturnValue(undefined);


    // Directly instantiate with mocked deps to avoid NestJS DI token issues
    service = new QueueService(
      mockPrisma as never,
      mockRedis as never,
      mockRobotsService as never,
      mockConfig as never,
    );
  });

  describe('join', () => {
    it('throws ForbiddenException if control is disabled', async () => {
      mockRobotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'DISABLED' });

      await expect(service.join('robot-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if robot is offline', async () => {
      mockRobotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'ENABLED' });
      mockRobotsService.findById.mockResolvedValueOnce({ status: 'OFFLINE' });

      await expect(service.join('robot-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if room access is not valid', async () => {
      mockRobotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'ENABLED' });
      mockRobotsService.findById.mockResolvedValueOnce({ status: 'ONLINE' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(false);

      await expect(service.join('robot-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if user is already in queue', async () => {
      mockRobotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'ENABLED' });
      mockRobotsService.findById.mockResolvedValueOnce({ status: 'ONLINE' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.findUnique.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.join('robot-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('rejects join attempts when the per-user queue cap is reached', async () => {
      mockConfig.get.mockImplementation((key: string) =>
        key === 'MAX_ACTIVE_QUEUE_ENTRIES_PER_USER' ? '1' : undefined,
      );
      service = new QueueService(
        mockPrisma as never,
        mockRedis as never,
        mockRobotsService as never,
        mockConfig as never,
      );
      mockRobotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'ENABLED' });
      mockRobotsService.findById.mockResolvedValueOnce({ status: 'ONLINE' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.count.mockResolvedValueOnce(1);

      await expect(service.join('robot-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('creates a new queue entry under row locks, clears stale ballots, and publishes a join event', async () => {
      const createdEntry = {
        id: 'entry-3',
        robotId: 'robot-1',
        userId: 'user-1',
        position: 3,
        isPriority: true,
        user: { id: 'user-1', username: 'alpha', displayName: null, avatarUrl: null },
      };

      mockRobotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'ENABLED' });
      mockRobotsService.findById.mockResolvedValueOnce({ status: 'ONLINE' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.findUnique.mockResolvedValueOnce(null);
      mockPrisma.queueEntry.findFirst.mockResolvedValueOnce({ position: 2 });
      mockPrisma.queueEntry.create.mockResolvedValueOnce(createdEntry);
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });

      await expect(service.join('robot-1', 'user-1', 'room-token', true)).resolves.toEqual(createdEntry);

      expect(mockPrisma.queueEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            robotId: 'robot-1',
            userId: 'user-1',
            position: 3,
            isPriority: true,
          }),
        }),
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('HGETALL'"),
        1,
        'queue:ballots:robot-1',
        'user-1',
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'queue:robot-1',
        expect.stringContaining('"type":"join"'),
      );
      expect(mockPrisma.queueEntry.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('leave', () => {
    it('returns { removed: false } if user is not in queue', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });
      mockPrisma.queueEntry.findUnique.mockResolvedValueOnce(null);

      const result = await service.leave('robot-1', 'user-1') as { removed: boolean };
      expect(result.removed).toBe(false);
    });

    it('removes the entry without rewriting sparse positions and publishes a leave event', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });
      mockPrisma.queueEntry.findUnique.mockResolvedValueOnce({ id: 'entry-1' });

      await expect(service.leave('robot-1', 'user-1')).resolves.toEqual({ removed: true });

      expect(mockPrisma.queueEntry.delete).toHaveBeenCalledWith({
        where: { robotId_userId: { robotId: 'robot-1', userId: 'user-1' } },
      });
      expect(mockPrisma.queueEntry.update).not.toHaveBeenCalled();
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'queue:robot-1',
        expect.stringContaining('"type":"leave"'),
      );
    });
  });

  describe('getQueue', () => {
    it('returns queue entries sorted by position', async () => {
      const entries = [
        { id: 'e1', position: 1, userId: 'u1', isPriority: false, votes: 0 },
        { id: 'e2', position: 2, userId: 'u2', isPriority: false, votes: 0 },
      ];
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });
      mockRedis.smembers.mockResolvedValueOnce([]);
      mockPrisma.queueEntry.findMany.mockResolvedValueOnce(entries);

      const result = await service.getQueue('robot-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getQueueForRequester', () => {
    it('requires room verification for private rooms when no actor can be resolved', async () => {
      mockRobotsService.findById.mockResolvedValueOnce({
        id: 'robot-1',
        visibility: 'PRIVATE',
        accessMode: 'OPEN',
      });

      await expect(service.getQueueForRequester('robot-1', null)).rejects.toThrow(ForbiddenException);
    });

    it('allows verified guest viewers to read the queue in restricted rooms', async () => {
      const queue = [{ id: 'entry-1', userId: 'user-1' }];
      mockRobotsService.findById.mockResolvedValueOnce({
        id: 'robot-1',
        visibility: 'PRIVATE',
        accessMode: 'PASSWORD',
      });
      mockRobotsService.resolveGuestActorId.mockReturnValueOnce('guest:viewer-1');
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      jest.spyOn(service, 'getQueue').mockResolvedValueOnce(queue as never);

      await expect(service.getQueueForRequester('robot-1', null, 'room-token', 'viewer-1')).resolves.toEqual(queue);

      expect(mockRobotsService.validateRoomAccess).toHaveBeenCalledWith({
        robotId: 'robot-1',
        actorId: 'guest:viewer-1',
        roomAccessToken: 'room-token',
      });
    });
  });

  describe('vote', () => {
    it('throws BadRequestException if user votes for themselves', async () => {
      await expect(service.vote('robot-1', 'user-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if queue mode is not DEMOCRACY', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });

      await expect(service.vote('robot-1', 'user-2', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when room access verification fails', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'VOTING' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(false);

      await expect(service.vote('robot-1', 'user-2', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns null when the target user is no longer in the queue', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'VOTING' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.findUnique.mockResolvedValueOnce(null);

      await expect(service.vote('robot-1', 'user-2', 'user-1')).resolves.toBeNull();
    });

    it('throws ForbiddenException when the voter is not in the queue', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'VOTING' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.findUnique
        .mockResolvedValueOnce({ id: 'target-entry', userId: 'user-2' })
        .mockResolvedValueOnce(null);

      await expect(service.vote('robot-1', 'user-2', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when vote cooldown is active', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'VOTING' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.findUnique
        .mockResolvedValueOnce({ id: 'target-entry', userId: 'user-2' })
        .mockResolvedValueOnce({ id: 'voter-entry' });
      mockRedis.set.mockResolvedValueOnce(null);

      await expect(service.vote('robot-1', 'user-2', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('stores the ballot, recomputes vote counts, and publishes the update', async () => {
      mockPrisma.robot.findUnique
        .mockResolvedValueOnce({ queueMode: 'VOTING' })
        .mockResolvedValueOnce({ queueMode: 'VOTING' });
      mockRobotsService.validateRoomAccess.mockResolvedValueOnce(true);
      mockPrisma.queueEntry.findUnique
        .mockResolvedValueOnce({ id: 'target-entry', userId: 'user-2' })
        .mockResolvedValueOnce({ id: 'voter-entry' })
        .mockResolvedValueOnce({ id: 'target-entry', userId: 'user-2', votes: 1 });
      mockPrisma.queueEntry.findMany.mockResolvedValueOnce([
        { id: 'target-entry', userId: 'user-2', votes: 0 },
        { id: 'voter-entry', userId: 'user-1', votes: 0 },
      ]);
      mockRedis.hgetall.mockResolvedValueOnce({ 'user-1': 'user-2' });

      await expect(service.vote('robot-1', 'user-2', 'user-1')).resolves.toEqual({
        id: 'target-entry',
        userId: 'user-2',
        votes: 1,
        position: 1,
      });

      expect(mockRedis.hset).toHaveBeenCalledWith('queue:ballots:robot-1', 'user-1', 'user-2');
      expect(mockPrisma.queueEntry.update).not.toHaveBeenCalled();
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'queue:robot-1',
        expect.stringContaining('"type":"vote"'),
      );
    });
  });

  describe('clearQueue', () => {
    it('deletes queue entries, clears ballots, and broadcasts the reset', async () => {
      await service.clearQueue('robot-1');

      expect(mockPrisma.queueEntry.deleteMany).toHaveBeenCalledWith({ where: { robotId: 'robot-1' } });
      expect(mockRedis.del).toHaveBeenCalledWith('queue:ballots:robot-1');
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'queue:robot-1',
        expect.stringContaining('"type":"clear"'),
      );
    });
  });
});
