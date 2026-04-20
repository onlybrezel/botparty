import { WS_EVENTS } from '@botparty/shared';
import { RedisPubSubHandler } from './redis-pubsub.handler';

describe('RedisPubSubHandler', () => {
  let duplicateClient: {
    on: jest.Mock;
    psubscribe: jest.Mock;
    quit: jest.Mock;
  };
  let redis: { duplicate: jest.Mock };
  let queueService: { getQueue: jest.Mock };
  let ctx: {
    instanceId: string;
    hasOpenRobotClient: jest.Mock;
    hasLocalActiveTurn: jest.Mock;
    syncTurnLifecycle: jest.Mock;
    clearTurnState: jest.Mock;
    broadcastToRoomLocally: jest.Mock;
    enforceModerationEvent: jest.Mock;
    buildModerationSystemMessage: jest.Mock;
    broadcastSystemLocally: jest.Mock;
  };
  let handler: RedisPubSubHandler;

  beforeEach(() => {
    duplicateClient = {
      on: jest.fn(),
      psubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    redis = {
      duplicate: jest.fn().mockReturnValue(duplicateClient),
    };
    queueService = {
      getQueue: jest.fn().mockResolvedValue([{ userId: 'user-1', user: { username: 'pilot' } }]),
    };
    ctx = {
      instanceId: 'instance-a',
      hasOpenRobotClient: jest.fn().mockReturnValue(true),
      hasLocalActiveTurn: jest.fn().mockReturnValue(false),
      syncTurnLifecycle: jest.fn().mockResolvedValue(undefined),
      clearTurnState: jest.fn().mockResolvedValue(undefined),
      broadcastToRoomLocally: jest.fn(),
      enforceModerationEvent: jest.fn().mockResolvedValue(undefined),
      buildModerationSystemMessage: jest.fn().mockReturnValue(null),
      broadcastSystemLocally: jest.fn(),
    };
    handler = new RedisPubSubHandler(redis as any, queueService as any, ctx);
  });

  it('subscribes to gateway relay channels and shuts down cleanly', async () => {
    await handler.start();

    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    expect(duplicateClient.on).toHaveBeenCalledWith('pmessage', expect.any(Function));
    expect(duplicateClient.psubscribe).toHaveBeenCalledWith(
      'queue:*',
      'ws:moderation:*',
      'ws:room:*',
      'ws:system:*',
    );

    await handler.stop();

    expect(duplicateClient.quit).toHaveBeenCalledTimes(1);
  });

  it('syncs queue state from Redis events', async () => {
    await (handler as any).handleMessage('queue:robot-1', JSON.stringify({ type: 'join' }));

    expect(queueService.getQueue).toHaveBeenCalledWith('robot-1');
    expect(ctx.syncTurnLifecycle).toHaveBeenCalledWith('robot-1', [
      { userId: 'user-1', user: { username: 'pilot' } },
    ]);
    expect(ctx.broadcastToRoomLocally).toHaveBeenCalledWith('robot-1', WS_EVENTS.QUEUE_UPDATE, {
      queue: [{ userId: 'user-1', user: { username: 'pilot' } }],
    });
  });

  it('broadcasts moderation events and derived system chat messages', async () => {
    ctx.buildModerationSystemMessage.mockReturnValue('pilot was timed out.');

    await (handler as any).handleMessage(
      'ws:moderation:robot-1',
      JSON.stringify({ event: WS_EVENTS.MOD_TIMEOUT, data: { userId: 'user-1' } }),
    );

    expect(ctx.enforceModerationEvent).toHaveBeenCalledWith('robot-1', {
      event: WS_EVENTS.MOD_TIMEOUT,
      data: { userId: 'user-1' },
    });
    expect(ctx.broadcastToRoomLocally).toHaveBeenCalledWith('robot-1', WS_EVENTS.MOD_TIMEOUT, { userId: 'user-1' });
    expect(ctx.broadcastToRoomLocally).toHaveBeenCalledWith(
      'robot-1',
      WS_EVENTS.CHAT_SYSTEM,
      expect.objectContaining({ message: 'pilot was timed out.' }),
    );
  });

  it('relays only foreign room events and system broadcasts', async () => {
    await (handler as any).handleMessage(
      'ws:room:robot-1',
      JSON.stringify({ originId: 'instance-a', event: WS_EVENTS.ROBOT_STATUS, data: { status: 'ONLINE' } }),
    );
    await (handler as any).handleMessage(
      'ws:room:robot-1',
      JSON.stringify({ originId: 'instance-b', event: WS_EVENTS.ROBOT_STATUS, data: { status: 'ONLINE' } }),
    );
    await (handler as any).handleMessage(
      'ws:system:broadcast',
      JSON.stringify({ event: WS_EVENTS.SERVER_SHUTDOWN, data: { reason: 'restart' } }),
    );

    expect(ctx.broadcastToRoomLocally).toHaveBeenCalledTimes(1);
    expect(ctx.broadcastToRoomLocally).toHaveBeenCalledWith('robot-1', WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
    expect(ctx.broadcastSystemLocally).toHaveBeenCalledWith(WS_EVENTS.SERVER_SHUTDOWN, { reason: 'restart' });
  });
});