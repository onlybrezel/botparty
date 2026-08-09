import { ControlButtonAccess, LIMITS, WS_EVENTS } from '@botparty/shared';
import { InsufficientFundsError } from '../wallet/wallet.service';
import { ControlHandler } from './control.handler';
import { createWsClient } from '../test/ws-client.fixture';


const ROBOT_ID = '550e8400-e29b-41d4-a716-446655440000';
const COMMAND_ID = 'd9428888-122b-11e1-b85c-61cd3cbb3210';
const BUTTON_ID = '3d594650-3436-4ba4-902f-1f83eac34c0c';

describe('ControlHandler', () => {
  function buildHandler() {
    const ctx = {
      broadcastToRoom: jest.fn(),
      getOpenRobotClient: jest.fn(),
      buildCommandMetadata: jest.fn().mockReturnValue({ source: 'viewer' }),
      consumeControlCooldown: jest.fn().mockResolvedValue(true),
      isRoomModerator: jest.fn().mockReturnValue(false),
      triggerEmergencyStop: jest.fn(),
    };
    const robotsService = {
      findByIdCached: jest.fn().mockResolvedValue({
        id: ROBOT_ID,
        ownerId: 'owner-1',
        queueMode: 'FIRST_COME',
      }),
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
        {
          id: BUTTON_ID,
          command: 'forward',
          access: ControlButtonAccess.QUEUE_TURN,
          cooldownMs: 120,
          costCredits: 0,
        },
      ]),
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn(),
      transaction: { create: jest.fn(), findUnique: jest.fn() },
      adminAuditLog: { create: jest.fn() },
      billingIntent: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      billingWebhookEvent: { create: jest.fn() },
      payoutRequest: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      walletIdempotencyKey: { create: jest.fn(), update: jest.fn() },
      controlCommand: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      robot: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
      },
    };
    const walletService = {
      runSerializable: jest.fn(),
      debitInTransaction: jest.fn().mockResolvedValue({ balanceAfter: 80 }),
      completeReservedControlInTransaction: jest.fn().mockResolvedValue(undefined),
      compensateReservedControlInTransaction: jest.fn().mockResolvedValue({ balanceAfter: 100 }),
      listStaleReservedControlIds: jest.fn().mockResolvedValue([]),
    };
    walletService.runSerializable.mockImplementation(<T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx));
    const features = {
      isEnabled: jest.fn().mockReturnValue(false),
    };

    return {
      handler: new ControlHandler(
        ctx,
        robotsService,
        moderationService,
        queueService,
        controlsService,
        walletService,
        features,
      ),
      ctx,
      robotsService,
      moderationService,
      queueService,
      controlsService,
      walletService,
      features,
      tx,
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

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      robotId: ROBOT_ID,
      commandId: COMMAND_ID,
      buttonId: BUTTON_ID,
      command: 'forward',
      timestamp: Date.now(),
      ...overrides,
    };
  }

  function expectError(client: ReturnType<typeof createClient>, message: string) {
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ event: WS_EVENTS.ERROR, data: { message } }),
    );
  }

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('validation and access', () => {
    it('rejects malformed, blank, stale, and future commands', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
      const { handler, ctx } = buildHandler();
      const client = createClient();

      await handler.handle(client, { command: 'forward' });
      expectError(client, 'Invalid control command payload');

      await handler.handle(client, payload({ command: '   ' }));
      expectError(client, 'Invalid control command');

      await handler.handle(
        client,
        payload({ timestamp: Date.now() - LIMITS.LATENCY_EMERGENCY_STOP_MS - 1 }),
      );
      await handler.handle(
        client,
        payload({ timestamp: Date.now() + LIMITS.MAX_CONTROL_CLOCK_SKEW_MS + 1 }),
      );
      expect(ctx.triggerEmergencyStop).toHaveBeenCalledTimes(2);
      expect(client.send).toHaveBeenCalledWith(
        expect.stringContaining('STALE_CONTROL_COMMAND'),
      );
    });

    it('requires room membership and honors disabled or authenticated-only policies', async () => {
      const first = buildHandler();
      const outside = createClient({ watchingRobotId: 'another-room' });
      await first.handler.handle(outside, payload());
      expectError(outside, 'Join the room before sending controls');

      const second = buildHandler();
      second.robotsService.getAccessPolicy.mockResolvedValue({ control: 'DISABLED' });
      const disabled = createClient();
      await second.handler.handle(disabled, payload());
      expectError(disabled, 'Control is disabled for this robot');

      const third = buildHandler();
      third.robotsService.getAccessPolicy.mockResolvedValue({ control: 'AUTHENTICATED' });
      const guest = createClient({ userId: undefined, isGuest: true });
      await third.handler.handle(guest, payload());
      expectError(guest, 'Please sign in to control this robot');
    });

    it('blocks unauthorized buttons, active restrictions, offline robots, and cooldowns', async () => {
      const unauthorized = buildHandler();
      unauthorized.controlsService.getEnabledButtonsForRobot.mockResolvedValue([]);
      unauthorized.queueService.getCurrentControllerUserId.mockResolvedValue('another-user');
      const noTurn = createClient();
      await unauthorized.handler.handle(noTurn, payload({ buttonId: undefined }));
      expectError(noTurn, 'Wait for your turn in the queue before sending controls');

      const restricted = buildHandler();
      restricted.moderationService.getActiveRestriction.mockResolvedValue({ action: 'TIMEOUT' });
      const restrictedClient = createClient();
      await restricted.handler.handle(restrictedClient, payload());
      expect(restricted.ctx.broadcastToRoom).not.toHaveBeenCalled();
      expect(restrictedClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          event: WS_EVENTS.ERROR,
          data: {
            message: 'You are restricted in this room',
            restriction: { action: 'TIMEOUT' },
          },
        }),
      );

      const offline = buildHandler();
      const offlineClient = createClient();
      await offline.handler.handle(offlineClient, payload());
      expectError(offlineClient, 'Robot realtime control channel is offline');

      const coolingDown = buildHandler();
      coolingDown.ctx.getOpenRobotClient.mockReturnValue({ send: jest.fn() });
      coolingDown.ctx.consumeControlCooldown.mockResolvedValue(false);
      const coolingClient = createClient();
      await coolingDown.handler.handle(coolingClient, payload());
      expect(coolingDown.ctx.broadcastToRoom).not.toHaveBeenCalled();
    });

    it('skips queue lookup in disabled queue mode and sends a free command', async () => {
      const { handler, ctx, robotsService, queueService } = buildHandler();
      robotsService.findByIdCached.mockResolvedValue({
        id: ROBOT_ID,
        ownerId: 'owner-1',
        queueMode: 'DISABLED',
      });
      ctx.getOpenRobotClient.mockReturnValue({ send: jest.fn() });

      await handler.handle(createClient(), payload());

      expect(queueService.getCurrentControllerUserId).not.toHaveBeenCalled();
      expect(ctx.broadcastToRoom).toHaveBeenCalled();
    });
  });

  describe('paid command reservation', () => {
    function preparePaid() {
      const built = buildHandler();
      built.controlsService.getEnabledButtonsForRobot.mockResolvedValue([
        {
          id: BUTTON_ID,
          command: 'forward',
          access: ControlButtonAccess.EVERYONE,
          cooldownMs: 0,
          costCredits: 20,
        },
      ]);
      built.ctx.getOpenRobotClient.mockReturnValue({ send: jest.fn() });
      return built;
    }

    it('fails closed when paid controls are disabled or identity/payee data is missing', async () => {
      const disabled = preparePaid();
      const disabledClient = createClient();
      await disabled.handler.handle(disabledClient, payload());
      expect(disabledClient.send).toHaveBeenCalledWith(
        expect.stringContaining('FEATURE_DISABLED'),
      );

      const guest = preparePaid();
      guest.features.isEnabled.mockReturnValue(true);
      const guestClient = createClient({ userId: undefined });
      await guest.handler.handle(guestClient, payload());
      expect(guestClient.send).toHaveBeenCalledWith(expect.stringContaining('AUTH_REQUIRED'));

      const noOwner = preparePaid();
      noOwner.features.isEnabled.mockReturnValue(true);
      noOwner.robotsService.findByIdCached.mockResolvedValue({
        id: ROBOT_ID,
        ownerId: null,
        queueMode: 'DISABLED',
      });
      const noOwnerClient = createClient();
      await noOwner.handler.handle(noOwnerClient, payload());
      expectError(noOwnerClient, 'Robot owner is unavailable for paid controls');
    });

    it('does not transfer funds when the owner presses a paid button', async () => {
      const { handler, features, ctx, walletService } = preparePaid();
      features.isEnabled.mockReturnValue(true);
      const client = createClient({ userId: 'owner-1' });

      await handler.handle(client, payload());

      expect(walletService.runSerializable).not.toHaveBeenCalled();
      expect(ctx.broadcastToRoom).toHaveBeenCalledWith(
        ROBOT_ID,
        WS_EVENTS.CROWD_INPUT,
        expect.objectContaining({ costCredits: 20 }),
        client.id,
      );
    });

    it('returns duplicate, insufficient-funds, and generic reservation failures safely', async () => {
      const duplicate = preparePaid();
      duplicate.features.isEnabled.mockReturnValue(true);
      duplicate.tx.controlCommand.findUnique.mockResolvedValue({ id: COMMAND_ID });
      const duplicateClient = createClient();
      await duplicate.handler.handle(duplicateClient, payload());
      expect(duplicateClient.send).toHaveBeenCalledWith(
        expect.stringContaining('duplicate'),
      );

      const insufficient = preparePaid();
      insufficient.features.isEnabled.mockReturnValue(true);
      insufficient.walletService.debitInTransaction.mockRejectedValue(
        new InsufficientFundsError(20, 4),
      );
      const insufficientClient = createClient();
      await insufficient.handler.handle(insufficientClient, payload());
      expect(insufficientClient.send).toHaveBeenCalledWith(
        expect.stringContaining(WS_EVENTS.WALLET_INSUFFICIENT_FUNDS),
      );

      const failed = preparePaid();
      failed.features.isEnabled.mockReturnValue(true);
      failed.walletService.runSerializable.mockRejectedValue(
        new Error('database offline'),
      );
      const failedClient = createClient();
      await failed.handler.handle(failedClient, payload());
      expectError(failedClient, 'Could not charge for control');
    });

    it('reserves, forwards, reports pending balance, and finalizes an ACK', async () => {
      const { handler, features, ctx, tx, walletService } = preparePaid();
      features.isEnabled.mockReturnValue(true);
      const client = createClient();
      await handler.handle(client, payload({ value: 0.7 }));

      expect(tx.controlCommand.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: COMMAND_ID, costCredits: 20 }),
      });
      expect(client.send).toHaveBeenCalledWith(
        JSON.stringify({
          event: WS_EVENTS.WALLET_UPDATE,
          data: { balance: 80, commandId: COMMAND_ID, status: 'pending' },
        }),
      );
      expect(ctx.getOpenRobotClient().send).toHaveBeenCalledWith(
        expect.stringContaining('"ackRequired":true'),
      );

      tx.controlCommand.findUnique.mockResolvedValue({
        id: COMMAND_ID,
        robotId: ROBOT_ID,
        userId: 'user-1',
        buttonId: BUTTON_ID,
        command: 'forward',
        costCredits: 20,
        ledgerGroupId: 'ledger-1',
        status: 'PENDING',
      });
      await handler.handleAck(
        createClient({ isRobot: true, robotId: ROBOT_ID }),
        { commandId: COMMAND_ID, status: 'ACK' },
      );
      expect(walletService.completeReservedControlInTransaction).toHaveBeenCalled();
      expect(tx.controlCommand.update).toHaveBeenCalledWith({
        where: { id: COMMAND_ID },
        data: expect.objectContaining({ status: 'ACKED' }),
      });
      expect(client.send).toHaveBeenCalledWith(expect.stringContaining('completed'));
      handler.shutdown();
    });

    it('compensates a reservation when socket forwarding throws', async () => {
      const { handler, features, ctx, tx, walletService } = preparePaid();
      features.isEnabled.mockReturnValue(true);
      ctx.getOpenRobotClient.mockReturnValue({
        send: jest.fn(() => {
          throw new Error('socket closed');
        }),
      });
      tx.controlCommand.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: COMMAND_ID,
          robotId: ROBOT_ID,
          userId: 'user-1',
          costCredits: 20,
          ledgerGroupId: 'ledger-1',
          status: 'PENDING',
        });

      await expect(handler.handle(createClient(), payload())).rejects.toThrow('socket closed');

      expect(walletService.compensateReservedControlInTransaction).toHaveBeenCalled();
      expect(tx.controlCommand.update).toHaveBeenCalledWith({
        where: { id: COMMAND_ID },
        data: expect.objectContaining({
          status: 'COMPENSATED',
          errorCode: 'SOCKET_SEND_FAILED',
        }),
      });
    });

    it('compensates an unacknowledged reservation when the bounded ACK timer expires', async () => {
      jest.useFakeTimers();
      const { handler, features, tx, walletService } = preparePaid();
      features.isEnabled.mockReturnValue(true);
      tx.controlCommand.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: COMMAND_ID,
          robotId: ROBOT_ID,
          userId: 'user-1',
          costCredits: 20,
          ledgerGroupId: 'ledger-1',
          status: 'PENDING',
        });

      await handler.handle(createClient(), payload());
      await jest.advanceTimersByTimeAsync(3_000);

      expect(walletService.compensateReservedControlInTransaction).toHaveBeenCalledTimes(1);
      expect(tx.controlCommand.update).toHaveBeenCalledWith({
        where: { id: COMMAND_ID },
        data: expect.objectContaining({ status: 'COMPENSATED', errorCode: 'ACK_TIMEOUT' }),
      });
      handler.shutdown();
    });
  });

  describe('acknowledgement and recovery', () => {
    const stored = {
      id: COMMAND_ID,
      robotId: ROBOT_ID,
      userId: 'user-1',
      buttonId: BUTTON_ID,
      command: 'forward',
      costCredits: 20,
      ledgerGroupId: 'ledger-1',
      status: 'PENDING',
    };

    it('ignores invalid acknowledgements and unknown or mismatched commands', async () => {
      const { handler, tx, walletService } = buildHandler();
      await handler.handleAck(createClient(), { commandId: 'invalid', status: 'ACK' });
      expect(walletService.runSerializable).not.toHaveBeenCalled();

      const robot = createClient({ isRobot: true, robotId: ROBOT_ID });
      await handler.handleAck(robot, { commandId: COMMAND_ID, status: 'ACK' });
      tx.controlCommand.findUnique.mockResolvedValueOnce({
        ...stored,
        robotId: '650e8400-e29b-41d4-a716-446655440000',
      });
      await handler.handleAck(robot, { commandId: COMMAND_ID, status: 'ACK' });
      tx.controlCommand.findUnique.mockResolvedValueOnce({ ...stored, status: 'ACKED' });
      await handler.handleAck(robot, { commandId: COMMAND_ID, status: 'ACK' });
      expect(tx.controlCommand.update).not.toHaveBeenCalled();
    });

    it('compensates NACKs and reports refund/failure to a pending viewer', async () => {
      const { handler, tx, walletService } = buildHandler();
      const viewer = createClient();
      const timer = setTimeout(() => undefined, 60_000);
      handler.trackPendingCommand(COMMAND_ID, {
        robotId: ROBOT_ID,
        userId: 'user-1',
        ownerId: 'owner-1',
        amount: 20,
        timer,
        client: viewer,
      });
      tx.controlCommand.findUnique.mockResolvedValue(stored);

      await handler.handleAck(
        createClient({ isRobot: true, robotId: ROBOT_ID }),
        { commandId: COMMAND_ID, status: 'NACK', message: 'motor rejected' },
      );

      expect(walletService.compensateReservedControlInTransaction).toHaveBeenCalled();
      expect(viewer.send).toHaveBeenCalledWith(expect.stringContaining('refunded'));
      expect(viewer.send).toHaveBeenCalledWith(expect.stringContaining('ROBOT_NACK'));
    });

    it('does not settle ACKs without a payee or ledger group', async () => {
      const { handler, tx, walletService } = buildHandler();
      tx.controlCommand.findUnique
        .mockResolvedValueOnce({ ...stored, ledgerGroupId: null })
        .mockResolvedValueOnce(stored);
      const robot = createClient({ isRobot: true, robotId: ROBOT_ID });
      await handler.handleAck(robot, { commandId: COMMAND_ID, status: 'ACK' });
      tx.robot.findUnique.mockResolvedValueOnce(null);
      await handler.handleAck(robot, { commandId: COMMAND_ID, status: 'ACK' });
      expect(walletService.completeReservedControlInTransaction).not.toHaveBeenCalled();
    });

    it('reconciles each stale reservation and leaves already-final rows unchanged', async () => {
      const { handler, tx, walletService } = buildHandler();
      walletService.listStaleReservedControlIds.mockResolvedValue([COMMAND_ID]);
      tx.controlCommand.findUnique.mockResolvedValue({ ...stored, status: 'ACKED' });

      await handler.reconcilePendingCommands();

      expect(walletService.listStaleReservedControlIds).toHaveBeenCalledWith(expect.any(Date));
      expect(walletService.compensateReservedControlInTransaction).not.toHaveBeenCalled();
      handler.shutdown();
    });
  });

  describe('command authorization matrix', () => {
    async function authorize(
      built: ReturnType<typeof buildHandler>,
      overrides: Record<string, unknown> = {},
    ) {
      return built.handler.authorizeCommand({
        robot: { id: ROBOT_ID, ownerId: 'owner-1', queueMode: 'FIRST_COME' },
        client: createClient(),
        command: 'forward',
        buttonId: BUTTON_ID,
        currentControllerUserId: 'user-1',
        ...overrides,
      });
    }

    it('supports safe fallback controls and rejects unknown fallbacks', async () => {
      const built = buildHandler();
      built.controlsService.getEnabledButtonsForRobot.mockResolvedValue([]);
      await expect(authorize(built)).resolves.toEqual(
        expect.objectContaining({ allowed: true, cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS }),
      );
      await expect(authorize(built, { command: 'stop' })).resolves.toEqual(
        expect.objectContaining({ allowed: true, cooldownMs: 0 }),
      );
      await expect(authorize(built, { command: 'dance' })).resolves.toEqual(
        expect.objectContaining({ allowed: false, message: 'Unknown or disabled control' }),
      );
    });

    it('authorizes emergency stop for queue holder, disabled queue, or moderator', async () => {
      const built = buildHandler();
      await expect(authorize(built, { command: 'stop' })).resolves.toHaveProperty('allowed', true);
      await expect(
        authorize(built, {
          command: 'stop',
          currentControllerUserId: null,
          robot: { id: ROBOT_ID, ownerId: 'owner-1', queueMode: 'DISABLED' },
        }),
      ).resolves.toHaveProperty('allowed', true);
      built.ctx.isRoomModerator.mockReturnValueOnce(true);
      await expect(
        authorize(built, { command: 'stop', currentControllerUserId: 'another-user' }),
      ).resolves.toHaveProperty('allowed', true);
      await expect(
        authorize(built, { command: 'stop', currentControllerUserId: 'another-user' }),
      ).resolves.toHaveProperty('allowed', false);
    });

    it('matches button id and command and clamps negative button values', async () => {
      const built = buildHandler();
      built.controlsService.getEnabledButtonsForRobot.mockResolvedValue([
        {
          id: BUTTON_ID,
          command: 'forward',
          access: ControlButtonAccess.EVERYONE,
          cooldownMs: -20,
          costCredits: -10,
        },
      ]);
      await expect(authorize(built)).resolves.toEqual({
        allowed: true,
        message: '',
        cooldownMs: 0,
        costCredits: 0,
        buttonId: BUTTON_ID,
      });
      await expect(authorize(built, { buttonId: undefined })).resolves.toHaveProperty(
        'allowed',
        false,
      );
    });

    it('enforces owner, moderator, and queue-turn button roles', async () => {
      const owner = buildHandler();
      owner.controlsService.getEnabledButtonsForRobot.mockResolvedValue([
        { id: BUTTON_ID, command: 'forward', access: ControlButtonAccess.OWNER, cooldownMs: 0 },
      ]);
      await expect(authorize(owner)).resolves.toEqual(
        expect.objectContaining({ allowed: false, message: 'This control is reserved for the robot owner' }),
      );
      await expect(
        authorize(owner, { client: createClient({ userId: 'owner-1' }) }),
      ).resolves.toHaveProperty('allowed', true);

      const moderator = buildHandler();
      moderator.controlsService.getEnabledButtonsForRobot.mockResolvedValue([
        {
          id: BUTTON_ID,
          command: 'forward',
          access: ControlButtonAccess.MODERATOR,
          cooldownMs: 0,
        },
      ]);
      await expect(authorize(moderator)).resolves.toEqual(
        expect.objectContaining({
          allowed: false,
          message: 'This control is reserved for moderators',
        }),
      );
      moderator.ctx.isRoomModerator.mockReturnValue(true);
      await expect(authorize(moderator)).resolves.toHaveProperty('allowed', true);

      const queue = buildHandler();
      await expect(
        authorize(queue, { currentControllerUserId: 'another-user' }),
      ).resolves.toEqual(
        expect.objectContaining({
          allowed: false,
          message: 'Wait for your turn in the queue before sending controls',
        }),
      );
    });
  });

  it('broadcasts, forwards, and warns about high but non-stale latency', async () => {
    const { handler, ctx } = buildHandler();
    const client = createClient();
    const robotClient = { send: jest.fn() };
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    ctx.getOpenRobotClient.mockReturnValue(robotClient);

    await handler.handle(
      client,
      payload({ timestamp: now - LIMITS.LATENCY_WARNING_MS - 25 }),
    );

    expect(ctx.broadcastToRoom).toHaveBeenCalledWith(
      ROBOT_ID,
      WS_EVENTS.CROWD_INPUT,
      {
        userId: 'user-1',
        username: 'alpha',
        command: 'forward',
        commandId: COMMAND_ID,
        costCredits: 0,
      },
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
  });
});
