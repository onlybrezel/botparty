import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RobotsService } from './robots.service';
import { RobotDeviceService } from './robot-device.service';
import { RobotSlugService } from './robot-slug.service';
import { RobotInviteService } from './robot-invite.service';
import { RobotCameraService } from './robot-camera.service';
import { RobotPublicOverviewService } from './robot-public-overview.service';

// ──────────────────────────────────────────────────────────────
// Shared mock factories
// ──────────────────────────────────────────────────────────────

function buildMockPrisma(overrides: Record<string, unknown> = {}) {
  const {
    robot: robotOverrides,
    controlButton: controlButtonOverrides,
    slugAlias: slugAliasOverrides,
    chatMessage: chatMessageOverrides,
    queueEntry: queueEntryOverrides,
    ...restOverrides
  } = overrides;

  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    robot: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      ...((robotOverrides as object | undefined) ?? {}),
    },
    controlButton: {
      createMany: jest.fn().mockResolvedValue(undefined),
      ...((controlButtonOverrides as object | undefined) ?? {}),
    },
    slugAlias: {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn().mockResolvedValue(null),
      ...((slugAliasOverrides as object | undefined) ?? {}),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      ...((chatMessageOverrides as object | undefined) ?? {}),
    },
    queueEntry: {
      count: jest.fn().mockResolvedValue(0),
      ...((queueEntryOverrides as object | undefined) ?? {}),
    },
    ...restOverrides,
  };
}

function buildMockRedis() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    hset: jest.fn(),
    hget: jest.fn(),
  };
}

function buildMockConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, defaultVal?: string) => values[key] ?? defaultVal ?? undefined),
    getOrThrow: jest.fn((key: string) => {
      if (key in values) return values[key];
      throw new Error(`Config key not found: ${key}`);
    }),
  };
}

function buildService(prismaOverrides?: Record<string, unknown>, configValues?: Record<string, string>) {
  const mockPrisma = buildMockPrisma(prismaOverrides ?? {});
  const mockRedis = buildMockRedis();
  const mockTelemetry = { record: jest.fn(), touch: jest.fn() };
  const mockThumbnail = { set: jest.fn() };
  const mockAccess = {
    invalidateCache: jest.fn(),
    getAccessPolicy: jest.fn(),
    getStreamPolicy: jest.fn(),
    validateRoomAccess: jest.fn(),
    resolveGuestActorId: jest.fn(),
  };
  const mockWebhooks = { deliver: jest.fn() };
  const mockChatPersistence = { enqueue: jest.fn() };
  const mockConfig = buildMockConfig(configValues ?? {});
  const mockActionQueue = {
    enqueueAction: jest.fn(),
    enqueueActionForRobot: jest.fn(),
    getPendingActions: jest.fn(),
    consumeActionsByRobotId: jest.fn(),
  };

  // Build real sub-services backed by the mock prisma/config
  const deviceService = new RobotDeviceService(mockPrisma as never, mockConfig as never);
  const slugService = new RobotSlugService(mockPrisma as never);
  const inviteService = new RobotInviteService(mockPrisma as never);
  const cameraService = new RobotCameraService(mockPrisma as never, mockAccess as never, mockConfig as never);
  const publicOverviewService = new RobotPublicOverviewService(mockPrisma as never, mockRedis as never);

  const service = new RobotsService(
    mockPrisma as never,
    mockRedis as never,
    mockTelemetry as never,
    mockThumbnail as never,
    mockAccess as never,
    mockWebhooks as never,
    mockChatPersistence as never,
    mockConfig as never,
    deviceService,
    slugService,
    inviteService,
    cameraService,
    mockActionQueue as never,
    publicOverviewService,
  );

  return { service, mockPrisma, mockRedis, mockAccess, mockConfig, mockActionQueue };
}

// Minimal robot fixture matching the shape returned by prisma includes
function robotFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'robot-1',
    name: 'Test Robot',
    slug: 'test-robot',
    slugAliases: [],
    description: null,
    tags: [],
    visibility: 'PUBLIC',
    status: 'ONLINE',
    lastOnlineAt: new Date(),
    ownerId: 'owner-1',
    claimToken: 'a'.repeat(64),
    streamKey: 'b'.repeat(64),
    inviteCode: null,
    accessMode: 'OPEN',
    accessPassword: null,
    metadata: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date(),
    owner: { id: 'owner-1', username: 'owner', displayName: null, role: 'USER' },
    controlButtons: [],
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────
// findAll
// ──────────────────────────────────────────────────────────────

