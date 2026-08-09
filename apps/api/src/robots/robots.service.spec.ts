import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    robot: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      ...objectOverride(robotOverrides),
    },
    controlButton: {
      createMany: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
      ...objectOverride(controlButtonOverrides),
    },
    slugAlias: {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn().mockResolvedValue(null),
      ...objectOverride(slugAliasOverrides),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      ...objectOverride(chatMessageOverrides),
    },
    queueEntry: {
      count: jest.fn().mockResolvedValue(0),
      ...objectOverride(queueEntryOverrides),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    storageDeletionTask: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    ...restOverrides,
  };
  const database = { ...prisma, $transaction: jest.fn() };
  database.$transaction.mockImplementation(<T>(callback: (tx: typeof prisma) => Promise<T>) =>
    callback(prisma),
  );
  return database;
}

function objectOverride(value: unknown): object {
  return typeof value === 'object' && value !== null ? value : {};
}

function hasObjectProperty<K extends PropertyKey>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value;
}

function hasStringProperty<K extends PropertyKey>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return hasObjectProperty(value, key) && typeof value[key] === 'string';
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

function buildService(
  prismaOverrides?: Record<string, unknown>,
  configValues?: Record<string, string>,
) {
  const mockPrisma = buildMockPrisma(prismaOverrides ?? {});
  const mockRedis = buildMockRedis();
  const mockTelemetry = {
    getLogs: jest.fn(),
    getTelemetry: jest.fn(),
    ingestLogsByRobotId: jest.fn(),
    ingestTelemetryByRobotId: jest.fn(),
  };
  const mockThumbnail = { clear: jest.fn(), read: jest.fn(), save: jest.fn() };
  const mockAccess = {
    invalidateCache: jest.fn(),
    getAccessPolicy: jest.fn(),
    getStreamPolicy: jest.fn(),
    getAllowedUsers: jest.fn(),
    addAllowedUser: jest.fn(),
    removeAllowedUser: jest.fn(),
    issueRoomAccessGrant: jest.fn(),
    validateRoomAccess: jest.fn(),
    resolveGuestActorId: jest.fn(),
    resolveRoomAccessActorId: jest.fn(),
    parseStreamFromMetadata: jest.fn().mockReturnValue({ targetBitrateKbps: 1200, cameras: [] }),
  };
  const mockWebhooks = { emitRobotStatus: jest.fn() };
  const mockChatPersistence = { enqueue: jest.fn() };
  const mockConfig = buildMockConfig(configValues ?? {});
  const mockActionQueue = {
    enqueueAction: jest.fn(),
    enqueueActionForRobot: jest.fn(),
    getPendingActions: jest.fn(),
    consumeActionsByRobotId: jest.fn(),
  };

  // Build real sub-services backed by the mock prisma/config
  const deviceService = new RobotDeviceService(mockPrisma, mockConfig);
  const slugService = new RobotSlugService(mockPrisma);
  const inviteService = new RobotInviteService(mockPrisma);
  const cameraService = new RobotCameraService(mockPrisma, mockAccess, mockConfig);
  const mockPlatformUser = {
    getPlatformUserId: jest.fn().mockReturnValue('00000000-0000-0000-0000-00000000fee5'),
    isPlatformUser: jest.fn((id: string) => id === '00000000-0000-0000-0000-00000000fee5'),
  };
  const publicOverviewService = new RobotPublicOverviewService(
    mockPrisma,
    mockRedis,
    mockPlatformUser,
  );
  const mockStorageDeletion = {
    recordingBucket: 'botparty-recordings',
    thumbnailBucket: 'botparty-thumbnails',
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  const service = new RobotsService(
    mockPrisma,
    mockRedis,
    mockTelemetry,
    mockThumbnail,
    mockAccess,
    mockWebhooks,
    mockChatPersistence,
    mockConfig,
    deviceService,
    slugService,
    inviteService,
    cameraService,
    mockActionQueue,
    publicOverviewService,
    mockPlatformUser,
    { publishSafely: jest.fn().mockResolvedValue(null) },
    mockStorageDeletion,
  );

  return {
    service,
    mockPrisma,
    mockRedis,
    mockAccess,
    mockConfig,
    mockActionQueue,
    mockStorageDeletion,
  };
}

// Minimal robot fixture matching the shape returned by prisma includes
interface RobotFixture {
  id: string;
  name: string;
  slug: string;
  slugAliases: unknown[];
  description: string | null;
  tags: string[];
  visibility: string;
  status: string;
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  lastOnlineAt: Date | null;
  ownerId: string;
  claimToken: string;
  streamKey: string;
  inviteCode: string | null;
  accessMode: string;
  accessPassword: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; username: string; displayName: string | null; role: string };
  controlButtons: unknown[];
  recordings?: Array<{ objectKey: string }>;
}

