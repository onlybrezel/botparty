import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ControlButtonAccess } from '@botparty/shared';
import { ControlsController } from './controls.controller';

describe('ControlsController', () => {
  let controlsService: {
    getVisibleButtons: jest.Mock;
    getAllButtons: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    reorder: jest.Mock;
  };
  let robotsService: {
    resolveGuestActorId: jest.Mock;
    getAccessPolicy: jest.Mock;
    validateRoomAccess: jest.Mock;
  };
  let jwtService: { verify: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let controller: ControlsController;

  beforeEach(() => {
    controlsService = {
      getVisibleButtons: jest.fn(),
      getAllButtons: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      reorder: jest.fn(),
    };
    robotsService = {
      resolveGuestActorId: jest.fn(),
      getAccessPolicy: jest.fn(),
      validateRoomAccess: jest.fn(),
    };
    jwtService = { verify: jest.fn() };
    configService = {
      get: jest.fn().mockReturnValue(undefined),
      getOrThrow: jest.fn().mockReturnValue('secret'),
    };
    controller = new ControlsController(
      controlsService as never,
      robotsService as never,
      jwtService as never,
      configService as never,
    );
  });

  it('returns no public buttons when control access is disabled', async () => {
    robotsService.getAccessPolicy.mockResolvedValue({ control: 'DISABLED' });

    await expect(controller.getPublicButtons('robot-1')).resolves.toEqual([]);
    expect(controlsService.getVisibleButtons).not.toHaveBeenCalled();
  });

  it('returns no public buttons for guests when control requires authentication', async () => {
    robotsService.getAccessPolicy.mockResolvedValue({ control: 'AUTHENTICATED' });
    robotsService.resolveGuestActorId.mockReturnValue(null);

    await expect(controller.getPublicButtons('robot-1')).resolves.toEqual([]);
    expect(controlsService.getVisibleButtons).not.toHaveBeenCalled();
  });

  it('returns visible buttons for an authenticated requester with room access', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'USER' });
    robotsService.getAccessPolicy.mockResolvedValue({ control: 'ALL' });
    robotsService.validateRoomAccess.mockResolvedValue(true);
    controlsService.getVisibleButtons.mockResolvedValue([
      { id: 'button-1', command: 'forward', access: ControlButtonAccess.EVERYONE },
    ]);

    const buttons = await controller.getPublicButtons('robot-1', 'Bearer token-123', undefined, 'room-token');

    expect(controlsService.getVisibleButtons).toHaveBeenCalledWith('robot-1', {
      userId: 'user-1',
      role: 'USER',
      hasRoomAccess: true,
    });
    expect(buttons).toEqual([{ id: 'button-1', command: 'forward', access: ControlButtonAccess.EVERYONE }]);
  });

  it('proxies owner-only control management methods', async () => {
    controlsService.getAllButtons.mockResolvedValue([{ id: 'button-1' }]);
    controlsService.create.mockResolvedValue({ id: 'button-2' });
    controlsService.update.mockResolvedValue({ id: 'button-2', label: 'Horn' });
    controlsService.remove.mockResolvedValue(undefined);
    controlsService.reorder.mockResolvedValue(undefined);

    await expect(controller.getAllButtons('robot-1', 'owner-1')).resolves.toEqual([{ id: 'button-1' }]);
    await expect(controller.create('robot-1', { label: 'Horn', command: 'horn' } as never, 'owner-1')).resolves.toEqual({ id: 'button-2' });
    await expect(controller.update('button-2', { label: 'Horn' } as never, 'owner-1')).resolves.toEqual({ id: 'button-2', label: 'Horn' });
    await expect(controller.remove('button-2', 'owner-1')).resolves.toBeUndefined();
    await expect(controller.reorder('robot-1', { order: [{ id: 'button-1', position: 0 }] } as never, 'owner-1')).resolves.toBeUndefined();
  });
});