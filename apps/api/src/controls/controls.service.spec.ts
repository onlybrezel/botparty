import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    $transaction: jest.Mock;
  };
  let service: ControlsService;

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
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') {
          return input({ controlButton, robot: prisma.robot });
        }
        return Promise.all(input as Promise<unknown>[]);
      }),
    };
    service = new ControlsService(prisma as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('returns no controls when the requester has no room access', async () => {
    prisma.robot.findUnique.mockResolvedValue({ ownerId: 'owner-1' });

    await expect(
      service.getVisibleButtons('robot-1', { userId: 'user-1', role: Role.USER, hasRoomAccess: false }),
    ).resolves.toEqual([]);
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

    expect(moderatorButtons.map((button) => button.command)).toEqual(['forward', 'kick']);
    expect(ownerButtons.map((button) => button.command)).toEqual(['forward', 'kick', 'secret']);
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
      },
    ]);

    const first = await service.getEnabledButtonsForRobot('robot-1');
    const second = await service.getEnabledButtonsForRobot('robot-1');

    expect(prisma.controlButton.findMany).toHaveBeenCalledTimes(1);
    expect(first[0]?.access).toBe(ControlButtonAccess.QUEUE_TURN);
    expect(second).toEqual(first);
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

  it('throws when a control button cannot be found for update/remove', async () => {
    prisma.controlButton.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', { label: 'x' }, 'owner-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('missing', 'owner-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects control changes from non-owners', async () => {
    prisma.controlButton.findUnique.mockResolvedValue({ id: 'button-1', robotId: 'robot-1' });
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });

    await expect(service.remove('button-1', 'user-2')).rejects.toBeInstanceOf(ForbiddenException);
  });
});