function robotFixture(overrides: Partial<RobotFixture> = {}): RobotFixture {
  return {
    id: 'robot-1',
    name: 'Test Robot',
    slug: 'test-robot',
    slugAliases: [],
    description: null,
    tags: [],
    visibility: 'PUBLIC',
    status: 'ONLINE',
    queueMode: 'FIRST_COME',
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

function createRobotInput(name: string, slug?: string): Parameters<RobotsService['create']>[1] {
  return {
    name,
    ...(slug === undefined ? {} : { slug }),
    visibility: 'PRIVATE',
    accessMode: 'OPEN',
    queueMode: 'FIRST_COME',
    maxTurnTime: 60_000,
    maxViewers: 1000,
    maxControllers: 10,
    tags: [],
    timezone: 'UTC',
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

  it('coalesces and caches identical public discovery reads', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = buildService({ robot: { findMany } });

    await Promise.all([service.findAll({ sort: 'new' }), service.findAll({ sort: 'new' })]);
    await service.findAll({ sort: 'new' });

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('passes status filter to prisma as uppercase', async () => {
    const { service, mockPrisma } = buildService();
    await service.findAll({ status: 'online' });
    expect(mockPrisma.robot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ONLINE' }) }),
    );
  });

  it('passes tag filter through to prisma', async () => {
    const { service, mockPrisma } = buildService();
    await service.findAll({ tag: 'cute' });
    expect(mockPrisma.robot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tags: { has: 'cute' } }) }),
    );
  });

  it('selects only fields that are part of the public robot contract', async () => {
    const { service, mockPrisma } = buildService();
    await service.findAll({});
    const callArgument: unknown = mockPrisma.robot.findMany.mock.calls[0]?.[0];
    if (!hasObjectProperty(callArgument, 'select')) {
      throw new Error('Expected the public robot query to define a select clause');
    }
    expect(callArgument.select).toMatchObject({ id: true, owner: expect.any(Object) });
    expect(callArgument.select).not.toHaveProperty('streamKeyHash');
    expect(callArgument.select).not.toHaveProperty('claimTokenHash');
    expect(callArgument.select).not.toHaveProperty('accessPassword');
  });
});

// ──────────────────────────────────────────────────────────────
// findBySlug
// ──────────────────────────────────────────────────────────────

describe('RobotsService.findBySlug', () => {
  it('throws NotFoundException when no robot matches slug', async () => {
    const { service } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
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
    const robot = robotFixture({
      visibility: 'PUBLIC',
      status: 'ONLINE',
      lastOnlineAt: new Date(),
    });
    const { service } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(robot),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const result = await service.findBySlug('test-robot');
    expect(result).toBeDefined();
    expect(result.slug).toBe('test-robot');
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
    const result = await service.findByClaimToken(robot.claimToken);
    expect(result).toBeDefined();
    expect(result?.id).toBe('robot-1');
  });

  it('returns null when claim token is older than ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS', async () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const robot = robotFixture({ metadata: { claimTokenIssuedAt: oldDate.toISOString() } });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '90' },
    );
    const result = await service.findByClaimToken(robot.claimToken);
    expect(result).toBeNull();
  });

  it('ignores expiry when max age is 0 (disabled)', async () => {
    const oldDate = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000);
    const robot = robotFixture({
      metadata: { claimTokenIssuedAt: oldDate.toISOString() },
      createdAt: oldDate,
    });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '0' },
    );
    const result = await service.findByClaimToken(robot.claimToken);
    expect(result).toBeDefined();
  });

  it('falls back to robot.createdAt when claimTokenIssuedAt is absent', async () => {
    const robot = robotFixture({ metadata: {}, createdAt: new Date() });
    const { service } = buildService(
      { robot: { findUnique: jest.fn().mockResolvedValue(robot) } },
      { ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS: '90' },
    );
    const result = await service.findByClaimToken(robot.claimToken);
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
    await expect(service.validateOrBindRobotDevice('robot-1', 'short')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws NotFoundException when robot does not exist', async () => {
    const { service } = buildService({ robot: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(service.validateOrBindRobotDevice('robot-1', validKey)).rejects.toThrow(
      NotFoundException,
    );
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
    await expect(service.validateOrBindRobotDevice('robot-1', differentKey)).rejects.toThrow(
      ForbiddenException,
    );
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

    expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          robotId: 'robot-1',
          deletedAt: null,
          createdAt: { lt: new Date(before) },
        }),
        take: 3,
      }),
    );
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

    await expect(
      service.getChatHistoryPage({
        robotId: 'robot-1',
        requesterUserId: null,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not disclose private chat history when room access is denied', async () => {
    const { service, mockAccess } = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue({ id: 'private-robot', visibility: 'PRIVATE' }),
      },
    });
    mockAccess.validateRoomAccess.mockResolvedValue(false);

    await expect(
      service.getChatHistoryPage({
        robotId: 'private-robot',
        requesterUserId: 'foreign-user',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(mockAccess.getAccessPolicy).not.toHaveBeenCalled();
  });
});