describe('RobotsService.findAll', () => {
  it('returns empty array when no robots exist', async () => {
    const { service } = buildService();
    const result = await service.findAll({});
    expect(result).toEqual([]);
  });

  it('passes status filter to prisma as uppercase', async () => {
    const { service, mockPrisma } = buildService();
    await service.findAll({ status: 'online' });
    const callArg = mockPrisma.robot.findMany.mock.calls[0][0] as { where?: { status?: string } };
    expect(callArg.where?.status).toBe('ONLINE');
  });

  it('passes tag filter through to prisma', async () => {
    const { service, mockPrisma } = buildService();
    await service.findAll({ tag: 'cute' });
    const callArg = mockPrisma.robot.findMany.mock.calls[0][0] as { where?: { tags?: { has: string } } };
    expect(callArg.where?.tags).toEqual({ has: 'cute' });
  });
});

// ──────────────────────────────────────────────────────────────
// findBySlug
// ──────────────────────────────────────────────────────────────

describe('RobotsService.findBySlug', () => {
  it('throws NotFoundException when no robot matches slug', async () => {
    const { service } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.findBySlug('missing-slug')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for PRIVATE robots', async () => {
    const robot = robotFixture({ visibility: 'PRIVATE' });
    const { service } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(robot),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(service.findBySlug('test-robot')).rejects.toThrow(NotFoundException);
  });

  it('returns public robot data for PUBLIC visibility', async () => {
    const robot = robotFixture({ visibility: 'PUBLIC', status: 'ONLINE', lastOnlineAt: new Date() });
    const { service } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(robot),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const result = await service.findBySlug('test-robot');
    expect(result).toBeDefined();
    expect((result as { slug: string }).slug).toBe('test-robot');
  });
});

// ──────────────────────────────────────────────────────────────
// findByClaimToken
// ──────────────────────────────────────────────────────────────

describe('RobotsService.findByClaimToken', () => {
  it('returns null when token not found', async () => {
    const { service } = buildService({ robot: { findUnique: jest.fn().mockResolvedValue(null) } });
    const result = await service.findByClaimToken('unknown');
    expect(result).toBeNull();
  });

  it('returns robot when token is valid and not expired', async () => {
    const robot = robotFixture({ metadata: { claimTokenIssuedAt: new Date().toISOString() } });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '90' },
    );
    const result = await service.findByClaimToken(robot.claimToken as string);
    expect(result).toBeDefined();
    expect((result as { id: string }).id).toBe('robot-1');
  });

  it('returns null when claim token is older than ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS', async () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const robot = robotFixture({ metadata: { claimTokenIssuedAt: oldDate.toISOString() } });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '90' },
    );
    const result = await service.findByClaimToken(robot.claimToken as string);
    expect(result).toBeNull();
  });

  it('ignores expiry when max age is 0 (disabled)', async () => {
    const oldDate = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000);
    const robot = robotFixture({ metadata: { claimTokenIssuedAt: oldDate.toISOString() }, createdAt: oldDate });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '0' },
    );
    const result = await service.findByClaimToken(robot.claimToken as string);
    expect(result).toBeDefined();
  });

  it('falls back to robot.createdAt when claimTokenIssuedAt is absent', async () => {
    const robot = robotFixture({ metadata: {}, createdAt: new Date() });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '90' },
    );
    const result = await service.findByClaimToken(robot.claimToken as string);
    expect(result).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────
// validateOrBindRobotDevice
// ──────────────────────────────────────────────────────────────

