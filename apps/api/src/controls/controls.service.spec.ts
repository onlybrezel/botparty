import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ControlButtonAccess, LIMITS, Role } from '@botparty/shared';
import { ControlsService } from './controls.service';

describe('ControlsService', () => {
  let prisma: {
    robot: { findUnique: jest.Mock };
    controlButton: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      createMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let service: ControlsService;
  let features: { assertEnabled: jest.Mock };
  let subscriber: { connect: jest.Mock; psubscribe: jest.Mock; on: jest.Mock; quit: jest.Mock };
  const redis = {
    duplicate: jest.fn(),
    publish: jest.fn().mockResolvedValue(1),
  };

  beforeEach(() => {
    const controlButton = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    };
    prisma = {
      robot: { findUnique: jest.fn() },
      controlButton,
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') {
          return input({ controlButton, robot: prisma.robot, $queryRaw: prisma.$queryRaw });
        }
        return Promise.all(input as Promise<unknown>[]);
      }),
    };
    subscriber = {
      connect: jest.fn().mockResolvedValue(undefined),
      psubscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    redis.duplicate.mockReturnValue(subscriber);
    redis.publish.mockClear();
    features = { assertEnabled: jest.fn() };
    service = new ControlsService(prisma as never, redis as never, features as never);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('returns no controls when the requester has no room access', async () => {
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1', visibility: 'PUBLIC' });

    await expect(
      service.getVisibleButtons('robot-1', { userId: 'user-1', role: Role.USER, hasRoomAccess: false }),
    ).resolves.toEqual([]);
  });

  it('does not disclose private controls when room access is missing', async () => {
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1', visibility: 'PRIVATE' });

    await expect(
      service.getVisibleButtons('private-robot', {
        userId: 'foreign-user',
        role: Role.USER,
        hasRoomAccess: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects visible controls for an unknown robot and keeps public controls access-gated', async () => {
    prisma.robot.findUnique.mockResolvedValue(null);
    await expect(service.getVisibleButtons('missing', { userId: null, role: null, hasRoomAccess: true })).rejects.toBeInstanceOf(NotFoundException);
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
    await expect(service.getPublicButtons('robot-1')).resolves.toEqual([]);
  });

  it('falls back to default buttons when a room has no enabled custom controls', async () => {
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
    jest.spyOn(service, 'getEnabledButtonsForRobot').mockResolvedValue([]);

    const buttons = await service.getVisibleButtons('robot-1', {
      userId: 'user-1',
      role: Role.USER,
      hasRoomAccess: true,
    });

    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toEqual(expect.objectContaining({ command: 'forward' }));
  });

  it('filters moderator and owner controls by requester permissions', async () => {
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
    jest.spyOn(service, 'getEnabledButtonsForRobot').mockResolvedValue([
      { id: '1', label: 'Forward', command: 'forward', hotKey: 'w', icon: null, cooldownMs: 100, access: ControlButtonAccess.EVERYONE, position: 0, color: null, costCredits: 0 },
      { id: 'q', label: 'Turn', command: 'turn', hotKey: null, icon: null, cooldownMs: 100, access: ControlButtonAccess.QUEUE_TURN, position: 1, color: null, costCredits: 0 },
      { id: '2', label: 'Kick', command: 'kick', hotKey: null, icon: null, cooldownMs: 0, access: ControlButtonAccess.MODERATOR, position: 1, color: null, costCredits: 0 },
      { id: '3', label: 'Secret', command: 'secret', hotKey: null, icon: null, cooldownMs: 0, access: ControlButtonAccess.OWNER, position: 2, color: null, costCredits: 0 },
    ]);

    const moderatorButtons = await service.getVisibleButtons('robot-1', {
      userId: 'mod-1',
      role: Role.MOD,
      hasRoomAccess: true,
    });
    const ownerButtons = await service.getVisibleButtons('robot-1', {
      userId: 'owner-1',
      role: Role.USER,
      hasRoomAccess: true,
    });

    expect(moderatorButtons.map((button) => button.command)).toEqual(['forward', 'turn', 'kick']);
    expect(ownerButtons.map((button) => button.command)).toEqual(['forward', 'turn', 'kick', 'secret']);
  });

  it('lets admins see moderator controls without exposing owner-only controls', async () => {
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1' });
    jest.spyOn(service, 'getEnabledButtonsForRobot').mockResolvedValue([
      { id: 'm', label: 'M', command: 'mod', hotKey: null, icon: null, cooldownMs: 0, access: ControlButtonAccess.MODERATOR, position: 0, color: null, costCredits: 0 },
      { id: 'o', label: 'O', command: 'owner', hotKey: null, icon: null, cooldownMs: 0, access: ControlButtonAccess.OWNER, position: 1, color: null, costCredits: 0 },
    ]);
    const buttons = await service.getVisibleButtons('robot-1', { userId: 'admin', role: Role.ADMIN, hasRoomAccess: true });
    expect(buttons.map((button) => button.command)).toEqual(['mod']);
  });

  it('caches enabled buttons and maps access levels to shared enums', async () => {
    prisma.controlButton.findMany.mockResolvedValue([
      {
        id: 'button-1',
        label: 'Forward',
        command: 'forward',
        hotKey: 'w',
        icon: null,
        cooldownMs: 120,
        access: 'QUEUE_TURN',
        position: 0,
        color: null,
        costCredits: 0,
      },
    ]);

    const first = await service.getEnabledButtonsForRobot('robot-1');
    const second = await service.getEnabledButtonsForRobot('robot-1');

    expect(prisma.controlButton.findMany).toHaveBeenCalledTimes(1);
    expect(first[0]?.access).toBe(ControlButtonAccess.QUEUE_TURN);
    expect(second).toEqual(first);
  });

  it('maps every persisted access level and rejects unsupported values', async () => {
    prisma.controlButton.findMany.mockResolvedValue(['EVERYONE', 'QUEUE_TURN', 'MODERATOR', 'OWNER'].map((access, position) => ({
      id: `${position}`, label: access, command: access.toLowerCase(), hotKey: null, icon: null, cooldownMs: 0, access, position, color: null, costCredits: 0,
    })));
    await expect(service.getEnabledButtonsForRobot('robot-all')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ access: ControlButtonAccess.EVERYONE }),
      expect.objectContaining({ access: ControlButtonAccess.OWNER }),
    ]));

    prisma.controlButton.findMany.mockResolvedValue([{ id: 'x', label: 'X', command: 'x', hotKey: null, icon: null, cooldownMs: 0, access: 'UNKNOWN', position: 0, color: null, costCredits: 0 }]);
    await expect(service.getEnabledButtonsForRobot('robot-invalid')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('subscribes to replica invalidations and closes the subscriber', async () => {
    prisma.controlButton.findMany.mockResolvedValue([{ id: 'x', label: 'X', command: 'x', hotKey: null, icon: null, cooldownMs: 0, access: 'EVERYONE', position: 0, color: null, costCredits: 0 }]);
    await service.getEnabledButtonsForRobot('robot-1');
    await service.onModuleInit();
    expect(subscriber.psubscribe).toHaveBeenCalledWith('controls:invalidate:*');
    const listener = subscriber.on.mock.calls[0]?.[1] as (_pattern: string, channel: string) => void;
    listener('controls:invalidate:*', 'controls:invalidate:robot-1');
    await service.getEnabledButtonsForRobot('robot-1');
    expect(prisma.controlButton.findMany).toHaveBeenCalledTimes(2);
    listener('controls:invalidate:*', 'controls:invalidate:');
    await service.onModuleDestroy();
    expect(subscriber.quit).toHaveBeenCalled();
  });

  it('evicts expired local cache entries during the sweeper interval', async () => {
    jest.useFakeTimers();
    try {
      const local = new ControlsService(prisma as never, redis as never, features as never);
      prisma.controlButton.findMany.mockResolvedValue([{ id: 'x', label: 'X', command: 'x', hotKey: null, icon: null, cooldownMs: 0, access: 'EVERYONE', position: 0, color: null, costCredits: 0 }]);
      await local.getEnabledButtonsForRobot('robot-expiring');
      jest.advanceTimersByTime(60_001);
      await local.getEnabledButtonsForRobot('robot-expiring');
      expect(prisma.controlButton.findMany).toHaveBeenCalledTimes(2);
      await local.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns all controls only to the owner', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.controlButton.findMany.mockResolvedValue([{ id: 'button-1', isEnabled: false }]);
    await expect(service.getAllButtons('robot-1', 'owner-1')).resolves.toEqual([{ id: 'button-1', isEnabled: false }]);
  });

  it('seeds default controls before creating the first custom button', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.controlButton.count.mockResolvedValue(0);
    prisma.controlButton.createMany.mockResolvedValue({ count: 4 });
    prisma.controlButton.create.mockResolvedValue({ id: 'button-5', label: 'Horn', command: 'horn' });

    const created = await service.create(
      'robot-1',
      { label: 'Horn', command: 'horn', icon: '!' },
      'owner-1',
    );

    expect(prisma.controlButton.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.controlButton.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          robotId: 'robot-1',
          label: 'Horn',
          command: 'horn',
          cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
          position: 4,
        }),
      }),
    );
    expect(created).toEqual({ id: 'button-5', label: 'Horn', command: 'horn' });
  });

  it('creates a configured paid control without seeding when controls exist', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.controlButton.count.mockResolvedValue(3);
    prisma.controlButton.create.mockResolvedValue({ id: 'paid' });
    await service.create('robot-1', {
      label: 'Paid', command: 'paid', hotKey: 'p', icon: 'P', cooldownMs: 99, access: ControlButtonAccess.EVERYONE, position: 1, isEnabled: false, color: '#fff', costCredits: 5,
    }, 'owner-1');
    expect(features.assertEnabled).toHaveBeenCalledWith('PAID_CONTROLS');
    expect(prisma.controlButton.createMany).not.toHaveBeenCalled();
    expect(prisma.controlButton.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cooldownMs: 99, access: 'EVERYONE', position: 1, isEnabled: false, costCredits: 5 }) });
    expect(redis.publish).toHaveBeenCalledWith('controls:invalidate:robot-1', 'robot-1');
  });

  it('rejects creation after the per-robot button limit', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.controlButton.count.mockResolvedValue(LIMITS.MAX_CONTROL_BUTTONS);
    await expect(service.create('robot-1', { label: 'Too many', command: 'extra' }, 'owner-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('updates and removes owned controls while invalidating every replica', async () => {
    prisma.controlButton.findUnique.mockResolvedValue({ id: 'button-1', robotId: 'robot-1' });
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.controlButton.update.mockResolvedValue({ id: 'button-1', costCredits: 2 });
    await expect(service.update('button-1', { label: 'Updated', costCredits: 2 }, 'owner-1')).resolves.toEqual({ id: 'button-1', costCredits: 2 });
    expect(features.assertEnabled).toHaveBeenCalledWith('PAID_CONTROLS');
    await expect(service.remove('button-1', 'owner-1')).resolves.toBeUndefined();
    expect(prisma.controlButton.delete).toHaveBeenCalledWith({ where: { id: 'button-1' } });
    expect(redis.publish).toHaveBeenCalledTimes(2);
  });

  it('rejects reorders with duplicate ids or positions', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });

    await expect(
      service.reorder(
        'robot-1',
        { order: [{ id: 'a', position: 0 }, { id: 'a', position: 1 }] },
        'owner-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.reorder(
        'robot-1',
        { order: [{ id: 'a', position: 0 }, { id: 'b', position: 0 }] },
        'owner-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an empty reorder and rejects controls belonging to another robot', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    await expect(service.reorder('robot-1', { order: [] }, 'owner-1')).resolves.toBeUndefined();
    prisma.controlButton.findMany.mockResolvedValue([{ id: 'a' }]);
    await expect(service.reorder('robot-1', { order: [{ id: 'a', position: 0 }, { id: 'b', position: 1 }] }, 'owner-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reorders an exact owned set transactionally and invalidates the cache', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.controlButton.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prisma.controlButton.updateMany.mockResolvedValue({ count: 1 });
    await service.reorder('robot-1', { order: [{ id: 'a', position: 1 }, { id: 'b', position: 0 }] }, 'owner-1');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(prisma.controlButton.updateMany).toHaveBeenCalledTimes(2);
    expect(redis.publish).toHaveBeenCalled();
  });

  it('throws when a control button cannot be found for update/remove', async () => {
    prisma.controlButton.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', { label: 'x' }, 'owner-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('missing', 'owner-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not disclose control ownership to non-owners', async () => {
    prisma.controlButton.findUnique.mockResolvedValue({ id: 'button-1', robotId: 'robot-1' });
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });

    await expect(service.remove('button-1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
  });
});
