import { RobotClaimLockHandler } from './robot-claim-lock.handler';

describe('RobotClaimLockHandler', () => {
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    eval: jest.Mock;
  };
  let handler: RobotClaimLockHandler;

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    handler = new RobotClaimLockHandler(redis);
  });

  it('reuses an existing lock owned by the same client', async () => {
    redis.get.mockResolvedValueOnce('client-1');

    await expect(handler.acquire('robot-1', 'client-1')).resolves.toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('pexpire'),
      1,
      'ws:robot-claim:robot-1',
      'client-1',
      '45000',
    );
  });

  it('acquires a fresh claim lock with NX semantics', async () => {
    await expect(handler.acquire('robot-1', 'client-2')).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'ws:robot-claim:robot-1',
      'client-2',
      'PX',
      45_000,
      'NX',
    );
  });

  it('transfers a lock between different robot clients', async () => {
    redis.eval.mockResolvedValueOnce('1');

    await expect(handler.transfer('robot-1', 'old-client', 'new-client')).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("set"'),
      1,
      'ws:robot-claim:robot-1',
      'old-client',
      'new-client',
      '45000',
    );
  });

  it('releases the lock for the owning client', async () => {
    await handler.release('robot-1', 'client-1');

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("del"'),
      1,
      'ws:robot-claim:robot-1',
      'client-1',
    );
  });
});
