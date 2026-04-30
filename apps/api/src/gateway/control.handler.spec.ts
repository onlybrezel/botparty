import { ControlButtonAccess, LIMITS, WS_EVENTS } from '@botparty/shared';
import { ControlHandler } from './control.handler';

const ROBOT_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('ControlHandler', () => {
  function buildHandler() {
    const ctx = {
      broadcastToRoom: jest.fn(),
      getOpenRobotClient: jest.fn(),
      buildCommandMetadata: jest.fn().mockReturnValue({ source: 'viewer' }),
      consumeControlCooldown: jest.fn().mockResolvedValue(true),
      isRoomModerator: jest.fn().mockReturnValue(false),
    };
    const robotsService = {
      findByIdCached: jest.fn().mockResolvedValue({ id: ROBOT_ID, ownerId: 'owner-1', queueMode: 'STANDARD' }),
      getAccessPolicy: jest.fn().mockResolvedValue({ control: 'ALL' }),
    };
    const moderationService = {
      getActiveRestriction: jest.fn().mockResolvedValue(null),
    };
    const queueService = {
      getCurrentControllerUserId: jest.fn().mockResolvedValue('user-1'),
    };
    const controlsService = {
      getEnabledButtonsForRobot: jest.fn().mockResolvedValue([
        { command: 'forward', access: ControlButtonAccess.QUEUE_TURN, cooldownMs: 120, costCredits: 0 },
      ]),
    };
    const walletService = {
      transfer: jest.fn(),
    };

    return {
      handler: new ControlHandler(
        ctx as never,
        robotsService as never,
        moderationService as never,
        queueService as never,
        controlsService as never,
        walletService as never,
      ),
      ctx,
      robotsService,
      moderationService,
      queueService,
      controlsService,
      walletService,
    };
  }

  function createClient(overrides: Record<string, unknown> = {}) {
    return {
      id: 'viewer-1',
      send: jest.fn(),
      watchingRobotId: ROBOT_ID,
      userId: 'user-1',
      username: 'alpha',
      role: 'USER',
      isGuest: false,
      ...overrides,
    } as any;
  }

  it('requires the viewer to join the room before sending controls', async () => {
    const { handler } = buildHandler();
    const client = createClient({ watchingRobotId: 'robot-2' });

    await handler.handle(client, { robotId: ROBOT_ID, command: 'forward', timestamp: Date.now() });

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Join the room before sending controls' } }),
    );
  });

  it('requires signed-in users when control access is authenticated only', async () => {
    const { handler, robotsService } = buildHandler();
    const client = createClient({ userId: undefined, username: 'guest', isGuest: true });
    robotsService.getAccessPolicy.mockResolvedValueOnce({ control: 'AUTHENTICATED' });

    await handler.handle(client, { robotId: ROBOT_ID, command: 'forward', timestamp: Date.now() });

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Please sign in to control this robot' } }),
    );
  });

  it('blocks non-controllers when fallback controls are used outside their turn', async () => {
    const { handler, controlsService, queueService } = buildHandler();
    const client = createClient({ userId: 'user-2' });
    controlsService.getEnabledButtonsForRobot.mockResolvedValueOnce([]);
    queueService.getCurrentControllerUserId.mockResolvedValueOnce('user-1');

    await handler.handle(client, { robotId: ROBOT_ID, command: 'forward', timestamp: Date.now() });

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Wait for your turn in the queue before sending controls' },
      }),
    );
  });

  it('rejects commands from actively restricted users', async () => {
    const { handler, moderationService, ctx } = buildHandler();
    const client = createClient();
    moderationService.getActiveRestriction.mockResolvedValueOnce({ action: 'TIMEOUT' });

    await handler.handle(client, { robotId: ROBOT_ID, command: 'forward', timestamp: Date.now() });

    expect(ctx.broadcastToRoom).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'You are restricted in this room', restriction: { action: 'TIMEOUT' } },
      }),
    );
  });

  it('broadcasts crowd input, forwards the command, and warns about high control latency', async () => {
    const { handler, ctx } = buildHandler();
    const client = createClient();
    const robotClient = { send: jest.fn() };
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    ctx.getOpenRobotClient.mockReturnValue(robotClient);

    await handler.handle(client, {
      robotId: ROBOT_ID,
      command: 'forward',
      timestamp: now - LIMITS.LATENCY_WARNING_MS - 25,
    });

    expect(ctx.broadcastToRoom).toHaveBeenCalledWith(
      ROBOT_ID,
      WS_EVENTS.CROWD_INPUT,
      { userId: 'user-1', username: 'alpha', command: 'forward', costCredits: 0 },
      'viewer-1',
    );
    expect(robotClient.send).toHaveBeenCalledWith(
      expect.stringContaining(`"event":"${WS_EVENTS.CONTROL_COMMAND}"`),
    );
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_LATENCY_WARNING,
        data: { latencyMs: LIMITS.LATENCY_WARNING_MS + 25 },
      }),
    );

    jest.restoreAllMocks();
  });
});