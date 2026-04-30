import type { RedisService } from '../redis/redis.service';
import type { WsClient } from './gateway-types';
import { PresenceHandler } from './presence.handler';

describe('PresenceHandler', () => {
  let redis: {
    multi: jest.Mock;
    set: jest.Mock;
    smembers: jest.Mock;
    pipeline: jest.Mock;
    srem: jest.Mock;
    del: jest.Mock;
  };
  let handler: PresenceHandler;

  beforeEach(() => {
    redis = {
      multi: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      smembers: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn(),
      srem: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };
    handler = new PresenceHandler(redis as unknown as RedisService, 'instance-1');
  });

  it('returns an empty snapshot for anonymous viewers', async () => {
    const client = { id: 'socket-1' } as WsClient;

    await expect(handler.refresh(client, 'robot-1')).resolves.toEqual({
      viewerCount: 0,
      focusUserConnections: 0,
      presenceList: [],
      cleanedStaleEntries: false,
    });
  });

  it('stores socket presence and refreshes the shared snapshot', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const multi = {
      set: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec,
    };
    redis.multi.mockReturnValue(multi);
    const snapshot = {
      viewerCount: 1,
      focusUserConnections: 1,
      presenceList: [{ userId: 'user-1', username: 'Julien', joinedAt: 123 }],
      cleanedStaleEntries: false,
    };
    jest.spyOn(handler, 'getSnapshot').mockResolvedValue(snapshot);
    const client = {
      id: 'socket-1',
      userId: 'user-1',
      username: 'Julien',
    } as WsClient;

    await expect(handler.refresh(client, 'robot-1')).resolves.toEqual(snapshot);
    expect(multi.set).toHaveBeenCalledWith(
      'ws:viewer-socket:instance-1:socket-1',
      expect.stringContaining('"robotId":"robot-1"'),
      'EX',
      45,
    );
    expect(multi.sadd).toHaveBeenCalledWith('ws:viewer-room:robot-1', 'ws:viewer-socket:instance-1:socket-1');
  });

  it('touches an existing socket entry without rejoining the room set', async () => {
    const client = {
      id: 'socket-1',
      userId: 'user-1',
      username: 'Julien',
      presenceJoinedAt: 100,
    } as WsClient;

    await handler.touch(client, 'robot-1');

    expect(redis.set).toHaveBeenCalledWith(
      'ws:viewer-socket:instance-1:socket-1',
      JSON.stringify({ robotId: 'robot-1', userId: 'user-1', username: 'Julien', joinedAt: 100 }),
      'EX',
      45,
    );
  });

  it('deduplicates viewer presence and removes stale socket entries', async () => {
    redis.smembers.mockResolvedValueOnce(['socket-1', 'socket-2', 'socket-stale']);
    const pipeline = {
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, JSON.stringify({ robotId: 'robot-1', userId: 'user-1', username: 'Julien', joinedAt: 50 })],
        [null, JSON.stringify({ robotId: 'robot-1', userId: 'user-1', username: 'Julien', joinedAt: 80 })],
        [null, 'invalid-json'],
      ]),
    };
    redis.pipeline.mockReturnValue(pipeline);

    const snapshot = await handler.getSnapshot('robot-1', 'user-1');

    expect(snapshot.viewerCount).toBe(2);
    expect(snapshot.focusUserConnections).toBe(2);
    expect(snapshot.presenceList).toEqual([{ userId: 'user-1', username: 'Julien', joinedAt: 50 }]);
    expect(snapshot.cleanedStaleEntries).toBe(true);
    expect(redis.srem).toHaveBeenCalledWith('ws:viewer-room:robot-1', 'socket-stale');
  });

  it('removes a socket from presence tracking', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const multi = {
      del: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      exec,
    };
    redis.multi.mockReturnValue(multi);
    jest.spyOn(handler, 'getSnapshot').mockResolvedValue({
      viewerCount: 0,
      focusUserConnections: 0,
      presenceList: [],
      cleanedStaleEntries: false,
    });
    const client = {
      id: 'socket-1',
      userId: 'user-1',
    } as WsClient;

    await handler.remove(client, 'robot-1');

    expect(multi.del).toHaveBeenCalledWith('ws:viewer-socket:instance-1:socket-1');
    expect(multi.srem).toHaveBeenCalledWith('ws:viewer-room:robot-1', 'ws:viewer-socket:instance-1:socket-1');
  });
});
