import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { QueueController } from './queue.controller';

describe('QueueController', () => {
  let queueService: {
    getQueueForRequester: jest.Mock;
    join: jest.Mock;
    leave: jest.Mock;
    vote: jest.Mock;
  };
  let jwtService: { verify: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let controller: QueueController;

  beforeEach(() => {
    queueService = {
      getQueueForRequester: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      vote: jest.fn(),
    };
    jwtService = { verify: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue('secret') };
    controller = new QueueController(queueService as never, jwtService as never, configService as never);
  });

  it('resolves the requester id from bearer auth when fetching the queue', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1' });
    queueService.getQueueForRequester.mockResolvedValue([{ userId: 'user-1' }]);

    const queue = await controller.getQueue('robot-1', 'Bearer token-123', undefined, 'room-token', 'guest-1');

    expect(queueService.getQueueForRequester).toHaveBeenCalledWith('robot-1', 'user-1', 'room-token', 'guest-1');
    expect(queue).toEqual([{ userId: 'user-1' }]);
  });

  it('falls back to an anonymous requester when auth cannot be resolved', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    queueService.getQueueForRequester.mockResolvedValue([]);

    await controller.getQueue('robot-1', 'Bearer bad-token');

    expect(queueService.getQueueForRequester).toHaveBeenCalledWith('robot-1', null, undefined, undefined);
  });

  it('proxies join, leave, and vote actions to the queue service', async () => {
    queueService.join.mockResolvedValue({ userId: 'user-1' });
    queueService.leave.mockResolvedValue({ removed: true });
    queueService.vote.mockResolvedValue({ userId: 'target-1' });

    await expect(controller.join('robot-1', { sub: 'user-1' } as never, { roomAccessToken: 'room-token' })).resolves.toEqual({ userId: 'user-1' });
    await expect(controller.leave('robot-1', { sub: 'user-1' } as never)).resolves.toEqual({ message: 'Left queue' });
    await expect(
      controller.vote('robot-1', 'target-1', { sub: 'user-1' } as never, { roomAccessToken: 'room-token' }),
    ).resolves.toEqual({ userId: 'target-1' });

    expect(queueService.join).toHaveBeenCalledWith('robot-1', 'user-1', 'room-token');
    expect(queueService.leave).toHaveBeenCalledWith('robot-1', 'user-1');
    expect(queueService.vote).toHaveBeenCalledWith('robot-1', 'target-1', 'user-1', 'room-token');
  });

  it('returns a stable response when the user was not in the queue', async () => {
    queueService.leave.mockResolvedValue({ removed: false });

    await expect(controller.leave('robot-1', { sub: 'user-1' } as never)).resolves.toEqual({ message: 'Not in queue' });
  });
});