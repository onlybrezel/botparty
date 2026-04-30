import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SessionsController } from './sessions.controller';

describe('SessionsController', () => {
  let sessionsService: {
    findByUser: jest.Mock;
    findDetailForRequester: jest.Mock;
    findByRobotForRequester: jest.Mock;
    getActiveSessionForRequester: jest.Mock;
  };
  let jwtService: { verify: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let controller: SessionsController;

  beforeEach(() => {
    sessionsService = {
      findByUser: jest.fn(),
      findDetailForRequester: jest.fn(),
      findByRobotForRequester: jest.fn(),
      getActiveSessionForRequester: jest.fn(),
    };
    jwtService = { verify: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue('secret') };
    controller = new SessionsController(sessionsService as never, jwtService as never, configService as never);
  });

  it('returns the authenticated user session history with numeric limits', async () => {
    sessionsService.findByUser.mockResolvedValue([{ id: 'session-1' }]);

    const sessions = await controller.getMySessions({ sub: 'user-1' } as never, '25');

    expect(sessionsService.findByUser).toHaveBeenCalledWith('user-1', 25);
    expect(sessions).toEqual([{ id: 'session-1' }]);
  });

  it('returns a requester-scoped session detail entry', async () => {
    sessionsService.findDetailForRequester.mockResolvedValue({ id: 'session-1', replayCandidates: [] });

    const session = await controller.getMySession({ sub: 'user-1' } as never, 'session-1');

    expect(sessionsService.findDetailForRequester).toHaveBeenCalledWith('session-1', 'user-1');
    expect(session).toEqual({ id: 'session-1', replayCandidates: [] });
  });

  it('resolves requester identity from bearer auth for robot session history', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1' });
    sessionsService.findByRobotForRequester.mockResolvedValue([{ id: 'session-1' }]);

    const sessions = await controller.getByRobot('robot-1', '10', 'Bearer token-123', undefined, 'room-token', 'guest-1');

    expect(sessionsService.findByRobotForRequester).toHaveBeenCalledWith('robot-1', 'user-1', 10, 'room-token', 'guest-1');
    expect(sessions).toEqual([{ id: 'session-1' }]);
  });

  it('returns null requester identity when auth verification fails', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    sessionsService.getActiveSessionForRequester.mockResolvedValue({ id: 'active-1' });

    const session = await controller.getActiveSession('robot-1', 'Bearer bad-token');

    expect(sessionsService.getActiveSessionForRequester).toHaveBeenCalledWith('robot-1', null, undefined, undefined);
    expect(session).toEqual({ id: 'active-1' });
  });
});
