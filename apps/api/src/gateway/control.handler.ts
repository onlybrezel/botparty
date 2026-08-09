import { Logger } from '@nestjs/common';
import { WS_EVENTS, LIMITS, ControlButtonAccess, controlCommandSchema } from '@botparty/shared';
import { TransactionType, type Prisma } from '@botparty/prisma';
import type { ModerationService } from '../moderation/moderation.service';
import type { RobotsService } from '../robots/robots.service';
import type { QueueService } from '../queue/queue.service';
import type { ControlsService } from '../controls/controls.service';
import type { WalletService } from '../wallet/wallet.service';
import { InsufficientFundsError } from '../wallet/wallet.service';
import type { CommandMetadata, WsClient } from './gateway-types';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { FeatureFlagsService } from '../common/feature-flags.service';

export interface ControlHandlerContext {
  broadcastToRoom(robotId: string, event: string, data: unknown, excludeClientId?: string): void;
  getOpenRobotClient(robotId: string): WsClient | undefined;
  buildCommandMetadata(client: WsClient, robotId: string, ownerId?: string | null): CommandMetadata;
  consumeControlCooldown(client: WsClient, robotId: string, command: string, cooldownMs: number): Promise<boolean>;
  isRoomModerator(client: WsClient, ownerId?: string | null): boolean;
  triggerEmergencyStop(robotId: string, reason: string): void;
}

type ControlRobotsPort = Pick<RobotsService, 'findByIdCached' | 'getAccessPolicy'>;
type ControlModerationPort = Pick<ModerationService, 'getActiveRestriction'>;
type ControlQueuePort = Pick<QueueService, 'getCurrentControllerUserId'>;
type ControlButtonsPort = Pick<ControlsService, 'getEnabledButtonsForRobot'>;
type ControlFeaturesPort = Pick<FeatureFlagsService, 'isEnabled'>;
type PendingControlCommand = {
  robotId: string;
  userId: string;
  ownerId: string;
  amount: number;
  timer: ReturnType<typeof setTimeout>;
  client: WsClient;
};
export interface ControlAuthorizationInput {
  robot: { id: string; ownerId: string | null; queueMode: string };
  client: WsClient;
  command: string;
  buttonId?: string | undefined;
  currentControllerUserId: string | null;
}
type ControlTransaction = {
  $executeRaw: Prisma.TransactionClient['$executeRaw'];
  controlCommand: Pick<Prisma.TransactionClient['controlCommand'], 'create' | 'findUnique' | 'update'>;
  robot: Pick<Prisma.TransactionClient['robot'], 'findUnique'>;
};
interface ControlWalletPort {
  runSerializable<T>(callback: (transaction: ControlTransaction) => Promise<T>): Promise<T>;
  debitInTransaction(
    transaction: ControlTransaction,
    userId: string,
    amount: number,
    type: TransactionType,
    options: Parameters<WalletService['debitInTransaction']>[4],
  ): ReturnType<WalletService['debitInTransaction']>;
  completeReservedControlInTransaction(
    transaction: ControlTransaction,
    input: Parameters<WalletService['completeReservedControlInTransaction']>[1],
  ): ReturnType<WalletService['completeReservedControlInTransaction']>;
  compensateReservedControlInTransaction(
    transaction: ControlTransaction,
    input: Parameters<WalletService['compensateReservedControlInTransaction']>[1],
  ): ReturnType<WalletService['compensateReservedControlInTransaction']>;
  listStaleReservedControlIds: WalletService['listStaleReservedControlIds'];
}

const incomingControlSchema = controlCommandSchema
  .extend({ robotId: z.string().uuid() })
  .strict();

export class ControlHandler {
  private readonly logger = new Logger(ControlHandler.name);
  private readonly pending = new Map<string, PendingControlCommand>();

  constructor(
    private readonly ctx: ControlHandlerContext,
    private readonly robotsService: ControlRobotsPort,
    private readonly moderationService: ControlModerationPort,
    private readonly queueService: ControlQueuePort,
    private readonly controlsService: ControlButtonsPort,
    private readonly walletService: ControlWalletPort,
    private readonly features: ControlFeaturesPort,
  ) {}

