import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { WS_EVENTS, LIMITS } from '@botparty/shared';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';

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

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
  },
})
export class BotGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BotGateway.name);

  /** All connected sockets: clientId → WsClient */
  private readonly clients = new Map<string, WsClient>();

  /** robotId → hardware WsClient */
  private readonly robotClients = new Map<string, WsClient>();

  /** robotId → Set of viewer/controller clientIds */
  private readonly rooms = new Map<string, Set<string>>();

  /** robotId → Map<userId, PresenceRecord> */
  private readonly presence = new Map<string, Map<string, PresenceRecord>>();

  constructor(
    private readonly robotsService: RobotsService,
    private readonly sessionsService: SessionsService,
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
    private readonly moderationService: ModerationService,
  ) {}

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
      this.robotsService.updateStatus(client.robotId, 'OFFLINE').catch(() => {});
      this._broadcastToRoom(client.robotId, WS_EVENTS.ROBOT_STATUS, { status: 'OFFLINE' });
      this.logger.log(`Robot disconnected: ${client.robotId}`);
    }
  }

  // ─── Room management ────────────────────────────────────────────────────────

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { robotId: string; userId?: string; username?: string },
  ) {
    if (client.watchingRobotId) {
      this._leaveRoom(client);
    }

    client.watchingRobotId = data.robotId;
    client.isGuest = !data.userId;
    client.userId = data.userId?.trim() || `guest:${client.id}`;
    client.username = data.username?.trim() || `Guest-${client.id.slice(0, 4)}`;

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
    }
    return { event: WS_EVENTS.ROBOT_HEARTBEAT, data: { ts: Date.now() } };
  }

  // ─── Control commands ───────────────────────────────────────────────────────

  @SubscribeMessage(WS_EVENTS.CONTROL_COMMAND)
  async handleControlCommand(
    @ConnectedSocket() client: WsClient,
    @MessageBody()
    data: { robotId: string; command: string; value?: unknown; timestamp: number },
  ) {
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
    if (client.userId && !client.isGuest) {
      const restriction = await this.moderationService.getActiveRestriction(
        data.robotId,
        client.userId,
      );
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
        JSON.stringify({ event: 'error', data: { message: 'Robot is not connected' } }),
      );
      return;
    }

    // Forward command to the robot hardware (ultra-low-latency path)
    robotClient.send(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND,
        data: { command: data.command, value: data.value, userId: client.userId, timestamp: data.timestamp },
      }),
    );

    // Latency guard
    const latency = Date.now() - data.timestamp;
    if (latency > LIMITS.LATENCY_EMERGENCY_STOP_MS) {
      this._triggerEmergencyStop(data.robotId, `High latency: ${latency}ms`);
    } else if (latency > LIMITS.LATENCY_WARNING_MS) {
      client.send(
        JSON.stringify({ event: WS_EVENTS.CONTROL_LATENCY_WARNING, data: { latencyMs: latency } }),
      );
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
    const access = await this.robotsService.getAccessPolicy(data.robotId);
    if (access.chat === 'DISABLED') {
      return;
    }
    if (access.chat === 'AUTHENTICATED' && client.isGuest) {
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
    const restriction = await this.moderationService.getActiveRestriction(data.robotId, client.userId ?? '');
    if (restriction) return; // silently drop – client already notified via control event

    this._broadcastToRoom(data.robotId, WS_EVENTS.CHAT_MESSAGE, {
      userId: client.userId,
      username: client.username,
      content: sanitized,
      timestamp: now,
    });
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
    this.rooms.get(robotId)?.delete(client.id);

    if (client.userId) {
      this.presence.get(robotId)?.delete(client.userId);
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
}