describe('RobotsService.getPublicOverview', () => {
  it('returns cached overview data without hitting prisma', async () => {
    const cached = {
      totals: {
        publicRobots: 1,
        liveRobots: 1,
        featuredRobots: 1,
        totalViewers: 4,
        queueEntries: 2,
      },
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
      $queryRaw: jest
        .fn()
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
          ownerId: { not: '00000000-0000-0000-0000-00000000fee5' },
          status: { in: ['ONLINE', 'BUSY'] },
          lastOnlineAt: { gte: expect.any(Date) },
        },
      },
    });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'robots:public-overview',
      JSON.stringify(result),
      'EX',
      30,
    );
  });

  it('casts the platform user id to uuid in raw overview queries', async () => {
    const { service, mockPrisma, mockRedis } = buildService({
      robot: { findMany: jest.fn().mockResolvedValue([]) },
      queueEntry: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
    });
    mockRedis.get.mockResolvedValueOnce(null);

    await service.getPublicOverview();

    const aggregateQuery: unknown = mockPrisma.$queryRaw.mock.calls[0]?.[0];
    const topTagsQuery: unknown = mockPrisma.$queryRaw.mock.calls[1]?.[0];
    if (!hasStringProperty(aggregateQuery, 'sql') || !hasStringProperty(topTagsQuery, 'sql')) {
      throw new Error('Expected Prisma SQL query objects');
    }

    expect(aggregateQuery.sql).toContain('"ownerId" != ?::uuid');
    expect(topTagsQuery.sql).toContain('"ownerId" != ?::uuid');
  });
});

// ──────────────────────────────────────────────────────────────
// Profanity filter
// ──────────────────────────────────────────────────────────────

