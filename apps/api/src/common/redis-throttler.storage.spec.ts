import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('maps the atomic Redis result to the Nest throttler contract', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([6, 59_100, 1, 60_000]) };
    const storage = new RedisThrottlerStorage(redis as never);

    await expect(storage.increment('request-key', 60_000, 5, 60_000, 'default')).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', counter_key)"),
      2,
      'throttle:default:request-key:count',
      'throttle:default:request-key:blocked',
      60_000,
      5,
      60_000,
    );
  });

  it('fails closed when Redis returns an invalid result', async () => {
    const storage = new RedisThrottlerStorage({ eval: jest.fn().mockResolvedValue(null) } as never);

    await expect(storage.increment('key', 1_000, 2, 1_000, 'auth')).rejects.toThrow(
      'Redis returned an invalid rate-limit result',
    );
  });

  it('returns a controlled service-unavailable error when Redis is down', async () => {
    const storage = new RedisThrottlerStorage({
      eval: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as never);

    await expect(storage.increment('key', 1_000, 2, 1_000, 'auth')).rejects.toMatchObject({
      status: 503,
      message: 'Request protection is temporarily unavailable',
    });
  });
});