describe('RobotsService.validateOrBindRobotDevice', () => {
  const validKey = 'a'.repeat(32);

  it('throws ForbiddenException when deviceKey is shorter than 32 chars', async () => {
    const { service } = buildService();
    await expect(service.validateOrBindRobotDevice('robot-1', 'short')).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when robot does not exist', async () => {
    const { service } = buildService({ robot: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(service.validateOrBindRobotDevice('robot-1', validKey)).rejects.toThrow(NotFoundException);
  });

  it('binds device hash on first claim and returns robotId + deviceHash', async () => {
    const robot = robotFixture({ metadata: {} });
    const { service, mockPrisma } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(robot),
        update: jest.fn().mockResolvedValue(robot),
      },
    });
    const result = await service.validateOrBindRobotDevice('robot-1', validKey);
    expect(result.robotId).toBe('robot-1');
    expect(result.deviceHash).toMatch(/^[a-f0-9]{64}$/i);
    expect(mockPrisma.robot.update).toHaveBeenCalledTimes(1);
  });

  it('accepts same device key when already bound without re-updating DB', async () => {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(validKey).digest('hex');
    // Hash is stored at metadata.auth.boundDeviceHash
    const robot = robotFixture({ metadata: { auth: { boundDeviceHash: hash } } });
    const { service, mockPrisma } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(robot),
        update: jest.fn(),
      },
    });
    const result = await service.validateOrBindRobotDevice('robot-1', validKey);
    expect(result.deviceHash).toBe(hash);
    expect(mockPrisma.robot.update).not.toHaveBeenCalled();
  });

  it('rejects a different device key when device is already bound', async () => {
    const differentKey = 'b'.repeat(32);
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(validKey).digest('hex');
    // Hash is stored at metadata.auth.boundDeviceHash
    const robot = robotFixture({ metadata: { auth: { boundDeviceHash: hash } } });
    const { service } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot), update: jest.fn() },
    });
    await expect(service.validateOrBindRobotDevice('robot-1', differentKey)).rejects.toThrow(ForbiddenException);
  });
});

describe('RobotsService.getChatHistoryPage', () => {
  it('returns a paginated chat history page with a next cursor', async () => {
    const before = Date.parse('2025-01-05T00:00:00.000Z');
    const rows = [
      {
        userId: 'user-3',
        content: 'third',
        createdAt: new Date('2025-01-04T00:00:03.000Z'),
        user: { username: 'gamma' },
      },
      {
        userId: 'user-2',
        content: 'second',
        createdAt: new Date('2025-01-04T00:00:02.000Z'),
        user: { username: 'beta' },
      },
      {
        userId: 'user-1',
        content: 'first',
        createdAt: new Date('2025-01-04T00:00:01.000Z'),
        user: { username: 'alpha' },
      },
    ];

    const { service, mockPrisma, mockAccess } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue({ id: 'robot-1' }) },
      chatMessage: { findMany: jest.fn().mockResolvedValue(rows) },
    });

    mockAccess.getAccessPolicy.mockResolvedValue({
      video: 'ALL',
      control: 'ALL',
      chat: 'ALL',
      estop: 'ALL',
    });
    mockAccess.resolveGuestActorId.mockReturnValue('guest:viewer-1');
    mockAccess.validateRoomAccess.mockResolvedValue(true);

    const result = await service.getChatHistoryPage({
      robotId: 'robot-1',
      requesterUserId: null,
      guestSessionId: 'viewer-1',
      before,
      limit: 2,
    });

    expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        robotId: 'robot-1',
        deletedAt: null,
        createdAt: { lt: new Date(before) },
      }),
      take: 3,
    }));
    expect(result).toEqual({
      messages: [
        {
          userId: 'user-2',
          username: 'beta',
          content: 'second',
          timestamp: Date.parse('2025-01-04T00:00:02.000Z'),
        },
        {
          userId: 'user-3',
          username: 'gamma',
          content: 'third',
          timestamp: Date.parse('2025-01-04T00:00:03.000Z'),
        },
      ],
      nextCursor: Date.parse('2025-01-04T00:00:02.000Z'),
      hasMore: true,
    });
  });

  it('rejects guest chat history requests when chat requires authentication', async () => {
    const { service, mockAccess } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue({ id: 'robot-1' }) },
    });

    mockAccess.getAccessPolicy.mockResolvedValue({
      video: 'ALL',
      control: 'ALL',
      chat: 'AUTHENTICATED',
      estop: 'ALL',
    });
    mockAccess.validateRoomAccess.mockResolvedValue(true);

    await expect(service.getChatHistoryPage({
      robotId: 'robot-1',
      requesterUserId: null,
    })).rejects.toThrow(ForbiddenException);
  });
});

