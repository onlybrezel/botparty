import { WS_EVENTS } from '@botparty/shared';
import { ModerationEnforcerHandler } from '../gateway/moderation-enforcer.handler';

describe('ModerationEnforcerHandler', () => {
  function createHandler() {
    const activeTurns = new Map();
    const ctx = {
      activeTurns,
      clients: new Map(),
      getActiveTurn: jest.fn(async (robotId: string) => activeTurns.get(robotId) ?? null),
      clearTurnState: jest.fn().mockResolvedValue(undefined),
      leaveRoom: jest.fn().mockResolvedValue(undefined),
    };
    const queueService = {
      leave: jest.fn().mockResolvedValue({ removed: true }),
    };

    return {
      handler: new ModerationEnforcerHandler(ctx as never, queueService as never),
      ctx,
      queueService,
    };
  }

  it('ignores unrelated moderation events', async () => {
    const { handler, ctx, queueService } = createHandler();

    await handler.enforce('robot-1', { event: WS_EVENTS.MOD_UNBAN, data: { userId: 'user-1' } });

    expect(ctx.clearTurnState).not.toHaveBeenCalled();
    expect(queueService.leave).not.toHaveBeenCalled();
  });

  it('clears the active turn and removes the user from the queue on timeout', async () => {
    const { handler, ctx, queueService } = createHandler();
    ctx.activeTurns.set('robot-1', {
      sessionId: 'session-1',
      userId: 'user-1',
      startedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });

    await handler.enforce('robot-1', {
      event: WS_EVENTS.MOD_TIMEOUT,
      data: { userId: 'user-1' },
    });

    expect(ctx.clearTurnState).toHaveBeenCalledWith('robot-1', 'clear');
    expect(queueService.leave).toHaveBeenCalledWith('robot-1', 'user-1');
    expect(ctx.leaveRoom).not.toHaveBeenCalled();
  });

  it('disconnects banned viewers from the room but leaves robots alone', async () => {
    const { handler, ctx, queueService } = createHandler();
    const matchingViewer = {
      id: 'viewer-1',
      userId: 'user-1',
      watchingRobotId: 'robot-1',
      isRobot: false,
      readyState: 1,
      close: jest.fn(),
    };
    const otherViewer = {
      id: 'viewer-2',
      userId: 'user-2',
      watchingRobotId: 'robot-1',
      isRobot: false,
      readyState: 1,
      close: jest.fn(),
    };
    const robotSocket = {
      id: 'robot-socket',
      userId: 'user-1',
      watchingRobotId: 'robot-1',
      isRobot: true,
      readyState: 1,
      close: jest.fn(),
    };
    ctx.clients.set(matchingViewer.id, matchingViewer as never);
    ctx.clients.set(otherViewer.id, otherViewer as never);
    ctx.clients.set(robotSocket.id, robotSocket as never);

    await handler.enforce('robot-1', {
      event: WS_EVENTS.MOD_BAN,
      data: { userId: 'user-1' },
    });

    expect(queueService.leave).toHaveBeenCalledWith('robot-1', 'user-1');
    expect(ctx.leaveRoom).toHaveBeenCalledWith(matchingViewer);
    expect(matchingViewer.close).toHaveBeenCalledTimes(1);
    expect(otherViewer.close).not.toHaveBeenCalled();
    expect(robotSocket.close).not.toHaveBeenCalled();
  });

  it('builds moderation system messages from the available labels', () => {
    const { handler } = createHandler();
    const expiresAt = new Date(Date.now() + 120_000).toISOString();

    expect(handler.buildSystemMessage(WS_EVENTS.MOD_BAN, { displayName: 'Pilot', userId: 'user-1' })).toBe(
      'Pilot has been banned from this room.',
    );
    expect(handler.buildSystemMessage(WS_EVENTS.MOD_KICK, { username: 'alpha', userId: 'user-1' })).toBe(
      'alpha was removed from the control queue.',
    );
    expect(handler.buildSystemMessage(WS_EVENTS.MOD_TIMEOUT, { userId: 'user-123456789', expiresAt })).toContain(
      'user-123',
    );
  });
});