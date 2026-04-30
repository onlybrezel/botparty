import { WS_EVENTS } from '@botparty/shared';
import type { QueueService } from '../queue/queue.service';
import type { WsClient } from './gateway-types';
import { ModerationEnforcerHandler } from './moderation-enforcer.handler';

describe('ModerationEnforcerHandler', () => {
  let queueService: {
    leave: jest.Mock;
  };
  let ctx: {
    clients: Map<string, WsClient>;
    getActiveTurn: jest.Mock;
    clearTurnState: jest.Mock;
    leaveRoom: jest.Mock;
  };
  let handler: ModerationEnforcerHandler;

  beforeEach(() => {
    queueService = {
      leave: jest.fn().mockResolvedValue(undefined),
    };
    ctx = {
      clients: new Map(),
      getActiveTurn: jest.fn().mockResolvedValue(null),
      clearTurnState: jest.fn().mockResolvedValue(undefined),
      leaveRoom: jest.fn().mockResolvedValue(undefined),
    };
    handler = new ModerationEnforcerHandler(
      ctx,
      queueService as unknown as QueueService,
    );
  });

  it('clears the active turn and queue membership for moderation events', async () => {
    ctx.getActiveTurn.mockResolvedValueOnce({
      sessionId: 'session-1',
      userId: 'user-1',
      startedAt: 1,
      expiresAt: Date.now() + 60_000,
    });

    await handler.enforce('robot-1', {
      event: WS_EVENTS.MOD_TIMEOUT,
      data: { userId: 'user-1' },
    });

    expect(ctx.clearTurnState).toHaveBeenCalledWith('robot-1', 'clear');
    expect(queueService.leave).toHaveBeenCalledWith('robot-1', 'user-1');
  });

  it('disconnects banned users from the affected room', async () => {
    const target = {
      id: 'viewer-1',
      userId: 'user-1',
      watchingRobotId: 'robot-1',
      readyState: WebSocket.OPEN,
      close: jest.fn(),
    } as unknown as WsClient;
    const unaffected = {
      id: 'viewer-2',
      userId: 'user-2',
      watchingRobotId: 'robot-1',
      readyState: WebSocket.OPEN,
      close: jest.fn(),
    } as unknown as WsClient;
    ctx.clients.set('viewer-1', target);
    ctx.clients.set('viewer-2', unaffected);

    await handler.enforce('robot-1', {
      event: WS_EVENTS.MOD_BAN,
      data: { userId: 'user-1' },
    });

    expect(ctx.leaveRoom).toHaveBeenCalledWith(target);
    expect(target.close).toHaveBeenCalled();
    expect(unaffected.close).not.toHaveBeenCalled();
  });

  it('builds human-readable moderation system messages', () => {
    expect(handler.buildSystemMessage(WS_EVENTS.MOD_BAN, { username: 'julien' })).toBe(
      'julien has been banned from this room.',
    );
    expect(handler.buildSystemMessage(WS_EVENTS.MOD_UNBAN, { displayName: 'Julien' })).toBe(
      'Julien has been unbanned.',
    );
    expect(handler.buildSystemMessage(WS_EVENTS.MOD_KICK, { userId: 'user-12345678' })).toBe(
      'user-123 was removed from the control queue.',
    );
    expect(handler.buildSystemMessage(WS_EVENTS.MOD_TIMEOUT, {
      username: 'julien',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    })).toContain('julien was timed out for');
  });
});
