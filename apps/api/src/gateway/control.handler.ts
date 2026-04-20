import { Logger } from '@nestjs/common';
import { WS_EVENTS, LIMITS, ControlButtonAccess, controlCommandSchema } from '@botparty/shared';
import { isStaffRole } from '../common/robot-access';
import type { ModerationService } from '../moderation/moderation.service';
import type { RobotsService } from '../robots/robots.service';
import type { QueueService } from '../queue/queue.service';
import type { ControlsService } from '../controls/controls.service';
import type { CommandMetadata, WsClient } from './gateway-types';
import { z } from 'zod';

export interface ControlHandlerContext {
  broadcastToRoom(robotId: string, event: string, data: unknown, excludeClientId?: string): void;
  getOpenRobotClient(robotId: string): WsClient | undefined;
  buildCommandMetadata(client: WsClient, robotId: string, ownerId?: string | null): CommandMetadata;
  consumeControlCooldown(client: WsClient, robotId: string, command: string, cooldownMs: number): Promise<boolean>;
  isRoomModerator(client: WsClient, ownerId?: string | null): boolean;
}

const incomingControlSchema = controlCommandSchema
  .extend({ robotId: z.string().uuid() })
  .strict();

export class ControlHandler {
  private readonly logger = new Logger(ControlHandler.name);

  constructor(
    private readonly ctx: ControlHandlerContext,
    private readonly robotsService: RobotsService,
    private readonly moderationService: ModerationService,
    private readonly queueService: QueueService,
    private readonly controlsService: ControlsService,
  ) {}

  async handle(client: WsClient, rawPayload: unknown): Promise<void> {
    const parsed = incomingControlSchema.safeParse(rawPayload);
    if (!parsed.success) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid control command payload' } }));
      return;
    }
    const data = parsed.data;

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

    const commandAccess = await this._authorizeCommand({
      robot,
      client,
      command,
      currentControllerUserId,
    });
    if (!commandAccess.allowed) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: commandAccess.message } }));
      return;
    }

    if (!(await this.ctx.consumeControlCooldown(client, data.robotId, command, commandAccess.cooldownMs))) {
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

    this.ctx.broadcastToRoom(
      data.robotId,
      WS_EVENTS.CROWD_INPUT,
      { userId: client.userId, username: client.username, command },
      client.id,
    );

    const robotClient = this.ctx.getOpenRobotClient(data.robotId);
    if (!robotClient) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Robot realtime control channel is offline' } }));
      return;
    }

    const now = Date.now();
    robotClient.send(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND,
        data: {
          command,
          value: data.value,
          metadata: this.ctx.buildCommandMetadata(client, data.robotId, robot.ownerId),
          userId: client.userId,
          timestamp: now,
          clientTimestamp: data.timestamp,
        },
      }),
    );

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

  private async _authorizeCommand(input: {
    robot: Awaited<ReturnType<RobotsService['findById']>>;
    client: WsClient;
    command: string;
    currentControllerUserId: string | null;
  }): Promise<{ allowed: boolean; message: string; cooldownMs: number }> {
    const { robot, client, command, currentControllerUserId } = input;
    const normalizedCommand = command.trim();
    const queueDisabled = robot.queueMode === 'DISABLED';
    const isCurrentController = Boolean(client.userId && currentControllerUserId === client.userId);
    const enabledButtons = await this.controlsService.getEnabledButtonsForRobot(robot.id);

    if (enabledButtons.length === 0) {
      const fallbackCommands = new Set(['forward', 'backward', 'left', 'right', 'stop']);
      if (!fallbackCommands.has(normalizedCommand)) {
        return { allowed: false, message: 'Unknown or disabled control', cooldownMs: 0 };
      }

      if (!queueDisabled && !isCurrentController) {
        return { allowed: false, message: 'Wait for your turn in the queue before sending controls', cooldownMs: 0 };
      }

      return {
        allowed: true,
        message: '',
        cooldownMs: normalizedCommand === 'stop' ? 0 : LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
      };
    }

    if (normalizedCommand === 'stop') {
      if (queueDisabled || isCurrentController || this.ctx.isRoomModerator(client, robot.ownerId)) {
        return { allowed: true, message: '', cooldownMs: 0 };
      }
      return { allowed: false, message: 'Wait for your turn in the queue before sending controls', cooldownMs: 0 };
    }

    const matchingButtons = enabledButtons.filter((button) => button.command === normalizedCommand);
    if (matchingButtons.length === 0) {
      return { allowed: false, message: 'Unknown or disabled control', cooldownMs: 0 };
    }

    const allowedButtons = matchingButtons.filter((button) =>
      this._canUseButton({ buttonAccess: button.access, client, ownerId: robot.ownerId, isCurrentController, queueDisabled }),
    );

    if (allowedButtons.length > 0) {
      return {
        allowed: true,
        message: '',
        cooldownMs: Math.max(0, Math.min(...allowedButtons.map((button) => Math.max(0, button.cooldownMs)))),
      };
    }

    if (matchingButtons.some((button) => button.access === ControlButtonAccess.OWNER)) {
      return { allowed: false, message: 'This control is reserved for the robot owner', cooldownMs: 0 };
    }

    if (matchingButtons.some((button) => button.access === ControlButtonAccess.MODERATOR)) {
      return { allowed: false, message: 'This control is reserved for moderators', cooldownMs: 0 };
    }

    return { allowed: false, message: 'Wait for your turn in the queue before sending controls', cooldownMs: 0 };
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