describe('RobotsService.getPublicOverview', () => {
  it('returns cached overview data without hitting prisma', async () => {
    const cached = {
      totals: { publicRobots: 1, liveRobots: 1, featuredRobots: 1, totalViewers: 4, queueEntries: 2 },
      statusBreakdown: { online: 1, busy: 0, offline: 0, maintenance: 0 },
      featured: [],
      liveNow: [],
      topTags: [],
    };
    const { service, mockPrisma, mockRedis } = buildService();
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    await expect(service.getPublicOverview()).resolves.toEqual(cached);

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.robot.findMany).not.toHaveBeenCalled();
  });

  it('builds the overview from database aggregates and caches the result', async () => {
    const recent = new Date();
    const featuredRows = [
      {
        id: 'featured-1',
        name: 'Featured Bot',
        slug: 'featured-bot',
        status: 'ONLINE',
        viewerCount: 5,
        lastOnlineAt: recent,
        tags: ['featured'],
        owner: { username: 'owner-a', displayName: 'Owner A' },
      },
    ];
    const liveRows = [
      {
        id: 'live-1',
        name: 'Live Bot',
        slug: 'live-bot',
        status: 'BUSY',
        viewerCount: 7,
        lastOnlineAt: recent,
        queueMode: 'VOTING',
        tags: ['wheels'],
        isFeatured: false,
        owner: { username: 'owner-b', displayName: null },
      },
    ];

    const { service, mockPrisma, mockRedis } = buildService({
      robot: {
        findMany: jest.fn().mockImplementation((query?: { where?: { isFeatured?: boolean } }) => {
          if (query?.where?.isFeatured) {
            return Promise.resolve(featuredRows);
          }
          return Promise.resolve(liveRows);
        }),
      },
      queueEntry: {
        count: jest.fn().mockResolvedValue(4),
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([
          {
            publicRobots: 3,
            liveRobots: 2,
            featuredRobots: 1,
            totalViewers: 12,
            online: 1,
            busy: 1,
            offline: 1,
            maintenance: 0,
          },
        ])
        .mockResolvedValueOnce([
          { tag: 'featured', count: 2 },
          { tag: 'wheels', count: 1 },
        ]),
    });
    mockRedis.get.mockResolvedValueOnce(null);

    const result = await service.getPublicOverview();

    expect(result).toEqual({
      totals: {
        publicRobots: 3,
        liveRobots: 2,
        featuredRobots: 1,
        totalViewers: 12,
        queueEntries: 4,
      },
      statusBreakdown: {
        online: 1,
        busy: 1,
        offline: 1,
        maintenance: 0,
      },
      featured: [
        {
          id: 'featured-1',
          name: 'Featured Bot',
          slug: 'featured-bot',
          status: 'ONLINE',
          viewerCount: 5,
          tags: ['featured'],
          owner: { username: 'owner-a', displayName: 'Owner A' },
        },
      ],
      liveNow: [
        {
          id: 'live-1',
          name: 'Live Bot',
          slug: 'live-bot',
          status: 'BUSY',
          viewerCount: 7,
          queueMode: 'VOTING',
          tags: ['wheels'],
          owner: { username: 'owner-b', displayName: null },
        },
      ],
      topTags: [
        { tag: 'featured', count: 2 },
        { tag: 'wheels', count: 1 },
      ],
    });

    expect(mockPrisma.queueEntry.count).toHaveBeenCalledWith({
      where: {
        robot: {
          visibility: 'PUBLIC',
          status: { in: ['ONLINE', 'BUSY'] },
          lastOnlineAt: { gte: expect.any(Date) },
        },
      },
    });
    expect(mockRedis.set).toHaveBeenCalledWith('robots:public-overview', JSON.stringify(result), 'EX', 30);
  });
});

// ──────────────────────────────────────────────────────────────
// Profanity filter
// ──────────────────────────────────────────────────────────────

