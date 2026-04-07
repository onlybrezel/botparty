import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, WebSocket } from 'ws';
import { WS_EVENTS, LIMITS } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';
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
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BotGateway.name);
  private subscriber: Redis | null = null;

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

  constructor(
    private readonly robotsService: RobotsService,
    private readonly sessionsService: SessionsService,
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
    private readonly moderationService: ModerationService,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit() {
    this.subscriber = this.redis.duplicate();

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      void this.handleRedisMessage(channel, message);
    });

    await this.subscriber.psubscribe('queue:*', 'ws:moderation:*');
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
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
      this.robotClients.delete(client.robotId);
      void this.clearTurnState(client.robotId);
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

      client.isRobot = true;
      client.robotId = robot.id;
      client.claimToken = data.claimToken;
      client.watchingRobotId = robot.id;
      this.robotClients.set(robot.id, client);

      await this.robotsService.updateStatus(robot.id, 'ONLINE');
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
    if (client.watchingRobotId !== data.robotId) {
      client.send(JSON.stringify({ event: 'error', data: { message: 'Join the room before sending controls' } }));
      return;
    }

    const robot = await this.robotsService.findById(data.robotId);

    if (robot.queueMode !== 'DISABLED') {
      if (!client.userId || client.isGuest) {
        client.send(
          JSON.stringify({ event: 'error', data: { message: 'Please sign in and join the queue to control this robot' } }),
        );
        return;
      }

      const currentControllerUserId = await this.queueService.getCurrentControllerUserId(data.robotId);
      if (!currentControllerUserId || currentControllerUserId !== client.userId) {
        client.send(
          JSON.stringify({ event: 'error', data: { message: 'Wait for your turn in the queue before sending controls' } }),
        );
        return;
      }
    }

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
      { userId: client.userId, username: client.username, command: data.command },
      client.id, // exclude sender
    );

    const robotClient = this.robotClients.get(data.robotId);
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
          command: data.command,
          value: data.value,
          metadata: this._buildCommandMetadata(client, data.robotId),
          userId: client.userId,
          // Use server timestamp for robot-side latency checks to avoid clock-skew false positives.
          timestamp: Date.now(),
          clientTimestamp: data.timestamp,
        },
      }),
    );

    // Non-fatal advisory only: browser and server clocks can differ, so never E-STOP from this metric.
    if (Number.isFinite(data.timestamp)) {
      const clientServerDeltaMs = Date.now() - data.timestamp;
      if (Math.abs(clientServerDeltaMs) > LIMITS.LATENCY_WARNING_MS) {
        client.send(
          JSON.stringify({
            event: WS_EVENTS.CONTROL_LATENCY_WARNING,
            data: { latencyMs: Math.max(0, clientServerDeltaMs) },
          }),
        );
      }
    }
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_EMERGENCY_STOP)
  handleEmergencyStopMessage(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { robotId: string },
  ) {
    this.robotsService
      .getAccessPolicy(data.robotId)
      .then((access) => {
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

        this._triggerEmergencyStop(data.robotId, `Manual E-STOP by ${client.userId ?? 'anonymous'}`);
      })
      .catch(() => {
        client.send(JSON.stringify({ event: 'error', data: { message: 'Failed to validate E-STOP access' } }));
      });
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

    this._broadcastToRoom(data.robotId, WS_EVENTS.CHAT_MESSAGE, {
      userId: client.userId,
      username: client.username,
      content: sanitized,
      timestamp: now,
    });

    // Forward chat to the robot client so it can drive TTS
    const robotClient = this.robotClients.get(data.robotId);
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
              },
              robotId: data.robotId,
            },
            metadata: this._buildCommandMetadata(client, data.robotId),
            timestamp: now,
          },
        }),
      );
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _triggerEmergencyStop(robotId: string, reason: string) {
    const robotClient = this.robotClients.get(robotId);
    if (robotClient) {
      robotClient.send(
        JSON.stringify({ event: WS_EVENTS.CONTROL_EMERGENCY_STOP, data: { reason, timestamp: Date.now() } }),
      );
    }
    this._broadcastToRoom(robotId, WS_EVENTS.CONTROL_EMERGENCY_STOP, { reason });
    this.logger.warn(`EMERGENCY STOP: Robot ${robotId} – ${reason}`);
  }

  private _sendRobotStop(robotId: string, reason: string) {
    const robotClient = this.robotClients.get(robotId);
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
    this.redis.publish(`ws:room:${robotId}`, message).catch(() => {});
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

    if (!robotRealtimeOnline || robot.status === 'OFFLINE' || robot.status === 'MAINTENANCE') {
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

  private _buildCommandMetadata(client: WsClient, robotId: string): CommandMetadata {
    return {
      user: {
        id: client.userId ?? null,
        username: client.username ?? null,
        role: client.role ?? null,
        isGuest: Boolean(client.isGuest),
      },
      robotId,
      source: 'gateway',
    };
  }
}
