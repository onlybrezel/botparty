import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { BeforeApplicationShutdown, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, WebSocket } from 'ws';
import { WS_EVENTS, LIMITS, ControlButtonAccess } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';
import { ControlsService } from '../controls/controls.service';
import Redis from 'ioredis';

interface WsClient extends WebSocket {
  id: string;
  userId?: string;
  username?: string;
  isGuest?: boolean;
  /** Which robot room this client is subscribed to */
  watchingRobotId?: string;
  /** True if this socket is the robot hardware client */
  isRobot?: boolean;
  robotId?: string;
  claimToken?: string;
  /** Timestamp of last chat message (for rate limiting) */
  lastChatAt?: number;
  /** User role (for rate-limit tier) */
  role?: string;
}

/** Lightweight presence record broadcast to the room */
interface PresenceRecord {
  userId: string;
  username: string;
  joinedAt: number;
}

interface ActiveTurnState {
  sessionId: string;
  userId: string;
  startedAt: number;
  expiresAt: number;
}

interface CommandMetadata {
  user: {
    id: string | null;
    username: string | null;
    role: string | null;
    isGuest: boolean;
    isRobotOwner: boolean;
    isSiteAdmin: boolean;
    isSiteModerator: boolean;
  };
  robotId: string;
  source: 'gateway' | 'system';
}

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
  },
})
export class BotGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BotGateway.name);
  private subscriber: Redis | null = null;
  private readonly instanceId = crypto.randomUUID();
  private isShuttingDown = false;

  /** All connected sockets: clientId → WsClient */
  private readonly clients = new Map<string, WsClient>();

  /** robotId → hardware WsClient */
  private readonly robotClients = new Map<string, WsClient>();

  /** robotId → Set of viewer/controller clientIds */
  private readonly rooms = new Map<string, Set<string>>();

  /** robotId → Map<userId, PresenceRecord> */
  private readonly presence = new Map<string, Map<string, PresenceRecord>>();
  private readonly activeTurns = new Map<string, ActiveTurnState>();
  private readonly turnTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly controlCooldowns = new Map<string, number>();

  constructor(
    private readonly robotsService: RobotsService,
    private readonly sessionsService: SessionsService,
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
    private readonly moderationService: ModerationService,
    private readonly jwtService: JwtService,
    private readonly controlsService: ControlsService,
  ) {}

  async onModuleInit() {
    this.subscriber = this.redis.duplicate();

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      void this.handleRedisMessage(channel, message);
    });

    await this.subscriber.psubscribe('queue:*', 'ws:moderation:*', 'ws:room:*', 'ws:system:*');
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  async beforeApplicationShutdown(signal?: string) {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    const reason = signal === 'SIGTERM' ? 'maintenance' : 'restart';
    const retryAfterMs = 12000;
    const message =
      reason === 'maintenance'
        ? 'Server maintenance in progress. Reconnecting soon...'
        : 'Realtime connection is restarting. Reconnecting soon...';

    this.logger.warn(`WebSocket gateway shutting down${signal ? ` (${signal})` : ''}`);

    const payload = JSON.stringify({
      event: WS_EVENTS.SERVER_SHUTDOWN,
      data: {
        message,
        reason,
        retryAfterMs,
        signal: signal ?? null,
        ts: Date.now(),
      },
    });

    for (const client of this.clients.values()) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        client.send(payload);
      } catch {
        // Best effort notification during shutdown.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    for (const client of this.clients.values()) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        client.close(1012, 'Server restarting');
      } catch {
        // Ignore close failures during shutdown.
      }
    }
  }

  handleConnection(client: WsClient) {
    client.id = crypto.randomUUID();
    this.clients.set(client.id, client);
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: WsClient) {
    this.clients.delete(client.id);

    // Leave the robot room
    if (client.watchingRobotId) {
      this._leaveRoom(client);
    }

    // If this was the robot hardware, mark offline
    if (client.isRobot && client.robotId) {
      const activeRobotClient = this.robotClients.get(client.robotId);
      if (activeRobotClient !== client) {
        this.logger.debug(`Stale robot socket disconnected: ${client.robotId}`);
        return;
      }

      this.robotClients.delete(client.robotId);
      if (this.isShuttingDown) {
        this.logger.log(`Robot realtime socket closed during shutdown: ${client.robotId}`);
        return;
      }
      void this.clearTurnState(client.robotId);
      void this.queueService.clearQueue(client.robotId).catch(() => {});
      this.robotsService.updateStatus(client.robotId, 'OFFLINE').catch(() => {});
      this._broadcastToRoom(client.robotId, WS_EVENTS.ROBOT_STATUS, { status: 'OFFLINE' });
      this.logger.log(`Robot disconnected: ${client.robotId}`);
    }
  }

  // ─── Room management ────────────────────────────────────────────────────────

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() client: WsClient,
    @MessageBody()
    data: {
      robotId: string;
      accessToken?: string;
      guestSessionId?: string;
      roomAccessToken?: string;
    },
  ) {
    if (client.watchingRobotId) {
      this._leaveRoom(client);
    }

    const providedAccessToken = data.accessToken?.trim();
    const authPayload = this.resolveSocketUser(providedAccessToken);
    if (providedAccessToken && !authPayload) {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Invalid session token' } }));
      return;
    }

    client.watchingRobotId = data.robotId;
    const isGuest = !authPayload;
    client.isGuest = isGuest;

    if (isGuest) {
      const rawSessionId = data.guestSessionId?.trim().toLowerCase() ?? '';
      const safeSessionId = /^[a-z0-9_-]{6,64}$/.test(rawSessionId)
        ? rawSessionId
        : client.id.replace(/-/g, '').slice(0, 16);
      client.userId = `guest:${safeSessionId}`;
      client.username = `Guest-${safeSessionId.slice(0, 6)}`;
      client.role = undefined;
    } else {
      client.userId = authPayload.sub;
      client.username = authPayload.username || `User-${authPayload.sub.slice(0, 6)}`;
      client.role = authPayload.role;
    }

    const allowed = await this.robotsService.validateRoomAccess({
      robotId: data.robotId,
      actorId: client.userId,
      roomAccessToken: data.roomAccessToken,
    });
    if (!allowed) {
      client.watchingRobotId = undefined;
      client.userId = undefined;
      client.username = undefined;
      client.isGuest = undefined;
      client.role = undefined;
      client.send(JSON.stringify({ event: 'error', data: { message: 'Room access verification required' } }));
      return;
    }

    let pendingRestriction:
      | { event: string; data: unknown; action: string }
      | null = null;

    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(data.robotId, client.userId);
      if (restriction) {
        const action = typeof restriction.action === 'string' ? restriction.action : 'TIMEOUT';
        const event =
          action === 'BAN'
            ? WS_EVENTS.MOD_BAN
            : action === 'KICK'
              ? WS_EVENTS.MOD_KICK
              : WS_EVENTS.MOD_TIMEOUT;

        if (action === 'BAN') {
          client.watchingRobotId = undefined;
          client.userId = undefined;
          client.username = undefined;
          client.isGuest = undefined;
          client.role = undefined;
          client.send(JSON.stringify({ event, data: restriction }));
          return;
        }

        pendingRestriction = { event, data: restriction, action };
      }
    }

    if (!this.rooms.has(data.robotId)) this.rooms.set(data.robotId, new Set());
    this.rooms.get(data.robotId)!.add(client.id);

    if (!this.presence.has(data.robotId)) this.presence.set(data.robotId, new Map());
    this.presence.get(data.robotId)!.set(client.userId, {
      userId: client.userId,
      username: client.username,
      joinedAt: Date.now(),
    });

    this.robotsService
      .setViewerCount(data.robotId, this.rooms.get(data.robotId)?.size ?? 0)
      .catch(() => {});

    // Announce presence to room
    this._broadcastToRoom(data.robotId, WS_EVENTS.PRESENCE_JOIN, {
      userId: client.userId,
      username: client.username,
    }, client.id);

    // Send full presence snapshot to the joining client
    const presenceList = Array.from(this.presence.get(data.robotId)?.values() ?? []);
    client.send(JSON.stringify({ event: WS_EVENTS.PRESENCE_UPDATE, data: { viewers: presenceList } }));

    if (pendingRestriction) {
      client.send(JSON.stringify({ event: pendingRestriction.event, data: pendingRestriction.data }));
    }

    return { event: 'room:join', data: { ok: true, viewerCount: this.rooms.get(data.robotId)?.size ?? 0 } };
  }

  // ─── Robot authentication ───────────────────────────────────────────────────

  @SubscribeMessage(WS_EVENTS.ROBOT_CLAIM)
  async handleRobotClaim(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { claimToken: string },
  ) {
    try {
      const robot = await this.robotsService.findByClaimToken(data.claimToken);
      if (!robot) {
        client.send(JSON.stringify({ event: 'error', data: { message: 'Invalid claim token' } }));
        return;
      }

      const existingRobotClient = this._getOpenRobotClient(robot.id);
      if (existingRobotClient && existingRobotClient !== client) {
        this.logger.warn(`Rejected duplicate robot claim for ${robot.id}`);
        client.send(
          JSON.stringify({
            event: 'error',
            data: { message: 'Robot control channel is already connected' },
          }),
        );
        try {
          client.close(1008, 'Robot already connected');
        } catch {
          // Ignore close failures for rejected claims.
        }
        return;
      }

      client.isRobot = true;
      client.robotId = robot.id;
      client.claimToken = data.claimToken;
      client.watchingRobotId = robot.id;
      this.robotClients.set(robot.id, client);

      await this.robotsService.updateStatus(robot.id, 'ONLINE');
      const queue = await this.queueService.getQueue(robot.id);
      await this.syncTurnLifecycle(robot.id, queue);
      this._broadcastToRoomLocally(robot.id, WS_EVENTS.QUEUE_UPDATE, { queue });
      this._broadcastToRoom(robot.id, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
      this.logger.log(`Robot claimed: ${robot.name} (${robot.id})`);

      return { event: WS_EVENTS.ROBOT_CLAIM, data: { success: true, robotId: robot.id } };
    } catch (err) {
      this.logger.error('Robot claim error', err);
      return { event: 'error', data: { message: 'Claim failed' } };
    }
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_HEARTBEAT)
  handleHeartbeat(@ConnectedSocket() client: WsClient) {
    if (client.robotId) {
      this.redis.set(`robot:heartbeat:${client.robotId}`, Date.now().toString(), 'EX', 30);
      this.robotsService.touchHeartbeat(client.robotId).catch(() => {});
    }
    return { event: WS_EVENTS.ROBOT_HEARTBEAT, data: { ts: Date.now() } };
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_TELEMETRY)
  async handleTelemetry(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: Record<string, unknown>,
  ) {
    if (!client.isRobot || !client.claimToken) {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Only robot clients can send telemetry' } }));
      return;
    }
    try {
      await this.robotsService.ingestRobotTelemetry(client.claimToken, data);
    } catch (err) {
      this.logger.warn(`Telemetry ingest failed for robot ${client.robotId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('robot:actions:pull')
  async handleRobotActionsPull(@ConnectedSocket() client: WsClient) {
    if (!client.isRobot || !client.robotId) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Only robot clients can pull actions' } }),
      );
      return;
    }

    try {
      const payload = await this.robotsService.consumeActionsByRobotId(client.robotId);
      client.send(JSON.stringify({ event: 'robot:actions', data: payload }));
    } catch (err) {
      this.logger.error('Failed to pull robot actions', err);
    }
  }

  // ─── Control commands ───────────────────────────────────────────────────────

  @SubscribeMessage(WS_EVENTS.CONTROL_COMMAND)
  async handleControlCommand(
    @ConnectedSocket() client: WsClient,
    @MessageBody()
    data: { robotId: string; command: string; value?: unknown; timestamp: number },
  ) {
    const command = typeof data.command === 'string' ? data.command.trim() : '';
    if (!command) {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Invalid control command' } }));
      return;
    }

    if (client.watchingRobotId !== data.robotId) {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Join the room before sending controls' } }));
      return;
    }

    const robot = await this.robotsService.findById(data.robotId);

    const access = await this.robotsService.getAccessPolicy(data.robotId);
    if (access.control === 'DISABLED') {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Control is disabled for this robot' } }),
      );
      return;
    }
    if (access.control === 'AUTHENTICATED' && client.isGuest) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Please sign in to control this robot' } }),
      );
      return;
    }

    const currentControllerUserId =
      robot.queueMode === 'DISABLED'
        ? null
        : await this.queueService.getCurrentControllerUserId(data.robotId);
    const commandAccess = await this.authorizeControlCommand({
      robot,
      client,
      command,
      currentControllerUserId,
    });
    if (!commandAccess.allowed) {
      client.send(JSON.stringify({ event: 'error', data: { message: commandAccess.message } }));
      return;
    }

    if (!this.consumeControlCooldown(client, data.robotId, command, commandAccess.cooldownMs)) {
      return;
    }

    // Moderation check
    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(data.robotId, client.userId);
      if (restriction) {
        client.send(
          JSON.stringify({ event: 'error', data: { message: 'You are restricted in this room', restriction } }),
        );
        return;
      }
    }

    // Crowd input echo: broadcast to all viewers so they see button presses
    this._broadcastToRoom(
      data.robotId,
      WS_EVENTS.CROWD_INPUT,
      { userId: client.userId, username: client.username, command },
      client.id, // exclude sender
    );

    const robotClient = this._getOpenRobotClient(data.robotId);
    if (!robotClient) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Robot realtime control channel is offline' } }),
      );
      return;
    }

    // Forward command to the robot hardware (ultra-low-latency path)
    robotClient.send(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND,
        data: {
          command,
          value: data.value,
          metadata: this._buildCommandMetadata(client, data.robotId, robot.ownerId),
          userId: client.userId,
          // Use server timestamp for robot-side latency checks to avoid clock-skew false positives.
          timestamp: Date.now(),
          clientTimestamp: data.timestamp,
        },
      }),
    );

    // Browser timestamps are useful for diagnostics, but not reliable enough to gate realtime control.
    if (Number.isFinite(data.timestamp)) {
      const clientServerDeltaMs = Date.now() - data.timestamp;
      const withinExpectedRange =
        clientServerDeltaMs >= 0 &&
        clientServerDeltaMs <= LIMITS.MAX_CONTROL_CLOCK_SKEW_MS;

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

  private async authorizeControlCommand(input: {
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
        return {
          allowed: false,
          message: 'Wait for your turn in the queue before sending controls',
          cooldownMs: 0,
        };
      }

      return {
        allowed: true,
        message: '',
        cooldownMs: normalizedCommand === 'stop' ? 0 : LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
      };
    }

    if (normalizedCommand === 'stop') {
      if (queueDisabled || isCurrentController || this.isRoomModerator(client, robot.ownerId)) {
        return { allowed: true, message: '', cooldownMs: 0 };
      }

      return {
        allowed: false,
        message: 'Wait for your turn in the queue before sending controls',
        cooldownMs: 0,
      };
    }

    const matchingButtons = enabledButtons.filter((button) => button.command === normalizedCommand);
    if (matchingButtons.length === 0) {
      return { allowed: false, message: 'Unknown or disabled control', cooldownMs: 0 };
    }

    const allowedButtons = matchingButtons.filter((button) =>
      this.canUseConfiguredButton({
        buttonAccess: button.access,
        client,
        ownerId: robot.ownerId,
        isCurrentController,
        queueDisabled,
      }),
    );

    if (allowedButtons.length > 0) {
      return {
        allowed: true,
        message: '',
        cooldownMs: Math.max(
          0,
          Math.min(...allowedButtons.map((button) => Math.max(0, button.cooldownMs))),
        ),
      };
    }

    if (matchingButtons.some((button) => button.access === ControlButtonAccess.OWNER)) {
      return {
        allowed: false,
        message: 'This control is reserved for the robot owner',
        cooldownMs: 0,
      };
    }

    if (matchingButtons.some((button) => button.access === ControlButtonAccess.MODERATOR)) {
      return {
        allowed: false,
        message: 'This control is reserved for moderators',
        cooldownMs: 0,
      };
    }

    return {
      allowed: false,
      message: 'Wait for your turn in the queue before sending controls',
      cooldownMs: 0,
    };
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_EMERGENCY_STOP)
  async handleEmergencyStopMessage(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { robotId: string },
  ) {
    if (client.watchingRobotId !== data.robotId || !client.userId) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Join the room before using E-STOP' } }),
      );
      return;
    }

    try {
      const access = await this.robotsService.getAccessPolicy(data.robotId);
      if (access.estop === 'DISABLED') {
        client.send(JSON.stringify({ event: 'error', data: { message: 'E-STOP is disabled for this room' } }));
        return;
      }
      if (access.estop === 'AUTHENTICATED' && client.isGuest) {
        client.send(
          JSON.stringify({ event: 'error', data: { message: 'Please sign in to use E-STOP' } }),
        );
        return;
      }

      this._triggerEmergencyStop(data.robotId, `Manual E-STOP by ${client.userId}`);
    } catch {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Failed to validate E-STOP access' } }));
    }
  }

  // ─── Chat ───────────────────────────────────────────────────────────────────

  @SubscribeMessage(WS_EVENTS.CHAT_MESSAGE)
  async handleChatMessage(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { robotId: string; content: string },
  ) {
    if (client.watchingRobotId !== data.robotId) {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Join the room before chatting' } }));
      return;
    }

    const robot = await this.robotsService.findById(data.robotId);
    const access = await this.robotsService.getAccessPolicy(data.robotId);
    if (access.chat === 'DISABLED') {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Chat is disabled for this robot' } }),
      );
      return;
    }
    if (access.chat === 'AUTHENTICATED' && client.isGuest) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Please sign in to chat in this room' } }),
      );
      return;
    }

    if (!data.content?.trim() || data.content.length > LIMITS.MAX_CHAT_MESSAGE_LENGTH) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: `Chat messages must be 1-${LIMITS.MAX_CHAT_MESSAGE_LENGTH} chars` } }),
      );
      return;
    }

    const { sanitized, hasIllegalChars } = this.moderationService.sanitizeChatContent(data.content);
    if (!sanitized) {
      return;
    }
    if (hasIllegalChars) {
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Message contains invalid characters' } }),
      );
      return;
    }

    if (this.moderationService.containsForbiddenSymbols(sanitized)) {
      if (client.userId) {
        this.moderationService
          .recordProfanityEvent({
            robotId: data.robotId,
            userId: client.userId,
            username: client.username ?? 'unknown',
            content: sanitized,
          })
          .catch(() => {});
      }
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Message blocked by moderation filter' } }),
      );
      return;
    }

    if (this.moderationService.containsProfanity(sanitized)) {
      if (client.userId) {
        this.moderationService
          .recordProfanityEvent({
            robotId: data.robotId,
            userId: client.userId,
            username: client.username ?? 'unknown',
            content: sanitized,
          })
          .catch(() => {});
      }
      client.send(
        JSON.stringify({ event: 'error', data: { message: 'Message blocked by profanity filter' } }),
      );
      return;
    }

    // Chat rate limiting
    const now = Date.now();
    const rateMs =
      client.role === 'ADMIN' || client.role === 'MOD' || client.role === 'MODERATOR'
        ? LIMITS.CHAT_RATE_LIMIT_ADMIN_MS
        : LIMITS.CHAT_RATE_LIMIT_MS;
    if (client.lastChatAt && now - client.lastChatAt < rateMs) return;
    client.lastChatAt = now;

    // Moderation check
    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(data.robotId, client.userId);
      if (restriction) {
        client.send(
          JSON.stringify({ event: 'error', data: { message: 'You are restricted in this room', restriction } }),
        );
        return;
      }
    }

    const isRobotOwner = Boolean(client.userId) && client.userId === robot.ownerId;
    const isSiteAdmin = client.role === 'ADMIN';
    const isSiteModerator = client.role === 'MOD' || client.role === 'MODERATOR';

    this._broadcastToRoom(data.robotId, WS_EVENTS.CHAT_MESSAGE, {
      userId: client.userId,
      username: client.username,
      content: sanitized,
      timestamp: now,
    });

    // Forward chat to the robot client so it can drive TTS
    const robotClient = this._getOpenRobotClient(data.robotId);
    if (robotClient) {
      robotClient.send(
        JSON.stringify({
          event: WS_EVENTS.CONTROL_COMMAND,
          data: {
            command: 'chat',
            value: {
              message: sanitized,
              sender: client.username,
              anonymous: client.isGuest,
              user: {
                id: client.userId ?? null,
                username: client.username ?? null,
                role: client.role ?? null,
                isGuest: Boolean(client.isGuest),
                isRobotOwner,
                isSiteAdmin,
                isSiteModerator,
              },
              robotId: data.robotId,
            },
            metadata: this._buildCommandMetadata(client, data.robotId, robot.ownerId),
            timestamp: now,
          },
        }),
      );
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _triggerEmergencyStop(robotId: string, reason: string) {
    const robotClient = this._getOpenRobotClient(robotId);
    if (robotClient) {
      robotClient.send(
        JSON.stringify({ event: WS_EVENTS.CONTROL_EMERGENCY_STOP, data: { reason, timestamp: Date.now() } }),
      );
    }
    this._broadcastToRoom(robotId, WS_EVENTS.CONTROL_EMERGENCY_STOP, { reason });
    this.logger.warn(`EMERGENCY STOP: Robot ${robotId} – ${reason}`);
  }

  private _sendRobotStop(robotId: string, reason: string) {
    const robotClient = this._getOpenRobotClient(robotId);
    if (!robotClient) {
      return;
    }

    robotClient.send(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND,
        data: {
          command: 'stop',
          value: { reason },
          metadata: {
            user: {
              id: null,
              username: 'system',
              role: 'SYSTEM',
              isGuest: false,
              isRobotOwner: false,
              isSiteAdmin: false,
              isSiteModerator: false,
            },
            robotId,
            source: 'system',
          } satisfies CommandMetadata,
          timestamp: Date.now(),
        },
      }),
    );
  }

  /**
   * Broadcast a message to all sockets in a robot room.
   * @param excludeClientId – skip this client (e.g. the sender)
   */
  private _broadcastToRoom(
    robotId: string,
    event: string,
    data: unknown,
    excludeClientId?: string,
  ) {
    const message = JSON.stringify({ event, data });
    const room = this.rooms.get(robotId);
    if (room) {
      for (const clientId of room) {
        if (clientId === excludeClientId) continue;
        const ws = this.clients.get(clientId);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
    // Also publish to Redis for horizontal scaling
    this.redis.publish(
      `ws:room:${robotId}`,
      JSON.stringify({ originId: this.instanceId, event, data }),
    ).catch(() => {});
  }

  private _leaveRoom(client: WsClient) {
    const robotId = client.watchingRobotId!;
    const room = this.rooms.get(robotId);
    room?.delete(client.id);
    if (room && room.size === 0) {
      this.rooms.delete(robotId);
    }

    if (client.userId) {
      const presence = this.presence.get(robotId);
      presence?.delete(client.userId);
      if (presence && presence.size === 0) {
        this.presence.delete(robotId);
      }
      this._broadcastToRoom(robotId, WS_EVENTS.PRESENCE_LEAVE, {
        userId: client.userId,
        username: client.username,
      });
    }

    this.robotsService
      .setViewerCount(robotId, this.rooms.get(robotId)?.size ?? 0)
      .catch(() => {});

    client.watchingRobotId = undefined;
  }

  private _getOpenRobotClient(robotId: string): WsClient | undefined {
    const robotClient = this.robotClients.get(robotId);
    if (!robotClient) {
      return undefined;
    }

    if (robotClient.readyState !== WebSocket.OPEN) {
      this.robotClients.delete(robotId);
      this.logger.warn(`Robot channel for ${robotId} exists but is not open`);
      return undefined;
    }

    return robotClient;
  }

  private async handleRedisMessage(channel: string, message: string) {
    if (channel.startsWith('queue:')) {
      const robotId = channel.slice('queue:'.length);
      if (!robotId) {
        return;
      }

      try {
        const queue = await this.queueService.getQueue(robotId);
        await this.syncTurnLifecycle(robotId, queue);
        this._broadcastToRoomLocally(robotId, WS_EVENTS.QUEUE_UPDATE, { queue });
      } catch (err) {
        this.logger.warn(`Failed to broadcast queue update for ${robotId}: ${(err as Error).message}`);
      }
      return;
    }

    if (channel.startsWith('ws:moderation:')) {
      const robotId = channel.slice('ws:moderation:'.length);
      if (!robotId) {
        return;
      }

      try {
        const payload = JSON.parse(message) as { event?: string; data?: unknown };
        if (!payload.event) {
          return;
        }
        await this.enforceModerationEvent(robotId, payload);
        this._broadcastToRoomLocally(robotId, payload.event, payload.data ?? {});
      } catch (err) {
        this.logger.warn(`Failed to process moderation event for ${robotId}: ${(err as Error).message}`);
      }
      return;
    }

    if (channel.startsWith('ws:room:')) {
      const robotId = channel.slice('ws:room:'.length);
      if (!robotId) {
        return;
      }

      try {
        const payload = JSON.parse(message) as { originId?: string; event?: string; data?: unknown };
        if (!payload.event) {
          return;
        }
        if (payload.originId === this.instanceId) {
          return;
        }
        this._broadcastToRoomLocally(robotId, payload.event, payload.data ?? {});
      } catch (err) {
        this.logger.warn(`Failed to relay room event for ${robotId}: ${(err as Error).message}`);
      }
    }

    if (channel.startsWith('ws:system:')) {
      try {
        const payload = JSON.parse(message) as { event?: string; data?: unknown };
        if (!payload.event) {
          return;
        }

        const data =
          payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
            ? payload.data
            : {};
        const systemMessage = JSON.stringify({ event: payload.event, data });

        for (const client of this.clients.values()) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(systemMessage);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to relay system event: ${(err as Error).message}`);
      }
    }
  }

  private _broadcastToRoomLocally(
    robotId: string,
    event: string,
    data: unknown,
    excludeClientId?: string,
  ) {
    const message = JSON.stringify({ event, data });
    const room = this.rooms.get(robotId);
    if (!room) {
      return;
    }

    for (const clientId of room) {
      if (clientId === excludeClientId) continue;
      const ws = this.clients.get(clientId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  private async syncTurnLifecycle(
    robotId: string,
    queue: Array<{ userId: string; user?: { username?: string; displayName?: string | null } }>,
  ) {
    const current = this.activeTurns.get(robotId) ?? null;
    const nextEntry = queue[0] ?? null;
    const robot = await this.robotsService.findById(robotId);
    const robotRealtimeOnline = this.robotClients.has(robotId);

    if (robot.queueMode === 'DISABLED') {
      if (current) {
        await this.clearTurnState(robotId, 'clear');
      }
      return;
    }

    if (!robotRealtimeOnline || robot.status === 'MAINTENANCE') {
      if (current) {
        await this.clearTurnState(robotId, 'clear');
      }
      return;
    }

    if (!nextEntry) {
      if (current) {
        await this.clearTurnState(robotId, 'clear');
      }
      await this.robotsService.updateStatus(robotId, 'ONLINE').catch(() => {});
      this._broadcastToRoomLocally(robotId, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
      return;
    }

    if (current && current.userId === nextEntry.userId) {
      return;
    }

    if (current) {
      await this.clearTurnState(robotId);
    }

    const session = await this.sessionsService.create(robotId, nextEntry.userId);
    const expiresAt = Date.now() + robot.maxTurnTime;
    this.activeTurns.set(robotId, {
      sessionId: session.id,
      userId: nextEntry.userId,
      startedAt: Date.now(),
      expiresAt,
    });

    await this.robotsService.updateStatus(robotId, 'BUSY').catch(() => {});
    this._broadcastToRoomLocally(robotId, WS_EVENTS.ROBOT_STATUS, { status: 'BUSY' });
    this._broadcastToRoomLocally(robotId, WS_EVENTS.SESSION_START, {
      sessionId: session.id,
      userId: nextEntry.userId,
      expiresAt,
    });
    this._broadcastToRoomLocally(robotId, WS_EVENTS.QUEUE_TURN_START, {
      userId: nextEntry.userId,
      username: nextEntry.user?.displayName ?? nextEntry.user?.username ?? nextEntry.userId,
      expiresAt,
      durationMs: robot.maxTurnTime,
    });

    const existingTimer = this.turnTimeouts.get(robotId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.handleTurnTimeout(robotId, nextEntry.userId);
    }, robot.maxTurnTime);
    this.turnTimeouts.set(robotId, timer);
  }

  private async handleTurnTimeout(robotId: string, userId: string) {
    await this.clearTurnState(robotId, 'timeout');
    await this.queueService.leave(robotId, userId).catch(() => {});
  }

  private async clearTurnState(robotId: string, reason: 'handoff' | 'timeout' | 'clear' = 'handoff') {
    const current = this.activeTurns.get(robotId);
    if (current) {
      this._sendRobotStop(robotId, `Turn ended: ${reason}`);
      await this.sessionsService.end(current.sessionId).catch(() => {});
      this._broadcastToRoomLocally(robotId, WS_EVENTS.SESSION_END, {
        sessionId: current.sessionId,
        userId: current.userId,
      });
      this._broadcastToRoomLocally(robotId, WS_EVENTS.QUEUE_TURN_END, {
        userId: current.userId,
        reason,
      });
      this.activeTurns.delete(robotId);
    }

    const timer = this.turnTimeouts.get(robotId);
    if (timer) {
      clearTimeout(timer);
      this.turnTimeouts.delete(robotId);
    }
  }

  private async enforceModerationEvent(
    robotId: string,
    payload: { event?: string; data?: unknown },
  ) {
    const event = payload.event;
    if (
      event !== WS_EVENTS.MOD_TIMEOUT &&
      event !== WS_EVENTS.MOD_KICK &&
      event !== WS_EVENTS.MOD_BAN
    ) {
      return;
    }

    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : null;
    const targetUserId = typeof data?.userId === 'string' ? data.userId : null;
    if (!targetUserId) {
      return;
    }

    const activeTurn = this.activeTurns.get(robotId);
    if (activeTurn?.userId === targetUserId) {
      await this.clearTurnState(robotId, 'clear');
    }

    await this.queueService.leave(robotId, targetUserId).catch(() => {});

    if (event === WS_EVENTS.MOD_BAN) {
      this.disconnectUserFromRoom(robotId, targetUserId);
    }
  }

  private disconnectUserFromRoom(robotId: string, targetUserId: string) {
    for (const client of this.clients.values()) {
      if (client.isRobot) {
        continue;
      }
      if (client.watchingRobotId !== robotId || client.userId !== targetUserId) {
        continue;
      }

      this._leaveRoom(client);
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
  }

  private resolveSocketUser(accessToken?: string): JwtPayload | null {
    const token = accessToken?.trim();
    if (!token) {
      return null;
    }

    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      return null;
    }
  }

  private canUseConfiguredButton(input: {
    buttonAccess: ControlButtonAccess;
    client: WsClient;
    ownerId: string | null;
    isCurrentController: boolean;
    queueDisabled: boolean;
  }): boolean {
    const { buttonAccess, client, ownerId, isCurrentController, queueDisabled } = input;

    if (buttonAccess === ControlButtonAccess.EVERYONE) {
      return true;
    }

    if (buttonAccess === ControlButtonAccess.QUEUE_TURN) {
      return queueDisabled || isCurrentController;
    }

    if (buttonAccess === ControlButtonAccess.MODERATOR) {
      return this.isRoomModerator(client, ownerId);
    }

    return Boolean(ownerId && client.userId && client.userId === ownerId);
  }

  private isRoomModerator(client: WsClient, ownerId?: string | null): boolean {
    return Boolean(
      (ownerId && client.userId && client.userId === ownerId) ||
      client.role === 'ADMIN' ||
      client.role === 'MOD' ||
      client.role === 'MODERATOR',
    );
  }

  private consumeControlCooldown(
    client: WsClient,
    robotId: string,
    command: string,
    cooldownMs: number,
  ): boolean {
    if (cooldownMs <= 0) {
      return true;
    }

    const actorKey = client.userId ?? client.id;
    const normalizedCommand = command.trim().toLowerCase();
    if (!actorKey || !normalizedCommand) {
      return true;
    }

    const key = `${actorKey}:${robotId}:${normalizedCommand}`;
    const now = Date.now();
    const nextAllowedAt = this.controlCooldowns.get(key) ?? 0;
    if (nextAllowedAt > now) {
      return false;
    }

    if (this.controlCooldowns.size > 4096) {
      for (const [entryKey, expiresAt] of this.controlCooldowns.entries()) {
        if (expiresAt <= now) {
          this.controlCooldowns.delete(entryKey);
        }
      }
    }

    this.controlCooldowns.set(key, now + cooldownMs);
    return true;
  }

  private _buildCommandMetadata(client: WsClient, robotId: string, ownerId?: string | null): CommandMetadata {
    const isRobotOwner = Boolean(ownerId) && Boolean(client.userId) && client.userId === ownerId;
    const isSiteAdmin = client.role === 'ADMIN';
    const isSiteModerator = client.role === 'MOD' || client.role === 'MODERATOR';
    return {
      user: {
        id: client.userId ?? null,
        username: client.username ?? null,
        role: client.role ?? null,
        isGuest: Boolean(client.isGuest),
        isRobotOwner,
        isSiteAdmin,
        isSiteModerator,
      },
      robotId,
      source: 'gateway',
    };
  }

}
