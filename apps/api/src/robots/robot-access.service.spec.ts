import { RobotAccessService } from './robot-access.service';

type AccessMode = 'OPEN' | 'PASSWORD' | 'ALLOWED_USERS' | 'LINK_ONLY';
type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

const PUBLIC_VISIBILITIES: readonly Visibility[] = ['PUBLIC', 'UNLISTED'];
const RESTRICTED_ACCESS_MODES: readonly AccessMode[] = ['PASSWORD', 'LINK_ONLY', 'ALLOWED_USERS'];

interface RobotAccessContext {
  id: string;
  ownerId: string;
  visibility: Visibility;
  accessMode: AccessMode;
  accessPassword: string | null;
  inviteCode: string | null;
  allowedUsers: Array<{ userId: string }>;
}

function buildService() {
  const prisma = {
    robot: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    robotAllowedUser: {
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };

  const service = new RobotAccessService(prisma, redis);
  return { service, prisma, redis };
}

function robotContext(
  overrides: Partial<RobotAccessContext> = {},
): RobotAccessContext {
  return {
    id: 'robot-1',
    ownerId: 'owner-1',
    visibility: 'PUBLIC',
    accessMode: 'OPEN',
    accessPassword: null,
    inviteCode: null,
    allowedUsers: [],
    ...overrides,
  };
}

describe('RobotAccessService room authorization', () => {
  const services: RobotAccessService[] = [];

  afterEach(() => {
    for (const service of services.splice(0)) service.onModuleDestroy();
  });

  function setup(overrides: Parameters<typeof robotContext>[0] = {}) {
    const context = buildService();
    services.push(context.service);
    context.prisma.robot.findUnique.mockResolvedValue(robotContext(overrides));
    context.prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    return context;
  }

  it('does not query allowed users with a sentinel UUID for guest actors', async () => {
    const { service, prisma } = setup();

    await expect(
      service.validateRoomAccess({ robotId: 'robot-1', actorId: 'guest:viewer-1' }),
    ).resolves.toBe(true);

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 'robot-1' },
      select: {
        id: true,
        ownerId: true,
        visibility: true,
        accessMode: true,
        accessPassword: true,
        inviteCode: true,
      },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('filters allowed users by requester id for authenticated actors', async () => {
    const { service, prisma } = setup({ allowedUsers: [{ userId: 'user-1' }] });

    await expect(
      service.validateRoomAccess({ robotId: 'robot-1', actorId: 'user-1' }),
    ).resolves.toBe(true);

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 'robot-1' },
      select: {
        id: true,
        ownerId: true,
        visibility: true,
        accessMode: true,
        accessPassword: true,
        inviteCode: true,
        allowedUsers: {
          where: { userId: 'user-1' },
          select: { userId: true },
        },
      },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { role: true },
    });
  });

  it('denies unknown robots', async () => {
    const { service, prisma } = setup();
    prisma.robot.findUnique.mockResolvedValue(null);

    await expect(
      service.validateRoomAccess({ robotId: 'missing', actorId: 'user-1' }),
    ).resolves.toBe(false);
  });

  it.each(PUBLIC_VISIBILITIES)(
    'allows open %s rooms without a grant',
    async (visibility) => {
      const { service } = setup({ visibility });

      await expect(
        service.validateRoomAccess({ robotId: 'robot-1', actorId: 'guest:viewer-1' }),
      ).resolves.toBe(true);
    },
  );

  it.each([
    ['owner-1', 'USER', true],
    ['staff-1', 'ADMIN', true],
    ['user-1', 'USER', false],
    ['guest:viewer-1', null, false],
  ] as const)('enforces private room access for %s', async (actorId, role, expected) => {
    const { service, prisma } = setup({ visibility: 'PRIVATE' });
    prisma.user.findUnique.mockResolvedValue(role ? { role } : null);

    await expect(service.validateRoomAccess({ robotId: 'robot-1', actorId })).resolves.toBe(
      expected,
    );
  });

  it.each(RESTRICTED_ACCESS_MODES)(
    'requires a grant for guests in %s rooms',
    async (accessMode) => {
      const { service } = setup({ accessMode });

      await expect(
        service.validateRoomAccess({ robotId: 'robot-1', actorId: 'guest:viewer-1' }),
      ).resolves.toBe(false);
    },
  );

  it('allows an authenticated allow-list member without a grant', async () => {
    const { service } = setup({
      accessMode: 'ALLOWED_USERS',
      allowedUsers: [{ userId: 'user-1' }],
    });

    await expect(
      service.validateRoomAccess({ robotId: 'robot-1', actorId: 'user-1' }),
    ).resolves.toBe(true);
  });

  it.each(RESTRICTED_ACCESS_MODES)(
    'allows owners and staff in %s rooms without a grant',
    async (accessMode) => {
      const owner = setup({ accessMode });
      const staff = setup({ accessMode });
      staff.prisma.user.findUnique.mockResolvedValue({ role: 'MOD' });

      await expect(
        owner.service.validateRoomAccess({ robotId: 'robot-1', actorId: 'owner-1' }),
      ).resolves.toBe(true);
      await expect(
        staff.service.validateRoomAccess({ robotId: 'robot-1', actorId: 'staff-1' }),
      ).resolves.toBe(true);
    },
  );

  it('accepts only a grant for the same authenticated actor', async () => {
    const { service, redis } = setup({ accessMode: 'PASSWORD' });
    redis.get.mockResolvedValue(JSON.stringify({ robotId: 'robot-1', actorId: 'user-1' }));

    await expect(
      service.validateRoomAccess({
        robotId: 'robot-1',
        actorId: 'user-1',
        roomAccessToken: 'valid-token',
      }),
    ).resolves.toBe(true);
    await expect(
      service.validateRoomAccess({
        robotId: 'robot-1',
        actorId: 'user-2',
        roomAccessToken: 'valid-token',
      }),
    ).resolves.toBe(false);
  });

  it('uses a valid guest grant as the authoritative guest identity', async () => {
    const { service, redis } = setup({ accessMode: 'LINK_ONLY' });
    redis.get.mockResolvedValue(
      JSON.stringify({ robotId: 'robot-1', actorId: 'guest:grant-holder' }),
    );

    await expect(
      service.validateRoomAccess({
        robotId: 'robot-1',
        actorId: 'guest:browser-session',
        roomAccessToken: 'valid-token',
      }),
    ).resolves.toBe(true);
  });

  it.each([
    [undefined, null],
    ['missing', null],
    ['malformed', null],
    ['wrong-robot', null],
    ['blank-actor', null],
    ['valid', 'guest:viewer-1'],
  ] as const)('validates persisted room grants: %s', async (token, expected) => {
    const { service, redis } = setup();
    const values: Record<string, string | null> = {
      missing: null,
      malformed: '{',
      'wrong-robot': JSON.stringify({ robotId: 'robot-2', actorId: 'guest:viewer-1' }),
      'blank-actor': JSON.stringify({ robotId: 'robot-1', actorId: ' ' }),
      valid: JSON.stringify({ robotId: 'robot-1', actorId: 'guest:viewer-1' }),
    };
    redis.get.mockResolvedValue(token ? values[token] : null);

    await expect(service.resolveRoomAccessActorId('robot-1', token)).resolves.toBe(expected);
  });

  it.each([
    [' Viewer_123 ', 'guest:viewer_123'],
    ['short', null],
    ['contains spaces', null],
    ['x'.repeat(65), null],
    [undefined, null],
  ])('normalizes safe guest session identifiers', (raw, expected) => {
    const { service } = setup();
    expect(service.resolveGuestActorId(raw)).toBe(expected);
  });
});
