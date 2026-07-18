import { WS_EVENTS } from '@botparty/shared';
import type { ModerationService } from '../moderation/moderation.service';
import type { RobotsService } from '../robots/robots.service';
import type { GatewayRuntimeSupport } from './gateway-runtime.support';
import type { WsClient } from './gateway-types';
import { RoomHandler } from './room.handler';

describe('RoomHandler', () => {
  function createClient(): WsClient {
    return {
      id: 'client-1',
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    } as unknown as WsClient;
  }

  function createDeps() {
    const runtime = {
      parseWsPayload: jest.fn(),
      resolveSocketUser: jest.fn(),
      logger: { warn: jest.fn() },
      guestSockets: {
        unregister: jest.fn(),
        register: jest.fn(),
        canJoin: jest.fn().mockReturnValue(true),
      },
      rooms: new Map<string, Set<string>>(),
      presence: {
        refresh: jest.fn().mockResolvedValue({
          viewerCount: 1,
          focusUserConnections: 1,
          presenceList: [{ userId: 'user-1', username: 'julien', joinedAt: 100 }],
          cleanedStaleEntries: false,
        }),
        touch: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue({
          viewerCount: 0,
          focusUserConnections: 0,
          presenceList: [],
          cleanedStaleEntries: true,
        }),
      },
      broadcastToRoom: jest.fn(),
    };
    const robotsService = {
      resolveRoomAccessActorId: jest.fn().mockResolvedValue('guest:guest123'),
      validateRoomAccess: jest.fn().mockResolvedValue(true),
      getRecentChatMessages: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'msg-1',
            userId: 'user-9',
            username: 'alice',
            message: 'hello',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      setViewerCount: jest.fn().mockResolvedValue(undefined),
    };
    const moderationService = {
      getActiveRestriction: jest.fn().mockResolvedValue(null),
    };

    return {
      runtime: runtime as unknown as GatewayRuntimeSupport,
      runtimeMock: runtime,
      robotsService: robotsService as unknown as RobotsService,
      robotsMock: robotsService,
      moderationService: moderationService as unknown as ModerationService,
      moderationMock: moderationService,
    };
  }

  it('rejects joins when auth validation throws', async () => {
    const { runtime, runtimeMock, robotsService, moderationService } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({ robotId: 'robot-1', protocolVersion: 2 });
    runtimeMock.resolveSocketUser.mockRejectedValueOnce(new Error('invalid token'));
    const handler = new RoomHandler(runtime, robotsService, moderationService);
    const client = createClient();

    await expect(handler.handleJoin(client, {})).resolves.toBeUndefined();
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Failed to validate session token' },
      }),
    );
  });

  it('joins a room as a guest, sends presence, and replays chat history', async () => {
    const { runtime, runtimeMock, robotsService, robotsMock, moderationService } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({
      robotId: 'robot-1',
      protocolVersion: 2,
      roomAccessToken: 'invite-token',
    });
    runtimeMock.resolveSocketUser.mockResolvedValueOnce(null);
    const handler = new RoomHandler(runtime, robotsService, moderationService);
    const client = createClient();

    const result = await handler.handleJoin(client, {});

    expect(robotsMock.validateRoomAccess).toHaveBeenCalledWith({
      robotId: 'robot-1',
      actorId: 'guest:guest123',
      roomAccessToken: 'invite-token',
    });
    expect(runtimeMock.guestSockets.register).toHaveBeenCalledWith(client);
    expect(runtimeMock.broadcastToRoom).toHaveBeenCalledWith(
      'robot-1',
      WS_EVENTS.PRESENCE_JOIN,
      { userId: 'guest:guest123', username: 'Guest-guest1' },
      client.id,
    );
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.PRESENCE_UPDATE,
        data: { viewers: [{ userId: 'user-1', username: 'julien', joinedAt: 100 }] },
      }),
    );
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.CHAT_MESSAGE,
        data: {
          id: 'msg-1',
          userId: 'user-9',
          username: 'alice',
          message: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
          historical: true,
        },
      }),
    );
    expect(result).toEqual({
      event: WS_EVENTS.ROOM_JOIN,
      data: {
        ok: true,
        viewerCount: 1,
        protocolVersion: expect.any(Number),
        minProtocolVersion: expect.any(Number),
        clientProtocolVersion: 2,
      },
    });
  });

  it('blocks guests when the per-IP guest limit is reached', async () => {
    const { runtime, runtimeMock, robotsService, moderationService } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({ robotId: 'robot-1', protocolVersion: 2 });
    runtimeMock.resolveSocketUser.mockResolvedValueOnce(null);
    runtimeMock.guestSockets.canJoin.mockReturnValueOnce(false);
    const handler = new RoomHandler(runtime, robotsService, moderationService);
    const client = createClient();

    await handler.handleJoin(client, {});

    expect(client.userId).toBeUndefined();
    expect(client.watchingRobotId).toBeUndefined();
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Guest connection limit reached for this IP' },
      }),
    );
  });

  it('disconnects banned users before the room join completes', async () => {
    const { runtime, runtimeMock, robotsService, moderationService, moderationMock } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({
      robotId: 'robot-1',
      protocolVersion: 2,
      accessToken: 'jwt',
    });
    runtimeMock.resolveSocketUser.mockResolvedValueOnce({
      sub: 'user-1',
      username: 'julien',
      role: 'USER',
    });
    moderationMock.getActiveRestriction.mockResolvedValueOnce({ action: 'BAN', userId: 'user-1' });
    const handler = new RoomHandler(runtime, robotsService, moderationService);
    const client = createClient();

    await handler.handleJoin(client, {});

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.MOD_BAN,
        data: { action: 'BAN', userId: 'user-1' },
      }),
    );
    expect(runtimeMock.rooms.size).toBe(0);
  });

  it('leaves a room and broadcasts presence updates when the last connection closes', async () => {
    const { runtime, runtimeMock, robotsService, robotsMock, moderationService } = createDeps();
    const handler = new RoomHandler(runtime, robotsService, moderationService);
    const client = createClient();
    client.userId = 'user-1';
    client.username = 'julien';
    client.watchingRobotId = 'robot-1';
    client.isGuest = true;
    runtimeMock.rooms.set('robot-1', new Set([client.id]));

    await handler.leaveRoom(client);

    expect(runtimeMock.guestSockets.unregister).toHaveBeenCalledWith(client);
    expect(runtimeMock.broadcastToRoom).toHaveBeenCalledWith('robot-1', WS_EVENTS.PRESENCE_LEAVE, {
      userId: 'user-1',
      username: 'julien',
    });
    expect(runtimeMock.broadcastToRoom).toHaveBeenCalledWith('robot-1', WS_EVENTS.PRESENCE_UPDATE, {
      viewers: [],
    });
    expect(robotsMock.setViewerCount).not.toHaveBeenCalled();
    expect(client.watchingRobotId).toBeUndefined();
    expect(runtimeMock.rooms.has('robot-1')).toBe(false);
  });
});