  async handle(client: WsClient, rawPayload: unknown): Promise<void> {
    const parsed = incomingControlSchema.safeParse(rawPayload);
    if (!parsed.success) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid control command payload' } }));
      return;
    }
    const data = parsed.data;
    const receivedAt = Date.now();
    const commandAgeMs = receivedAt - data.timestamp;
    if (
      commandAgeMs < -LIMITS.MAX_CONTROL_CLOCK_SKEW_MS
      || commandAgeMs > LIMITS.LATENCY_EMERGENCY_STOP_MS
    ) {
      this.ctx.triggerEmergencyStop(data.robotId, 'stale_control_command');
      client.send(JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: {
          code: 'STALE_CONTROL_COMMAND',
          message: 'Control command arrived too late.',
          commandAgeMs,
        },
      }));
      return;
    }

    const command = typeof data.command === 'string' ? data.command.trim() : '';
    if (!command) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid control command' } }));
      return;
    }

    if (client.watchingRobotId !== data.robotId) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Join the room before sending controls' } }));
      return;
    }

    const robot = await this.robotsService.findByIdCached(data.robotId);
    const access = await this.robotsService.getAccessPolicy(data.robotId);
    if (access.control === 'DISABLED') {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Control is disabled for this robot' } }));
      return;
    }
    if (access.control === 'AUTHENTICATED' && client.isGuest) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Please sign in to control this robot' } }));
      return;
    }

    const currentControllerUserId =
      robot.queueMode === 'DISABLED'
        ? null
        : await this.queueService.getCurrentControllerUserId(data.robotId);

    const commandAccess = await this.authorizeCommand({
      robot,
      client,
      command,
      buttonId: data.buttonId,
      currentControllerUserId,
    });
    if (!commandAccess.allowed) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: commandAccess.message } }));
      return;
    }

    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(data.robotId, client.userId);
      if (restriction) {
        client.send(
          JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'You are restricted in this room', restriction } }),
        );
        return;
      }
    }

    // Verify the robot is online before charging or consuming cooldown.
    const robotClient = this.ctx.getOpenRobotClient(data.robotId);
    if (!robotClient) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Robot realtime control channel is offline' } }));
      return;
    }

    if (!(await this.ctx.consumeControlCooldown(client, data.robotId, command, commandAccess.cooldownMs))) {
      return;
    }

    // Charge for costed buttons. Owner pressing own button is a no-op transfer
    // (skipped). Errors abort before broadcasting/sending the command.
    const cost = commandAccess.costCredits;
    if (cost > 0 && !this.features.isEnabled('PAID_CONTROLS')) {
      client.send(JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { code: 'FEATURE_DISABLED', message: 'Paid controls are not enabled.' },
      }));
      return;
    }
    let reservedBalanceAfter: number | null = null;
    if (cost > 0) {
      if (!client.userId) {
        client.send(
          JSON.stringify({
            event: WS_EVENTS.ERROR,
            data: { code: 'AUTH_REQUIRED', message: 'Sign in to use paid controls' },
          }),
        );
        return;
      }
      const payerId = client.userId;

      if (!robot.ownerId) {
        client.send(
          JSON.stringify({
            event: WS_EVENTS.ERROR,
            data: { message: 'Robot owner is unavailable for paid controls' },
          }),
        );
        return;
      }

      if (payerId !== robot.ownerId) {
        try {
          const ledgerGroupId = randomUUID();
          const reservation = await this.walletService.runSerializable(async (tx) => {
            const existing = await tx.controlCommand.findUnique({ where: { id: data.commandId } });
            if (existing) return { duplicate: true, balanceAfter: null };
            await tx.controlCommand.create({
              data: {
                id: data.commandId,
                robotId: robot.id,
                userId: payerId,
                buttonId: commandAccess.buttonId,
                command,
                costCredits: cost,
                ledgerGroupId,
              },
            });
            const debit = await this.walletService.debitInTransaction(
              tx,
              payerId,
              cost,
              TransactionType.BUTTON_SPEND,
              {
                ledgerGroupId,
                controlCommandId: data.commandId,
                description: `Reserved control ${command}`,
                metadata: { robotId: robot.id, command, buttonId: commandAccess.buttonId },
              },
            );
            return { duplicate: false, balanceAfter: debit.balanceAfter };
          });
          if (reservation.duplicate) {
            client.send(JSON.stringify({ event: WS_EVENTS.CONTROL_COMMAND_STATUS, data: { commandId: data.commandId, status: 'duplicate' } }));
            return;
          }
          reservedBalanceAfter = reservation.balanceAfter;
        } catch (err) {
          if (err instanceof InsufficientFundsError) {
            client.send(
              JSON.stringify({
                event: WS_EVENTS.WALLET_INSUFFICIENT_FUNDS,
                data: { required: err.required, balance: err.balance, command },
              }),
            );
            return;
          }
          this.logger.error(`Wallet transfer failed for press: ${(err as Error).message}`);
          client.send(
            JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Could not charge for control' } }),
          );
          return;
        }
      }
    }

    this.ctx.broadcastToRoom(
      data.robotId,
      WS_EVENTS.CROWD_INPUT,
      { userId: client.userId, username: client.username, command, commandId: data.commandId, costCredits: cost },
      client.id,
    );

    const now = Date.now();
    try {
      robotClient.send(JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND,
        data: {
          commandId: data.commandId,
          buttonId: commandAccess.buttonId,
          command,
          value: data.value,
          metadata: this.ctx.buildCommandMetadata(client, data.robotId, robot.ownerId),
          userId: client.userId,
          timestamp: now,
          clientTimestamp: data.timestamp,
          ackRequired: cost > 0 && client.userId !== robot.ownerId,
        },
      }));
    } catch (error) {
      if (cost > 0 && client.userId && robot.ownerId && client.userId !== robot.ownerId) {
        await this.compensate(data.commandId, 'SOCKET_SEND_FAILED');
      }
      throw error;
    }

    if (cost > 0 && client.userId && robot.ownerId && client.userId !== robot.ownerId) {
      const timer = setTimeout(() => {
        void this.compensate(data.commandId, 'ACK_TIMEOUT').catch((error) => {
          this.logger.error(
            `Failed to compensate timed-out control command ${data.commandId}: ${(error as Error).message}`,
          );
        });
      }, 3_000);
      this.pending.set(data.commandId, {
        robotId: robot.id,
        userId: client.userId,
        ownerId: robot.ownerId,
        amount: cost,
        timer,
        client,
      });
      client.send(JSON.stringify({
        event: WS_EVENTS.WALLET_UPDATE,
        data: { balance: reservedBalanceAfter, commandId: data.commandId, status: 'pending' },
      }));
    }

    if (Number.isFinite(data.timestamp)) {
      const clientServerDeltaMs = now - data.timestamp;
      const withinExpectedRange =
        clientServerDeltaMs >= 0 && clientServerDeltaMs <= LIMITS.MAX_CONTROL_CLOCK_SKEW_MS;

      if (withinExpectedRange && clientServerDeltaMs > LIMITS.LATENCY_WARNING_MS) {
        client.send(
          JSON.stringify({
            event: WS_EVENTS.CONTROL_LATENCY_WARNING,
            data: { latencyMs: Math.max(0, clientServerDeltaMs) },
          }),
        );
      }
    }
  }

  async handleAck(client: WsClient, rawPayload: unknown): Promise<void> {
    const parsed = z.object({
      commandId: z.string().uuid(),
      status: z.enum(['ACK', 'NACK']),
      message: z.string().max(256).optional(),
    }).strict().safeParse(rawPayload);
    if (!parsed.success || !client.isRobot || !client.robotId) return;

    const pending = this.pending.get(parsed.data.commandId);
    const command = await this.walletService.runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT id FROM control_commands WHERE id = ${parsed.data.commandId}::uuid FOR UPDATE`;
      const stored = await tx.controlCommand.findUnique({ where: { id: parsed.data.commandId } });
      if (!stored || stored.robotId !== client.robotId || stored.status !== 'PENDING') return null;
      if (parsed.data.status === 'NACK') return stored;
      const robot = await tx.robot.findUnique({ where: { id: stored.robotId }, select: { ownerId: true } });
      if (!robot || !stored.ledgerGroupId) return stored;
      await this.walletService.completeReservedControlInTransaction(tx, {
        payeeId: robot.ownerId,
        gross: stored.costCredits,
        ledgerGroupId: stored.ledgerGroupId,
        controlCommandId: stored.id,
        metadata: { robotId: stored.robotId, command: stored.command, buttonId: stored.buttonId },
      });
      await tx.controlCommand.update({
        where: { id: stored.id },
        data: { status: 'ACKED', acknowledgedAt: new Date(), completedAt: new Date() },
      });
      return { ...stored, status: 'ACKED' as const };
    });

    if (!command) return;
    if (parsed.data.status === 'NACK') {
      await this.compensate(parsed.data.commandId, 'ROBOT_NACK');
      return;
    }
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(parsed.data.commandId);
      pending.client.send(JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND_STATUS,
        data: { commandId: parsed.data.commandId, status: 'completed' },
      }));
    }
  }

  async reconcilePendingCommands(): Promise<void> {
    const staleIds = await this.walletService.listStaleReservedControlIds(new Date(Date.now() - 5_000));
    for (const commandId of staleIds) await this.compensate(commandId, 'PROCESS_RECOVERY');
  }

  shutdown() {
    for (const item of this.pending.values()) clearTimeout(item.timer);
    this.pending.clear();
  }

  private async compensate(commandId: string, errorCode: string) {
    const pending = this.pending.get(commandId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(commandId);
    }
    const result = await this.walletService.runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT id FROM control_commands WHERE id = ${commandId}::uuid FOR UPDATE`;
      const stored = await tx.controlCommand.findUnique({ where: { id: commandId } });
      if (!stored || stored.status !== 'PENDING' || !stored.ledgerGroupId) return null;
      const refund = await this.walletService.compensateReservedControlInTransaction(tx, {
        userId: stored.userId,
        amount: stored.costCredits,
        controlCommandId: stored.id,
        sourceLedgerGroupId: stored.ledgerGroupId,
      });
      await tx.controlCommand.update({
        where: { id: stored.id },
        data: { status: 'COMPENSATED', errorCode, completedAt: new Date() },
      });
      return { balanceAfter: refund.balanceAfter };
    });
    if (pending && result) {
      pending.client.send(JSON.stringify({
        event: WS_EVENTS.WALLET_UPDATE,
        data: { balance: result.balanceAfter, commandId, status: 'refunded' },
      }));
      pending.client.send(JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND_STATUS,
        data: { commandId, status: 'failed', reason: errorCode },
      }));
    }
  }

  trackPendingCommand(commandId: string, command: PendingControlCommand): void {
    this.pending.set(commandId, command);
  }

  async authorizeCommand(input: ControlAuthorizationInput): Promise<{ allowed: boolean; message: string; cooldownMs: number; costCredits: number; buttonId: string | null }> {
    const { robot, client, command, currentControllerUserId, buttonId } = input;
    const normalizedCommand = command.trim();
    const queueDisabled = robot.queueMode === 'DISABLED';
    const isCurrentController = Boolean(client.userId && currentControllerUserId === client.userId);
    const enabledButtons = await this.controlsService.getEnabledButtonsForRobot(robot.id);

    if (enabledButtons.length === 0) {
      const fallbackCommands = new Set(['forward', 'backward', 'left', 'right', 'stop']);
      if (!fallbackCommands.has(normalizedCommand)) {
        return { allowed: false, message: 'Unknown or disabled control', cooldownMs: 0, costCredits: 0, buttonId: null };
      }

      if (!queueDisabled && !isCurrentController) {
        return {
          allowed: false,
          message: 'Wait for your turn in the queue before sending controls',
          cooldownMs: 0,
          costCredits: 0, buttonId: null,
        };
      }

      return {
        allowed: true,
        message: '',
        cooldownMs: normalizedCommand === 'stop' ? 0 : LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
        costCredits: 0, buttonId: null,
      };
    }

    if (normalizedCommand === 'stop') {
      if (queueDisabled || isCurrentController || this.ctx.isRoomModerator(client, robot.ownerId)) {
        return { allowed: true, message: '', cooldownMs: 0, costCredits: 0, buttonId: null };
      }
      return {
        allowed: false,
        message: 'Wait for your turn in the queue before sending controls',
        cooldownMs: 0,
        costCredits: 0, buttonId: null,
      };
    }

    const matchingButtons = enabledButtons.filter((button) => button.id === buttonId && button.command === normalizedCommand);
    if (matchingButtons.length === 0) {
      return { allowed: false, message: 'Unknown, disabled or mismatched control', cooldownMs: 0, costCredits: 0, buttonId: null };
    }

    const allowedButtons = matchingButtons.filter((button) =>
      this._canUseButton({ buttonAccess: button.access, client, ownerId: robot.ownerId, isCurrentController, queueDisabled }),
    );

    const selected = allowedButtons[0];
    if (selected) {
      return {
        allowed: true,
        message: '',
        cooldownMs: Math.max(0, selected.cooldownMs),
        costCredits: Math.max(0, selected.costCredits ?? 0),
        buttonId: selected.id,
      };
    }

    if (matchingButtons.some((button) => button.access === ControlButtonAccess.OWNER)) {
      return {
        allowed: false,
        message: 'This control is reserved for the robot owner',
        cooldownMs: 0,
        costCredits: 0, buttonId: null,
      };
    }

    if (matchingButtons.some((button) => button.access === ControlButtonAccess.MODERATOR)) {
      return {
        allowed: false,
        message: 'This control is reserved for moderators',
        cooldownMs: 0,
        costCredits: 0, buttonId: null,
      };
    }

    return {
      allowed: false,
      message: 'Wait for your turn in the queue before sending controls',
      cooldownMs: 0,
      costCredits: 0, buttonId: null,
    };
  }

  private _canUseButton(input: {
    buttonAccess: ControlButtonAccess;
    client: WsClient;
    ownerId: string | null;
    isCurrentController: boolean;
    queueDisabled: boolean;
  }): boolean {
    const { buttonAccess, client, ownerId, isCurrentController, queueDisabled } = input;

    if (buttonAccess === ControlButtonAccess.EVERYONE) return true;
    if (buttonAccess === ControlButtonAccess.QUEUE_TURN) return queueDisabled || isCurrentController;
    if (buttonAccess === ControlButtonAccess.MODERATOR) return this.ctx.isRoomModerator(client, ownerId);
    return Boolean(ownerId && client.userId && client.userId === ownerId);
  }
}
