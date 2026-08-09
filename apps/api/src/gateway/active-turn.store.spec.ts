import type { ActiveTurnState } from './gateway-types';
import { ActiveTurnStore } from './active-turn.store';

describe('ActiveTurnStore', () => {
  const now = 1_700_000_000_000;
  const candidate: ActiveTurnState = {
    sessionId: 'session-1',
    userId: 'user-1',
    startedAt: now,
    expiresAt: now + 60_000,
    ownerId: '',
    fencingToken: 0,
    leaseExpiresAt: 0,
  };
  let redis: { get: jest.Mock; eval: jest.Mock };
  let store: ActiveTurnStore;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    redis = { get: jest.fn().mockResolvedValue(null), eval: jest.fn() };
    store = new ActiveTurnStore(redis, 'instance-a');
  });

  afterEach(() => jest.restoreAllMocks());

  it('acquires the shared lease with a monotonically fenced owner', async () => {
    const acquired = { ...candidate, ownerId: 'instance-a', fencingToken: 7, leaseExpiresAt: now + 15_000 };
    redis.eval.mockResolvedValueOnce(JSON.stringify(acquired));

    await expect(store.acquire('robot-1', candidate)).resolves.toEqual(acquired);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      2,
      'ws:turn:robot-1',
      'ws:turn-fence:robot-1',
      expect.any(String),
      String(now + 15_000),
      '15000',
    );
    expect(store.getLocal('robot-1')).toEqual(acquired);
  });

  it('fails closed instead of creating a local-only owner when Redis is unavailable', async () => {
    redis.eval.mockRejectedValueOnce(new Error('redis down'));
    await expect(store.acquire('robot-1', candidate)).resolves.toBeNull();
    expect(store.hasLocal('robot-1')).toBe(false);
  });

  it('renews and clears only with the expected owner and fence', async () => {
    const owned = { ...candidate, ownerId: 'instance-a', fencingToken: 8, leaseExpiresAt: now + 15_000 };
    store.remember('robot-1', owned);
    redis.eval
      .mockResolvedValueOnce(JSON.stringify(owned))
      .mockResolvedValueOnce(JSON.stringify(owned));

    await store.renewOwned();
    await expect(store.clear('robot-1', owned)).resolves.toEqual(owned);
    expect(store.hasLocal('robot-1')).toBe(false);
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'ws:turn:robot-1',
      'instance-a',
      '8',
    );
  });
});
