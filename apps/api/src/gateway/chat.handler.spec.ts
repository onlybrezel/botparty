import { LIMITS, WS_EVENTS } from '@botparty/shared';
import { ChatHandler } from './chat.handler';
import { createWsClient } from '../test/ws-client.fixture';

const ROBOT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CLIENT_MESSAGE_ID = '8d56b8dc-d747-4e2b-a9ee-6a1f97083c44';

describe('ChatHandler', () => {
  function buildHandler() {
    const ctx = {
      broadcastToRoom: jest.fn(),
      getOpenRobotClient: jest.fn(),
      buildCommandMetadata: jest.fn().mockReturnValue({ source: 'viewer' }),
      reserveChatMessage: jest.fn().mockResolvedValue(true),
    };
    const robotsService = {
      findByIdCached: jest.fn().mockResolvedValue({ id: ROBOT_ID, ownerId: 'owner-1' }),
      getAccessPolicy: jest.fn().mockResolvedValue({ chat: 'ALL' }),
      appendChatMessage: jest.fn().mockResolvedValue(undefined),
    };
    const moderationService = {
      sanitizeChatContent: jest
        .fn()
        .mockReturnValue({ sanitized: 'hello world', hasIllegalChars: false }),
      containsForbiddenSymbols: jest.fn().mockReturnValue(false),
      containsProfanity: jest.fn().mockReturnValue(false),
      recordProfanityEvent: jest.fn().mockResolvedValue(undefined),
      getActiveRestriction: jest.fn().mockResolvedValue(null),
    };

    return {
      handler: new ChatHandler(ctx, robotsService, moderationService),
      ctx,
      robotsService,
      moderationService,
    };
  }

  function createClient(overrides: Record<string, unknown> = {}) {
    return createWsClient({
      id: 'viewer-1',
      send: jest.fn(),
      watchingRobotId: ROBOT_ID,
      userId: 'user-1',
      username: 'alpha',
      role: 'USER',
      isGuest: false,
      ...overrides,
    });
  }

  it('requires authenticated users when chat access is restricted', async () => {
    const { handler, robotsService } = buildHandler();
    const client = createClient({ userId: undefined, username: 'guest', isGuest: true });
    robotsService.getAccessPolicy.mockResolvedValueOnce({ chat: 'AUTHENTICATED' });

    await handler.handle(client, {
      robotId: ROBOT_ID,
      content: 'hello',
      clientMessageId: CLIENT_MESSAGE_ID,
    });

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Please sign in to chat in this room' },
      }),
    );
  });

  it('rejects sanitized messages that still contain illegal characters', async () => {
    const { handler, moderationService } = buildHandler();
    const client = createClient();
    moderationService.sanitizeChatContent.mockReturnValueOnce({
      sanitized: 'hello',
      hasIllegalChars: true,
    });

    await handler.handle(client, {
      robotId: ROBOT_ID,
      content: 'hello\u0000',
      clientMessageId: CLIENT_MESSAGE_ID,
    });

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Message contains invalid characters' },
      }),
    );
  });

  it('blocks forbidden symbol messages and records the event for signed-in users', async () => {
    const { handler, moderationService } = buildHandler();
    const client = createClient();
    moderationService.containsForbiddenSymbols.mockReturnValueOnce(true);

    await handler.handle(client, {
      robotId: ROBOT_ID,
      content: 'heil hitler',
      clientMessageId: CLIENT_MESSAGE_ID,
    });

    expect(moderationService.recordProfanityEvent).toHaveBeenCalledWith({
      robotId: ROBOT_ID,
      userId: 'user-1',
      username: 'alpha',
      content: 'hello world',
    });
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Message blocked by moderation filter' },
      }),
    );
  });

  it('rejects chat messages from actively restricted users', async () => {
    const { handler, moderationService } = buildHandler();
    const client = createClient();
    moderationService.getActiveRestriction.mockResolvedValueOnce({ action: 'TIMEOUT' });

    await handler.handle(client, {
      robotId: ROBOT_ID,
      content: 'hello',
      clientMessageId: CLIENT_MESSAGE_ID,
    });

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'You are restricted in this room', restriction: { action: 'TIMEOUT' } },
      }),
    );
  });

  it('broadcasts, persists, and forwards accepted chat messages to the robot client', async () => {
    const { handler, ctx, robotsService } = buildHandler();
    const robotClient = { send: jest.fn() };
    const client = createClient();
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    ctx.getOpenRobotClient.mockReturnValue(robotClient);

    await handler.handle(client, {
      robotId: ROBOT_ID,
      content: 'hello',
      clientMessageId: CLIENT_MESSAGE_ID,
    });

    expect(ctx.broadcastToRoom).toHaveBeenCalledWith(
      ROBOT_ID,
      WS_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({
        userId: 'user-1',
        username: 'alpha',
        content: 'hello world',
        timestamp: now,
        clientMessageId: CLIENT_MESSAGE_ID,
      }),
    );
    expect(robotsService.appendChatMessage).toHaveBeenCalledWith(
      ROBOT_ID,
      'user-1',
      'hello world',
      now,
      CLIENT_MESSAGE_ID,
    );
    expect(robotClient.send).toHaveBeenCalledWith(
      expect.stringContaining(`"event":"${WS_EVENTS.CONTROL_COMMAND}"`),
    );

    jest.restoreAllMocks();
  });

  it('rate limits repeated chat messages for normal viewers', async () => {
    const { handler, ctx } = buildHandler();
    const client = createClient({ lastChatAt: 5_000 });
    jest.spyOn(Date, 'now').mockReturnValue(5_000 + LIMITS.CHAT_RATE_LIMIT_MS - 1);

    await handler.handle(client, {
      robotId: ROBOT_ID,
      content: 'hello again',
      clientMessageId: CLIENT_MESSAGE_ID,
    });

    expect(ctx.broadcastToRoom).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
