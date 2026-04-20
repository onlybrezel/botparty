import type { RedisService } from '../redis/redis.service';
import type { ActiveTurnState } from './gateway-types';
import { ActiveTurnStore } from './active-turn.store';

describe('ActiveTurnStore', () => {
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    eval: jest.Mock;
  };
  let store: ActiveTurnStore;

  const activeTurn: ActiveTurnState = {
    sessionId: 'session-1',
    userId: 'user-1',
    startedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
  };

  beforeEach(() => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(null),
    };
    store = new ActiveTurnStore(redis as unknown as RedisService);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores turn state in Redis while keeping a local cache', async () => {
    await store.set('robot-1', activeTurn);

    expect(redis.set).toHaveBeenCalledWith(
      'ws:turn:robot-1',
      JSON.stringify(activeTurn),
      'PX',
      60_000,
    );
    expect(store.hasLocal('robot-1')).toBe(true);
    await expect(store.get('robot-1')).resolves.toEqual(activeTurn);
  });

  it('clears turn state atomically from Redis and returns the removed payload', async () => {
    redis.eval.mockResolvedValueOnce(JSON.stringify(activeTurn));
    store.remember('robot-1', activeTurn);

    const cleared = await store.clear('robot-1');

    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("get"'), 1, 'ws:turn:robot-1');
    expect(cleared).toEqual(activeTurn);
    expect(store.hasLocal('robot-1')).toBe(false);
  });

  it('falls back to local state when Redis is unavailable', async () => {
    store.remember('robot-1', activeTurn);
    redis.eval.mockRejectedValueOnce(new Error('redis down'));

    const cleared = await store.clear('robot-1');

    expect(cleared).toEqual(activeTurn);
    expect(store.hasLocal('robot-1')).toBe(false);
  });
});