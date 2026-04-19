import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RobotsService } from './robots.service';
import { RobotDeviceService } from './robot-device.service';
import { RobotSlugService } from './robot-slug.service';
import { RobotInviteService } from './robot-invite.service';

// ──────────────────────────────────────────────────────────────
// Shared mock factories
// ──────────────────────────────────────────────────────────────

function buildMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    robot: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      ...((overrides.robot as object | undefined) ?? {}),
    },
    controlButton: {
      createMany: jest.fn().mockResolvedValue(undefined),
    },
    slugAlias: {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
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
  const mockAccess = { invalidateCache: jest.fn(), getAccessPolicy: jest.fn(), getStreamPolicy: jest.fn() };
  const mockWebhooks = { deliver: jest.fn() };
  const mockChatPersistence = { enqueue: jest.fn() };
  const mockConfig = buildMockConfig(configValues ?? {});

  // Build real sub-services backed by the mock prisma/config
  const deviceService = new RobotDeviceService(mockPrisma as never, mockConfig as never);
  const slugService = new RobotSlugService(mockPrisma as never);
  const inviteService = new RobotInviteService(mockPrisma as never);

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
  );

  return { service, mockPrisma, mockRedis, mockAccess, mockConfig };
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
