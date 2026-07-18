import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RobotCameraService } from './robot-camera.service';

describe('RobotCameraService', () => {
  let service: RobotCameraService;
  let prisma: {
    robot: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let access: {
    parseStreamFromMetadata: jest.Mock;
    invalidateCache: jest.Mock;
  };
  let config: {
    get: jest.Mock;
  };

  beforeEach(() => {
    const robot = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'robot-1',
          ownerId: 'owner-1',
          metadata: {},
        }),
        update: jest.fn().mockResolvedValue({ id: 'robot-1' }),
    };
    prisma = {
      robot,
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((callback) => callback({ robot, $queryRaw: prisma.$queryRaw })),
    };
    access = {
      parseStreamFromMetadata: jest.fn().mockReturnValue({ targetBitrateKbps: 1200, cameras: [] }),
      invalidateCache: jest.fn(),
    };
    config = {
      get: jest.fn().mockReturnValue(undefined),
    };
    service = new RobotCameraService(prisma as never, access as never, config as never);
  });

  it('adds a new external camera and makes it active when none is selected', async () => {
    await service.upsertExternalStreamCamera('robot-1', 'owner-1', {
      id: 'front',
      label: 'Front Cam',
      enabled: true,
    });

    expect(access.invalidateCache).toHaveBeenCalledWith('robot-1');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.robot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'robot-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            stream: expect.objectContaining({
              activeCameraId: 'front',
              cameras: [
                expect.objectContaining({
                  id: 'front',
                  label: 'Front Cam',
                  publishMode: 'always_on',
                }),
              ],
            }),
          }),
        }),
      }),
    );
  });

  it('removes an active camera and promotes the next one', async () => {
    access.parseStreamFromMetadata.mockReturnValue({
      targetBitrateKbps: 1200,
      activeCameraId: 'front',
      cameras: [
        { id: 'front', label: 'Front' },
        { id: 'rear', label: 'Rear' },
      ],
    });

    await service.removeExternalStreamCamera('robot-1', 'owner-1', 'front');

    expect(prisma.robot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            stream: expect.objectContaining({
              activeCameraId: 'rear',
              cameras: [expect.objectContaining({ id: 'rear' })],
            }),
          }),
        }),
      }),
    );
  });

  it('rejects missing robots, non-owners, and blank camera ids', async () => {
    prisma.robot.findUnique.mockResolvedValueOnce(null);
    await expect(service.upsertExternalStreamCamera('robot-404', 'owner-1', { id: 'front' })).rejects.toThrow(
      NotFoundException,
    );

    prisma.robot.findUnique.mockResolvedValueOnce({ id: 'robot-1', ownerId: 'owner-2', metadata: {} });
    await expect(service.upsertExternalStreamCamera('robot-1', 'owner-1', { id: 'front' })).rejects.toThrow(
      NotFoundException,
    );

    await expect(service.upsertExternalStreamCamera('robot-1', 'owner-1', { id: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('enforces the external camera cap for new camera ids', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'MAX_EXTERNAL_CAMERAS_PER_ROBOT' ? '1' : undefined,
    );
    service = new RobotCameraService(prisma as never, access as never, config as never);
    access.parseStreamFromMetadata.mockReturnValue({
      targetBitrateKbps: 1200,
      cameras: [{ id: 'front', label: 'Front' }],
    });

    await expect(service.upsertExternalStreamCamera('robot-1', 'owner-1', { id: 'rear' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
