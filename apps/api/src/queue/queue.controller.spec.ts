import { QueueController } from './queue.controller';

describe('QueueController', () => {
  let queueService: {
    getQueueForRequester: jest.Mock;
    join: jest.Mock;
    leave: jest.Mock;
    vote: jest.Mock;
  };
  let authService: { resolveValidAccessTokenPayload: jest.Mock };
  let configService: { get: jest.Mock };
  let controller: QueueController;

  beforeEach(() => {
    queueService = {
      getQueueForRequester: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      vote: jest.fn(),
    };
    authService = { resolveValidAccessTokenPayload: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('secret') };
    controller = new QueueController(queueService, authService, configService);
  });

  it('resolves the requester id from bearer auth when fetching the queue', async () => {
    authService.resolveValidAccessTokenPayload.mockResolvedValue({ sub: 'user-1' });
    queueService.getQueueForRequester.mockResolvedValue([{ userId: 'user-1' }]);

    const queue = await controller.getQueue('robot-1', 'Bearer token-123', undefined, 'room-token', 'guest-1');

    expect(queueService.getQueueForRequester).toHaveBeenCalledWith('robot-1', 'user-1', 'room-token', 'guest-1');
    expect(queue).toEqual([{ userId: 'user-1' }]);
  });

  it('falls back to an anonymous requester when auth cannot be resolved', async () => {
    authService.resolveValidAccessTokenPayload.mockResolvedValue(null);
    queueService.getQueueForRequester.mockResolvedValue([]);

    await controller.getQueue('robot-1', 'Bearer bad-token');

    expect(queueService.getQueueForRequester).toHaveBeenCalledWith('robot-1', null, undefined, undefined);
  });

  it('proxies join, leave, and vote actions to the queue service', async () => {
    queueService.join.mockResolvedValue({ userId: 'user-1' });
    queueService.leave.mockResolvedValue({ removed: true });
    queueService.vote.mockResolvedValue({ userId: 'target-1' });

    await expect(controller.join('robot-1', { sub: 'user-1' }, { roomAccessToken: 'room-token' })).resolves.toEqual({ userId: 'user-1' });
    await expect(controller.leave('robot-1', { sub: 'user-1' })).resolves.toEqual({ message: 'Left queue' });
    await expect(
      controller.vote('robot-1', 'target-1', { sub: 'user-1' }, { roomAccessToken: 'room-token' }),
    ).resolves.toEqual({ userId: 'target-1' });

    expect(queueService.join).toHaveBeenCalledWith('robot-1', 'user-1', 'room-token');
    expect(queueService.leave).toHaveBeenCalledWith('robot-1', 'user-1');
    expect(queueService.vote).toHaveBeenCalledWith('robot-1', 'target-1', 'user-1', 'room-token');
  });

  it('returns a stable response when the user was not in the queue', async () => {
    queueService.leave.mockResolvedValue({ removed: false });

    await expect(controller.leave('robot-1', { sub: 'user-1' })).resolves.toEqual({ message: 'Not in queue' });
  });
});