describe('RobotsService profanity filter', () => {
  it('create() rejects robot name containing a blocked term', async () => {
    const { service } = buildService();
    await expect(
      service.create('owner-1', { name: 'fuck robot', slug: undefined } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('create() rejects robot name containing unicode-obfuscated profanity', async () => {
    const { service } = buildService();
    // NFKD normalization strips the diacritic: 'f\u00fcck' → 'fuck'
    await expect(
      service.create('owner-1', { name: 'f\u00fcck this', slug: undefined } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('create() rejects when the owner reached the robot cap', async () => {
    const { service } = buildService(
      {
        robot: {
          count: jest.fn().mockResolvedValue(2),
        },
      },
      { MAX_ROBOTS_PER_OWNER: '2' },
    );

    await expect(
      service.create('owner-1', { name: 'Cap reached', slug: undefined } as never),
    ).rejects.toThrow(BadRequestException);
  });
});

// ──────────────────────────────────────────────────────────────
// Slug management
// ──────────────────────────────────────────────────────────────

describe('RobotsService slug management', () => {
  it('create() throws ConflictException when the requested slug is already taken', async () => {
    const existingRobot = robotFixture({ slug: 'my-slug' });
    const { service } = buildService({
      robot: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(existingRobot),
        create: jest.fn(),
      },
    });
    await expect(
      service.create('owner-1', { name: 'Safe Name', slug: 'my-slug' } as never),
    ).rejects.toThrow(ConflictException);
  });
});

// ──────────────────────────────────────────────────────────────
// Status normalization (via findAll)
// ──────────────────────────────────────────────────────────────

describe('RobotsService status normalization', () => {
  it('marks ONLINE robot as OFFLINE when lastOnlineAt is stale (>45s ago)', async () => {
    const staleDate = new Date(Date.now() - 60_000);
    const robot = robotFixture({ status: 'ONLINE', lastOnlineAt: staleDate });
    const { service } = buildService({ robot: { findMany: jest.fn().mockResolvedValue([robot]) } });
    const result = await service.findAll({});
    const normalized = result[0] as { status: string } | undefined;
    expect(normalized?.status).toBe('OFFLINE');
  });

  it('keeps ONLINE status when lastOnlineAt is recent', async () => {
    const recentDate = new Date(Date.now() - 5_000);
    const robot = robotFixture({ status: 'ONLINE', lastOnlineAt: recentDate });
    const { service } = buildService({ robot: { findMany: jest.fn().mockResolvedValue([robot]) } });
    const result = await service.findAll({});
    const normalized = result[0] as { status: string } | undefined;
    expect(normalized?.status).toBe('ONLINE');
  });

  it('marks robot as OFFLINE when lastOnlineAt is null', async () => {
    const robot = robotFixture({ status: 'ONLINE', lastOnlineAt: null });
    const { service } = buildService({ robot: { findMany: jest.fn().mockResolvedValue([robot]) } });
    const result = await service.findAll({});
    const normalized = result[0] as { status: string } | undefined;
    expect(normalized?.status).toBe('OFFLINE');
  });
});

// ──────────────────────────────────────────────────────────────
// findByIdCached
// ──────────────────────────────────────────────────────────────

describe('RobotsService.findByIdCached', () => {
  it('returns cached robot from redis without querying prisma', async () => {
    const robot = robotFixture();
    const { service, mockPrisma, mockRedis } = buildService();
    mockRedis.get.mockResolvedValue(JSON.stringify(robot));

    await service.findByIdCached('robot-1');
    expect(mockPrisma.robot.findUnique).not.toHaveBeenCalled();
  });

  it('queries prisma and caches result when cache is empty', async () => {
    const robot = robotFixture();
    const { service, mockPrisma, mockRedis } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    mockRedis.get.mockResolvedValue(null);

    await service.findByIdCached('robot-1');
    expect(mockPrisma.robot.findUnique).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  it('re-fetches from prisma when cached JSON is corrupt', async () => {
    const robot = robotFixture();
    const { service, mockPrisma, mockRedis } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    mockRedis.get.mockResolvedValue('{ invalid json {{');

    await service.findByIdCached('robot-1');
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(mockPrisma.robot.findUnique).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when robot is not in cache or DB', async () => {
    const { service } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.findByIdCached('ghost-id')).rejects.toThrow(NotFoundException);
  });
});

// ──────────────────────────────────────────────────────────────
// update() ownership check
// ──────────────────────────────────────────────────────────────

describe('RobotsService.update ownership check', () => {
  it('throws ForbiddenException when caller is not the robot owner', async () => {
    const robot = robotFixture({ ownerId: 'owner-1' });
    const { service } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    await expect(service.update('robot-1', 'different-user', {} as never)).rejects.toThrow(ForbiddenException);
  });
});
