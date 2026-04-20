import { RobotAccessService } from './robot-access.service';

function buildService() {
  const prisma = {
    robot: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };

  const service = new RobotAccessService(prisma as never, redis as never);
  return { service, prisma, redis };
}

describe('RobotAccessService.validateRoomAccess', () => {
  it('does not query allowed users with a sentinel UUID for guest actors', async () => {
    const { service, prisma } = buildService();
    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      visibility: 'PUBLIC',
      accessMode: 'OPEN',
      accessPassword: null,
      inviteCode: null,
    });

    await expect(
      service.validateRoomAccess({
        robotId: 'robot-1',
        actorId: 'guest:viewer-1',
      }),
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
    service.onModuleDestroy();
  });

  it('still filters allowed users by requester id for authenticated actors', async () => {
    const { service, prisma } = buildService();
    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      visibility: 'PUBLIC',
      accessMode: 'OPEN',
      accessPassword: null,
      inviteCode: null,
      allowedUsers: [{ userId: 'user-1' }],
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });

    await expect(
      service.validateRoomAccess({
        robotId: 'robot-1',
        actorId: 'user-1',
      }),
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
    service.onModuleDestroy();
  });
});