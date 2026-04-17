import { RobotsService } from './robots.service';

const mockPrisma = {
  robot: {
    findMany: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockTelemetry = {};
const mockThumbnail = {};
const mockAccess = {
  invalidateCache: jest.fn(),
};
const mockWebhooks = {};
const mockChatPersistence = {
  enqueue: jest.fn(),
};
const mockConfig = {
  get: jest.fn(),
};

describe('RobotsService.findAll', () => {
  let service: RobotsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.robot.findMany.mockResolvedValue([]);

    service = new RobotsService(
      mockPrisma as never,
      mockRedis as never,
      mockTelemetry as never,
      mockThumbnail as never,
      mockAccess as never,
      mockWebhooks as never,
      mockChatPersistence as never,
      mockConfig as never,
    );
  });

  it('pushes status filter into prisma where clause', async () => {
    await service.findAll({ status: 'online' });

    expect(mockPrisma.robot.findMany).toHaveBeenCalledTimes(1);
    const callArg = mockPrisma.robot.findMany.mock.calls[0][0] as { where?: { status?: string } };
    expect(callArg.where?.status).toBe('ONLINE');
  });
});