describe('RobotsService profanity filter', () => {
  it('create() rejects robot name containing a blocked term', async () => {
    const { service } = buildService();
    await expect(service.create('owner-1', createRobotInput('fuck robot'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create() rejects robot name containing unicode-obfuscated profanity', async () => {
    const { service } = buildService();
    // NFKD normalization strips the diacritic: 'f\u00fcck' → 'fuck'
    await expect(service.create('owner-1', createRobotInput('f\u00fcck this'))).rejects.toThrow(
      BadRequestException,
    );
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

    await expect(service.create('owner-1', createRobotInput('Cap reached'))).rejects.toThrow(
      BadRequestException,
    );
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
      service.create('owner-1', createRobotInput('Safe Name', 'my-slug')),
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
    const normalized = result[0];
    expect(normalized?.status).toBe('OFFLINE');
  });

  it('keeps ONLINE status when lastOnlineAt is recent', async () => {
    const recentDate = new Date(Date.now() - 5_000);
    const robot = robotFixture({ status: 'ONLINE', lastOnlineAt: recentDate });
    const { service } = buildService({ robot: { findMany: jest.fn().mockResolvedValue([robot]) } });
    const result = await service.findAll({});
    const normalized = result[0];
    expect(normalized?.status).toBe('ONLINE');
  });

  it('marks robot as OFFLINE when lastOnlineAt is null', async () => {
    const robot = robotFixture({ status: 'ONLINE', lastOnlineAt: null });
    const { service } = buildService({ robot: { findMany: jest.fn().mockResolvedValue([robot]) } });
    const result = await service.findAll({});
    const normalized = result[0];
    expect(normalized?.status).toBe('OFFLINE');
  });
});

// ──────────────────────────────────────────────────────────────
// findByIdCached
// ──────────────────────────────────────────────────────────────

describe('RobotsService.findByIdCached', () => {
  it('returns a valid narrow realtime record from cache without querying Prisma', async () => {
    const cached = {
      id: 'robot-1',
      name: 'Test Robot',
      ownerId: 'owner-1',
      queueMode: 'FIRST_COME',
    };
    const { service, mockPrisma, mockRedis } = buildService();
    mockRedis.get.mockResolvedValue(JSON.stringify(cached));

    await expect(service.findByIdCached('robot-1')).resolves.toEqual(cached);
    expect(mockPrisma.robot.findUnique).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('queries prisma and caches result when cache is empty', async () => {
    const robot = robotFixture();
    const { service, mockPrisma, mockRedis } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    mockRedis.get.mockResolvedValue(null);

    await service.findByIdCached('robot-1');
    expect(mockPrisma.robot.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 'robot-1' },
      select: { id: true, name: true, ownerId: true, queueMode: true },
    });
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  it.each([
    '{ invalid json {{',
    JSON.stringify({
      id: 'robot-1',
      name: 'Test Robot',
      ownerId: 'owner-1',
      queueMode: 'UNSUPPORTED',
    }),
  ])('deletes invalid cache payload and re-fetches from Prisma', async (cachedPayload) => {
    const robot = robotFixture();
    const { service, mockPrisma, mockRedis } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    mockRedis.get.mockResolvedValue(cachedPayload);

    await service.findByIdCached('robot-1');
    expect(mockRedis.del).toHaveBeenCalledWith('robot:realtime:robot-1');
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

describe('RobotsService.delete object cleanup', () => {
  it('queues recording keys and the thumbnail prefix before deleting the robot', async () => {
    const robot = robotFixture({
      recordings: [{ objectKey: 'sessions/session-1/front.mp4' }],
    });
    const { service, mockPrisma, mockRedis, mockStorageDeletion } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    mockPrisma.robot.delete.mockResolvedValue(robot);

    await expect(service.delete(robot.id, robot.ownerId)).resolves.toBeUndefined();

    const transactionClient = mockStorageDeletion.enqueue.mock.calls[0]?.[0];
    expect(transactionClient).toBeDefined();
    expect(mockStorageDeletion.enqueue).toHaveBeenNthCalledWith(
      1,
      transactionClient,
      'botparty-recordings',
      ['sessions/session-1/front.mp4'],
    );
    expect(mockStorageDeletion.enqueue).toHaveBeenNthCalledWith(
      2,
      transactionClient,
      'botparty-thumbnails',
      ['robot-thumbnails/robot-1/'],
    );
    expect(mockPrisma.robot.delete).toHaveBeenCalledWith({ where: { id: robot.id } });
    expect(mockRedis.del).toHaveBeenCalledWith('robot:realtime:robot-1');
  });

  it('conceals a foreign robot without deleting or queueing its objects', async () => {
    const robot = robotFixture({ recordings: [] });
    const { service, mockPrisma, mockStorageDeletion } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });

    await expect(service.delete(robot.id, 'foreign-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(mockStorageDeletion.enqueue).not.toHaveBeenCalled();
    expect(mockPrisma.robot.delete).not.toHaveBeenCalled();
  });
});

describe('RobotsService.update ownership check', () => {
  it('conceals a foreign robot with the same response as a missing robot', async () => {
    const robot = robotFixture({ ownerId: 'owner-1' });
    const { service } = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(robot) },
    });
    await expect(service.update('robot-1', 'different-user', {})).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('RobotsService private owner isolation', () => {
  it('uses the same not-found response for a missing and a foreign private robot', async () => {
    const privateRobot = robotFixture({ visibility: 'PRIVATE', ownerId: 'owner-1' });
    const foreign = buildService({
      robot: { findUnique: jest.fn().mockResolvedValue(privateRobot) },
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) },
    });
    await expect(
      foreign.service.findPrivateBySlugForUser('test-robot', 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const missing = buildService({
      robot: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(
      missing.service.findPrivateBySlugForUser('missing-robot', 'user-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
