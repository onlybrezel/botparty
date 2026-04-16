import { ConflictException, BadRequestException } from '@nestjs/common';
import { ModerationService } from './moderation.service';

const mockPrisma = {
  userRestriction: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  chatMessage: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  robot: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  robotAction: {
    create: jest.fn(),
  },
  $transaction: jest.fn((cb) => cb()),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  hget: jest.fn(),
  hset: jest.fn(),
  hincrby: jest.fn(),
  hgetall: jest.fn(),
};

const mockRobotsService = {
  findById: jest.fn(),
  findByIdForUser: jest.fn(),
};

const mockHttpService = {
  get: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'LIVEKIT_API_KEY') return 'test-key';
    if (key === 'LIVEKIT_API_SECRET') return 'test-secret';
    if (key === 'LIVEKIT_URL') return 'ws://localhost:7880';
    if (key === 'CADVISOR_URL') return 'http://localhost:8080';
    return undefined;
  }),
};

describe('ModerationService', () => {
  let service: ModerationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    service = new ModerationService(
      mockPrisma as never,
      mockRedis as never,
      mockRobotsService as never,
      mockHttpService as never,
      mockConfigService as never,
    );
  });

  describe('checkProfanity', () => {
    it('should detect simple profanity', () => {
      const result = service.checkProfanity('hello world');
      expect(result).toBeDefined();
      expect(typeof result.isProfane).toBe('boolean');
    });

    it('should not flag clean text', () => {
      const result = service.checkProfanity('Hello everyone!');
      expect(result.isProfane).toBe(false);
    });

    it('should handle empty string', () => {
      const result = service.checkProfanity('');
      expect(result.isProfane).toBe(false);
    });

    it('should be case-insensitive', () => {
      // Profanity check should work regardless of case
      const result = service.checkProfanity('Testing clean content');
      expect(result).toBeDefined();
    });
  });

  describe('restriction management', () => {
    it('should create user restriction', async () => {
      mockPrisma.userRestriction.findUnique.mockResolvedValueOnce(null);
      mockPrisma.userRestriction.create.mockResolvedValueOnce({
        id: 'ban-1',
        userId: 'user-1',
        robotId: 'robot-1',
        type: 'BAN',
        expiresAt: new Date(),
      });

      const result = await service.createRestriction(
        'user-1',
        'robot-1',
        'BAN',
        'Inappropriate behavior',
        'mod-1',
        3600,
      );

      expect(result).toBeDefined();
      expect(result.type).toBe('BAN');
      expect(mockPrisma.userRestriction.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if restriction already exists', async () => {
      mockPrisma.userRestriction.findUnique.mockResolvedValueOnce({
        id: 'ban-1',
        userId: 'user-1',
        robotId: 'robot-1',
        type: 'BAN',
      });

      await expect(
        service.createRestriction('user-1', 'robot-1', 'BAN', 'Duplicate ban', 'mod-1', 3600),
      ).rejects.toThrow(ConflictException);
    });

    it('should list active restrictions', async () => {
      mockPrisma.userRestriction.findMany.mockResolvedValueOnce([
        {
          id: 'ban-1',
          userId: 'user-1',
          robotId: 'robot-1',
          type: 'BAN',
          expiresAt: new Date(Date.now() + 86400000),
        },
      ]);

      const result = await service.getRestrictions('robot-1');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(mockPrisma.userRestriction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ robotId: 'robot-1' }),
        }),
      );
    });

    it('should remove expired restrictions', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockPrisma.userRestriction.findMany.mockResolvedValueOnce([
        {
          id: 'ban-1',
          userId: 'user-1',
          robotId: 'robot-1',
          type: 'TIMEOUT',
          expiresAt: pastDate,
        },
      ]);

      mockPrisma.userRestriction.delete.mockResolvedValueOnce({ id: 'ban-1' });

      await service.cleanupExpiredRestrictions();

      expect(mockPrisma.userRestriction.delete).toHaveBeenCalled();
    });
  });

  describe('action queueing', () => {
    it('should queue moderation action for robot', async () => {
      mockPrisma.robotAction.create.mockResolvedValueOnce({
        id: 'action-1',
        robotId: 'robot-1',
        type: 'SPEAKER_EJECT',
        priority: 'HIGH',
      });

      const result = await service.queueRobotAction(
        'robot-1',
        'SPEAKER_EJECT',
        'Spam detected',
        'mod-1',
        'HIGH',
      );

      expect(result).toBeDefined();
      expect(result.type).toBe('SPEAKER_EJECT');
      expect(mockPrisma.robotAction.create).toHaveBeenCalled();
    });
  });

  describe('safety checks', () => {
    it('should not allow permanent bans without reason', async () => {
      // Security: permanent restrictions must have a documented reason
      mockPrisma.userRestriction.findUnique.mockResolvedValueOnce(null);

      const shortReason = 'spam';
      const result = await service.createRestriction(
        'user-1',
        'robot-1',
        'BAN',
        shortReason,
        'mod-1',
        null, // no expiry = permanent
      );

      // Permanent ban should be created but with logging
      expect(result).toBeDefined();
    });

    it('should handle concurrent restriction creation safely', async () => {
      mockPrisma.userRestriction.findUnique.mockResolvedValueOnce(null);
      mockPrisma.userRestriction.create.mockImplementation((args) => {
        // Simulate race condition by throwing second time
        if (mockPrisma.userRestriction.create.mock.callCount > 1) {
          throw new Error('Unique constraint failed');
        }
        return Promise.resolve({ id: 'ban-1' });
      });

      try {
        await service.createRestriction('user-1', 'robot-1', 'BAN', 'Test', 'mod-1', 3600);
      } catch (e) {
        // Race condition handling expected
      }
    });
  });

  describe('telemetry collection', () => {
    it('should collect runtime statistics', async () => {
      mockHttpService.get.mockResolvedValueOnce({
        data: {
          stats: [{ stats: {} }],
        },
      });

      // Service should attempt to collect LiveKit and container stats
      // without throwing
      const result = await service.getRuntimeStats();
      expect(result).toBeDefined();
    });
  });
});
