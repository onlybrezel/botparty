import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RobotCameraService } from './robot-camera.service';

describe('RobotCameraService', () => {
  let service: RobotCameraService;
  let prisma: {
    robot: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let access: {
    parseStreamFromMetadata: jest.Mock;
    invalidateCache: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      robot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'robot-1',
          ownerId: 'owner-1',
          metadata: {},
        }),
        update: jest.fn().mockResolvedValue({ id: 'robot-1' }),
      },
    };
    access = {
      parseStreamFromMetadata: jest.fn().mockReturnValue({ targetBitrateKbps: 1200, cameras: [] }),
      invalidateCache: jest.fn(),
    };
    service = new RobotCameraService(prisma as any, access as any);
  });

  it('adds a new external camera and makes it active when none is selected', async () => {
    await service.upsertExternalStreamCamera('robot-1', 'owner-1', {
      id: 'front',
      label: 'Front Cam',
      enabled: true,
    });

    expect(access.invalidateCache).toHaveBeenCalledWith('robot-1');
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
      ForbiddenException,
    );

    await expect(service.upsertExternalStreamCamera('robot-1', 'owner-1', { id: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });
});