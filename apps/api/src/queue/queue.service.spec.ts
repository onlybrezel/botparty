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
  $transaction: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
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

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    jest.clearAllMocks();


    // Directly instantiate with mocked deps to avoid NestJS DI token issues
    service = new QueueService(
      mockPrisma as never,
      mockRedis as never,
      mockRobotsService as never,
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

      mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const tx = { ...mockPrisma };
        tx.queueEntry = { ...mockPrisma.queueEntry };
        tx.queueEntry.findUnique = jest.fn().mockResolvedValue({ id: 'existing' });
        return fn(tx);
      });

      await expect(service.join('robot-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('leave', () => {
    it('returns { removed: false } if user is not in queue', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });
      mockRedis.smembers.mockResolvedValueOnce([]);
      mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const tx = {
          ...mockPrisma,
          queueEntry: {
            ...mockPrisma.queueEntry,
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        return fn(tx);
      });

      const result = await service.leave('robot-1', 'user-1') as { removed: boolean };
      expect(result.removed).toBe(false);
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

  describe('vote', () => {
    it('throws BadRequestException if user votes for themselves', async () => {
      await expect(service.vote('robot-1', 'user-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if queue mode is not DEMOCRACY', async () => {
      mockPrisma.robot.findUnique.mockResolvedValueOnce({ queueMode: 'STANDARD' });

      await expect(service.vote('robot-1', 'user-2', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });
});
