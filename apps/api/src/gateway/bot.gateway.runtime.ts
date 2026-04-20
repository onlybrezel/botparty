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
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, WebSocket } from 'ws';
import {
  WS_EVENTS,
  WS_PROTOCOL_VERSION,
  WS_MIN_SUPPORTED_PROTOCOL_VERSION,
  LIMITS,
  ControlButtonAccess,
  chatMessageSchema,
  controlCommandSchema,
} from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';
import { ControlsService } from '../controls/controls.service';
import { AuthService } from '../auth/auth.service';
import { getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import { isStaffRole } from '../common/robot-access';
import type { ActiveTurnState, CommandMetadata, SharedPresenceSnapshot, WsClient } from './gateway-types';
import { PresenceHandler } from './presence.handler';
import { RobotClaimLockHandler } from './robot-claim-lock.handler';
import { TurnHandler } from './turn.handler';
import { ModerationEnforcerHandler } from './moderation-enforcer.handler';
import { ChatHandler } from './chat.handler';
import { ControlHandler } from './control.handler';
import { GuestSocketHandler } from './guest-socket.handler';
import { RedisPubSubHandler } from './redis-pubsub.handler';
import { ActiveTurnStore } from './active-turn.store';
import { z, type ZodTypeAny } from 'zod';

const roomJoinSchema = z.object({
  robotId: z.string().uuid(),
  accessToken: z.string().min(1).optional(),
  protocolVersion: z.number().int().min(WS_MIN_SUPPORTED_PROTOCOL_VERSION).max(1024).default(WS_MIN_SUPPORTED_PROTOCOL_VERSION),
  guestSessionId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/).optional(),
  roomAccessToken: z.string().min(1).max(1024).optional(),
}).strict();

const roomPingSchema = z.object({
  robotId: z.string().uuid(),
}).strict();

const robotClaimSchema = z.object({
  robotAuthToken: z.string().min(1),
  protocolVersion: z.number().int().min(WS_MIN_SUPPORTED_PROTOCOL_VERSION).max(1024).default(WS_MIN_SUPPORTED_PROTOCOL_VERSION),
}).strict();

const robotTelemetrySchema = z.object({
  clientVersion: z.string().max(64).optional(),
  gitBranch: z.string().max(128).optional(),
  gitCommit: z.string().max(64).optional(),
  gitDirty: z.boolean().optional(),
  botpartyStreamerVersion: z.string().max(64).optional(),
  streamerVersion: z.string().max(64).optional(),
  pythonVersion: z.string().max(64).optional(),
  cpuPercent: z.number().finite().optional(),
  memoryPercent: z.number().finite().optional(),
  temperatureC: z.number().finite().optional(),
  uptimeSec: z.number().finite().optional(),
  controlConnected: z.boolean().optional(),
  livekitConnected: z.boolean().optional(),
  commandsReceived: z.number().finite().optional(),
  cameraFrames: z.number().finite().optional(),
}).strict();

const emergencyStopSchema = z.object({
  robotId: z.string().uuid(),
}).strict();

const emptyPayloadSchema = z.undefined().or(z.object({}).strict());

const WS_EVENT_TYPE_LIMITS: Record<string, { normal: number; privileged: number }> = {
  generic: { normal: LIMITS.WS_EVENT_RATE_LIMIT, privileged: LIMITS.WS_EVENT_RATE_LIMIT_ADMIN },
  'room:join': { normal: 5, privileged: 10 },
  'room:ping': { normal: 8, privileged: 16 },
  'robot:claim': { normal: 2, privileged: 4 },
  'robot:heartbeat': { normal: 6, privileged: 12 },
  'robot:telemetry': { normal: 4, privileged: 8 },
  [WS_EVENTS.ROBOT_ACTIONS_PULL]: { normal: 4, privileged: 8 },
  control: { normal: 30, privileged: 45 },
  estop: { normal: 4, privileged: 8 },
  chat: { normal: 6, privileged: 12 },
};
const WS_AUTH_REVALIDATE_INTERVAL_MS = 120_000;

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
  private readonly instanceId = crypto.randomUUID();
  private isShuttingDown = false;

  /** All connected sockets: clientId → WsClient */
  private readonly clients = new Map<string, WsClient>();

  /** robotId → hardware WsClient */
  private readonly robotClients = new Map<string, WsClient>();

  /** robotId → Set of viewer/controller clientIds */
  private readonly rooms = new Map<string, Set<string>>();

  private readonly activeTurns: ActiveTurnStore;
  private readonly turnTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly controlCooldownFallbacks = new Map<string, number>();
  private readonly allowedWsOrigins: Set<string>;
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  private _controlCooldownFallbackCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private _authRevalidationInterval: ReturnType<typeof setInterval> | null = null;
  private _authRevalidationInFlight = false;
  private _controlCooldownRedisFallbackActive = false;

  // Sub-handlers (initialized in constructor)
  private readonly presence: PresenceHandler;
  private readonly claimLock: RobotClaimLockHandler;
  private readonly turnHandler: TurnHandler;
  private readonly moderationEnforcer: ModerationEnforcerHandler;
  private readonly chatHandler: ChatHandler;
  private readonly controlHandler: ControlHandler;
  private readonly guestSockets: GuestSocketHandler;
  private readonly redisPubSub: RedisPubSubHandler;

  constructor(
    private readonly robotsService: RobotsService,
    private readonly sessionsService: SessionsService,
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
    private readonly moderationService: ModerationService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly controlsService: ControlsService,
    private readonly configService: ConfigService,
  ) {
    this.allowedWsOrigins = new Set(
      (this.configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    );

    const instanceId = this.instanceId;
    this.presence = new PresenceHandler(redis, instanceId);
    this.claimLock = new RobotClaimLockHandler(redis);
    this.activeTurns = new ActiveTurnStore(redis);
    this.turnHandler = new TurnHandler(
      {
        robotClients: this.robotClients,
        getActiveTurn: (robotId) => this.activeTurns.get(robotId),
        hasLocalActiveTurn: (robotId) => this.activeTurns.hasLocal(robotId),
        rememberActiveTurn: (robotId, state) => this.activeTurns.remember(robotId, state),
        setActiveTurn: (robotId, state) => this.activeTurns.set(robotId, state),
        clearActiveTurn: (robotId) => this.activeTurns.clear(robotId),
        getTurnTimeout: (robotId) => this.turnTimeouts.get(robotId),
        setTurnTimeout: (robotId, timer) => this.turnTimeouts.set(robotId, timer),
        clearTurnTimeout: (robotId) => {
          const timer = this.turnTimeouts.get(robotId);
          if (timer) {
            clearTimeout(timer);
            this.turnTimeouts.delete(robotId);
          }
        },
        broadcastToRoom: (robotId, event, data, excludeClientId) =>
          this._broadcastToRoom(robotId, event, data, excludeClientId),
        sendRobotStop: (robotId, reason) => this._sendRobotStop(robotId, reason),
      },
      robotsService,
      sessionsService,
      queueService,
    );
    this.moderationEnforcer = new ModerationEnforcerHandler(
      {
        clients: this.clients,
        getActiveTurn: (robotId) => this.activeTurns.get(robotId),
        clearTurnState: (robotId, reason) => this.clearTurnState(robotId, reason),
        leaveRoom: (client) => this._leaveRoom(client),
      },
      queueService,
    );
    const handlerCtx = {
      broadcastToRoom: (robotId: string, event: string, data: unknown, excludeClientId?: string) =>
        this._broadcastToRoom(robotId, event, data, excludeClientId),
      getOpenRobotClient: (robotId: string) => this._getOpenRobotClient(robotId),
      buildCommandMetadata: (client: WsClient, robotId: string, ownerId?: string | null) =>
        this._buildCommandMetadata(client, robotId, ownerId),
      consumeControlCooldown: async (client: WsClient, robotId: string, command: string, cooldownMs: number) =>
        this.consumeControlCooldown(client, robotId, command, cooldownMs),
      isRoomModerator: (client: WsClient, ownerId?: string | null) =>
        this.isRoomModerator(client, ownerId),
    };
    this.chatHandler = new ChatHandler(handlerCtx, robotsService, moderationService);
    this.controlHandler = new ControlHandler(handlerCtx, robotsService, moderationService, queueService, controlsService);
    this.guestSockets = new GuestSocketHandler();
    this.redisPubSub = new RedisPubSubHandler(redis, queueService, {
      instanceId,
      hasOpenRobotClient: (robotId) => Boolean(this._getOpenRobotClient(robotId)),
      hasLocalActiveTurn: (robotId) => this.activeTurns.hasLocal(robotId),
      syncTurnLifecycle: (robotId, queue) => this.syncTurnLifecycle(robotId, queue),
      clearTurnState: (robotId, reason) => this.clearTurnState(robotId, reason),
      broadcastToRoomLocally: (robotId, event, data, excludeClientId) =>
        this._broadcastToRoomLocally(robotId, event, data, excludeClientId),
      enforceModerationEvent: (robotId, payload) => this.enforceModerationEvent(robotId, payload),
      buildModerationSystemMessage: (event, data) => this.buildModerationSystemMessage(event, data),
      broadcastSystemLocally: (event, data) => this._broadcastSystemLocally(event, data),
    });
  }

  async onModuleInit() {
    // Reconcile any sessions left ACTIVE from a previous crash
    await this.sessionsService.endAllActiveSessions().catch((err: unknown) => {
      this.logger.warn('Failed to reconcile orphaned sessions on startup', err);
    });

    await this.redisPubSub.start();

    // Server-side heartbeat: ping all open clients every 30 s to detect dead connections
    this._pingInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.ping(); } catch { /* ignore */ }
        }
      }
    }, 30_000);

    this._controlCooldownFallbackCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this.controlCooldownFallbacks.entries()) {
        if (expiresAt <= now) {
          this.controlCooldownFallbacks.delete(key);
        }
      }
    }, 60_000);

    this._authRevalidationInterval = setInterval(() => {
      void this._revalidateAuthenticatedSockets();
    }, WS_AUTH_REVALIDATE_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this._controlCooldownFallbackCleanupInterval) {
      clearInterval(this._controlCooldownFallbackCleanupInterval);
      this._controlCooldownFallbackCleanupInterval = null;
    }
    if (this._authRevalidationInterval) {
      clearInterval(this._authRevalidationInterval);
      this._authRevalidationInterval = null;
    }
    await this.redisPubSub.stop();
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

  private _checkEventRateLimit(client: WsClient, eventType = 'generic'): boolean {
    const now = Date.now();
    if (!client.wsEventWindowStart || now - client.wsEventWindowStart > LIMITS.WS_EVENT_RATE_WINDOW_MS) {
      client.wsEventWindowStart = now;
      client.wsEventCount = 1;
      client.wsEventTypeCounts = { [eventType]: 1 };
      return true;
    }

    client.wsEventCount = (client.wsEventCount ?? 0) + 1;
    client.wsEventTypeCounts = client.wsEventTypeCounts ?? {};
    client.wsEventTypeCounts[eventType] = (client.wsEventTypeCounts[eventType] ?? 0) + 1;
    const isPrivileged = client.isRobot || isStaffRole(client.role);
    const globalLimit = isPrivileged ? LIMITS.WS_EVENT_RATE_LIMIT_ADMIN : LIMITS.WS_EVENT_RATE_LIMIT;
    const bucket = WS_EVENT_TYPE_LIMITS[eventType] ?? WS_EVENT_TYPE_LIMITS.generic!;
    const bucketLimit = isPrivileged ? bucket.privileged : bucket.normal;
    return client.wsEventCount <= globalLimit && client.wsEventTypeCounts[eventType] <= bucketLimit;
  }

  handleConnection(
    client: WsClient,
    request?: {
      headers?: { cookie?: string; 'x-forwarded-for'?: string; origin?: string };
      socket?: { remoteAddress?: string };
    },
  ) {
    const origin = request?.headers?.origin?.trim();
    if (origin && this.allowedWsOrigins.size > 0 && !this.allowedWsOrigins.has(origin)) {
      this.logger.warn(`Rejected websocket connection from disallowed origin: ${origin}`);
      try {
        client.close(1008, 'Origin not allowed');
      } catch {
        // Ignore close failures for rejected sockets.
      }
      return;
    }

    client.id = crypto.randomUUID();
    client.cookieHeader = request?.headers?.cookie;
    client.remoteIp = this.resolveClientIp(request);
    this.clients.set(client.id, client);
    this.logger.debug(`Client connected: ${client.id}`);
  }

  private async _revalidateAuthenticatedSockets() {
    if (this._authRevalidationInFlight || this.isShuttingDown) {
      return;
    }

    this._authRevalidationInFlight = true;
    try {
      for (const client of this.clients.values()) {
        if (
          client.readyState !== WebSocket.OPEN ||
          client.isRobot ||
          client.isGuest ||
          !client.userId
        ) {
          continue;
        }

        try {
          const authPayload = await this.resolveSocketUser(client.authAccessToken, client.cookieHeader);
          if (!authPayload || authPayload.sub !== client.userId) {
            this.logger.debug(`Closing websocket client with expired or revoked auth: ${client.id}`);
            try {
              client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid session token' } }));
            } catch {
              // Ignore send failures while disconnecting invalid sessions.
            }
            try {
              client.close(1008, 'Invalid session token');
            } catch {
              // Ignore close failures while disconnecting invalid sessions.
            }
            continue;
          }

          client.username = authPayload.username;
          client.role = authPayload.role;
        } catch (err) {
          this.logger.warn(`Failed to revalidate websocket auth for ${client.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      this._authRevalidationInFlight = false;
    }
  }

  handleDisconnect(client: WsClient) {
    this.clients.delete(client.id);
    this.guestSockets.unregister(client);

    // Leave the robot room
    if (client.watchingRobotId) {
      void this._leaveRoom(client);
    }

    // If this was the robot hardware, mark offline
    if (client.isRobot && client.robotId) {
      const activeRobotClient = this.robotClients.get(client.robotId);
      if (activeRobotClient !== client) {
        this.logger.debug(`Stale robot socket disconnected: ${client.robotId}`);
        return;
      }

      this.robotClients.delete(client.robotId);
      void this.releaseRobotClaimLock(client.robotId, client.id);
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
    @MessageBody() data: unknown,
  ) {
    if (!this._checkEventRateLimit(client, 'room:join')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    const parsed = this.parseWsPayload(client, data, roomJoinSchema, 'Invalid room join payload');
    if (!parsed) {
      return;
    }
    client.protocolVersion = parsed.protocolVersion;

    if (client.watchingRobotId) {
      await this._leaveRoom(client);
    }

    const providedAccessToken = parsed.accessToken?.trim();
    let authPayload: JwtPayload | null;
    try {
      authPayload = await this.resolveSocketUser(providedAccessToken, client.cookieHeader);
    } catch (err) {
      this.logger.warn(`Failed to validate websocket auth for ${client.id}: ${(err as Error).message}`);
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Failed to validate session token' } }));
      return;
    }
    client.authAccessToken = authPayload ? providedAccessToken : undefined;

    this.guestSockets.unregister(client);
    client.watchingRobotId = parsed.robotId;
    const isGuest = authPayload === null;
    client.isGuest = isGuest;

    if (isGuest && !this.guestSockets.canJoin(client)) {
      client.watchingRobotId = undefined;
      client.userId = undefined;
      client.username = undefined;
      client.authAccessToken = undefined;
      client.isGuest = undefined;
      client.role = undefined;
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Guest connection limit reached for this IP' } }));
      return;
    }

    if (authPayload === null) {
      const grantedActorId = await this.robotsService.resolveRoomAccessActorId(parsed.robotId, parsed.roomAccessToken);
      const derivedGuestId =
        grantedActorId && grantedActorId.startsWith('guest:')
          ? grantedActorId.slice('guest:'.length)
          : client.id.replace(/-/g, '').slice(0, 16);
      client.userId = `guest:${derivedGuestId}`;
      client.username = `Guest-${derivedGuestId.slice(0, 6)}`;
      client.role = undefined;
    } else {
      client.userId = authPayload.sub;
      client.username = authPayload.username || `User-${authPayload.sub.slice(0, 6)}`;
      client.role = authPayload.role;
    }

    const allowed = await this.robotsService.validateRoomAccess({
      robotId: parsed.robotId,
      actorId: client.userId,
      roomAccessToken: parsed.roomAccessToken,
    });
    if (!allowed) {
      client.watchingRobotId = undefined;
      client.userId = undefined;
      client.username = undefined;
      client.authAccessToken = undefined;
      client.isGuest = undefined;
      client.role = undefined;
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Room access verification required' } }));
      return;
    }

    if (isGuest) {
      this.guestSockets.register(client);
    }

    let pendingRestriction:
      | { event: string; data: unknown; action: string }
      | null = null;

    if (client.userId) {
      const restriction = await this.moderationService.getActiveRestriction(parsed.robotId, client.userId);
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
          client.authAccessToken = undefined;
          client.isGuest = undefined;
          client.role = undefined;
          client.send(JSON.stringify({ event, data: restriction }));
          return;
        }

        pendingRestriction = { event, data: restriction, action };
      }
    }

    if (!this.rooms.has(parsed.robotId)) this.rooms.set(parsed.robotId, new Set());
    this.rooms.get(parsed.robotId)!.add(client.id);

    client.presenceJoinedAt = Date.now();
    const presenceSnapshot = await this.refreshSharedPresenceState(client, parsed.robotId);
    this.robotsService
      .setViewerCount(parsed.robotId, presenceSnapshot.viewerCount)
      .catch(() => {});

    if (presenceSnapshot.focusUserConnections === 1) {
      this._broadcastToRoom(parsed.robotId, WS_EVENTS.PRESENCE_JOIN, {
        userId: client.userId,
        username: client.username,
      }, client.id);
    }

    // Send full presence snapshot to the joining client
    const presenceList = presenceSnapshot.presenceList;
    client.send(JSON.stringify({ event: WS_EVENTS.PRESENCE_UPDATE, data: { viewers: presenceList } }));

    const history = await this.robotsService.getRecentChatMessages(parsed.robotId);
    for (const entry of history) {
      client.send(JSON.stringify({ event: WS_EVENTS.CHAT_MESSAGE, data: { ...entry, historical: true } }));
    }

    if (pendingRestriction) {
      client.send(JSON.stringify({ event: pendingRestriction.event, data: pendingRestriction.data }));
    }

    return {
      event: WS_EVENTS.ROOM_JOIN,
      data: {
        ok: true,
        viewerCount: presenceSnapshot.viewerCount,
        protocolVersion: WS_PROTOCOL_VERSION,
        minProtocolVersion: WS_MIN_SUPPORTED_PROTOCOL_VERSION,
        clientProtocolVersion: parsed.protocolVersion,
      },
    };
  }

  @SubscribeMessage('room:ping')
  async handleRoomPing(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this._checkEventRateLimit(client, 'room:ping')) {
      return;
    }

    const parsed = this.parseWsPayload(client, data, roomPingSchema, 'Invalid room ping payload');
    if (!parsed) {
      return;
    }

    if (!client.watchingRobotId || client.watchingRobotId !== parsed.robotId || !client.userId) {
      return;
    }

    await this.touchSharedPresenceState(client, parsed.robotId);
  }

  // ─── Robot authentication ───────────────────────────────────────────────────

  @SubscribeMessage(WS_EVENTS.ROBOT_CLAIM)
  async handleRobotClaim(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: unknown,
  ) {
    if (!this._checkEventRateLimit(client, 'robot:claim')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    const parsed = this.parseWsPayload(client, data, robotClaimSchema, 'Invalid robot claim payload');
    if (!parsed) {
      return;
    }
    client.protocolVersion = parsed.protocolVersion;

    try {
      const robotId = this.resolveRobotSocketIdentity(parsed.robotAuthToken);
      if (!robotId) {
        client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid robot authorization' } }));
        try {
          client.close(1008, 'Invalid robot authorization');
        } catch {
          // Ignore close failures for rejected claims.
        }
        return;
      }
      const robot = await this.robotsService.findByIdCached(robotId);

      const existingRobotClient = this._getOpenRobotClient(robot.id);
      if (existingRobotClient && existingRobotClient !== client) {
        this.logger.warn(`Rejected duplicate robot claim for ${robot.id}`);
        client.send(
          JSON.stringify({
            event: WS_EVENTS.ERROR,
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

      const claimLockAcquired = await this.acquireRobotClaimLock(robot.id, client.id);
      if (!claimLockAcquired) {
        this.logger.warn(`Rejected cross-instance duplicate robot claim for ${robot.id}`);
        client.send(
          JSON.stringify({
            event: WS_EVENTS.ERROR,
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
      client.watchingRobotId = robot.id;
      this.robotClients.set(robot.id, client);

      await this.robotsService.updateStatus(robot.id, 'ONLINE');
      const queue = await this.queueService.getQueue(robot.id);
      await this.syncTurnLifecycle(robot.id, queue);
      this._broadcastToRoomLocally(robot.id, WS_EVENTS.QUEUE_UPDATE, { queue });
      this._broadcastToRoom(robot.id, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
      this.logger.log(`Robot claimed: ${robot.name} (${robot.id})`);

      return {
        event: WS_EVENTS.ROBOT_CLAIM,
        data: {
          success: true,
          robotId: robot.id,
          protocolVersion: WS_PROTOCOL_VERSION,
          minProtocolVersion: WS_MIN_SUPPORTED_PROTOCOL_VERSION,
          clientProtocolVersion: parsed.protocolVersion,
        },
      };
    } catch (err) {
      if (client.robotId) {
        await this.releaseRobotClaimLock(client.robotId, client.id);
      }
      this.logger.error('Robot claim error', err);
      return { event: WS_EVENTS.ERROR, data: { message: 'Claim failed' } };
    }
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_HEARTBEAT)
  handleHeartbeat(@ConnectedSocket() client: WsClient) {
    if (!this._checkEventRateLimit(client, 'robot:heartbeat')) {
      return { event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } };
    }

    if (client.robotId) {
      this.redis.set(`robot:heartbeat:${client.robotId}`, Date.now().toString(), 'EX', 30);
      void this.refreshRobotClaimLock(client.robotId, client.id);
      this.robotsService.touchHeartbeat(client.robotId).catch(() => {});
    }
    return { event: WS_EVENTS.ROBOT_HEARTBEAT, data: { ts: Date.now() } };
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_TELEMETRY)
  async handleTelemetry(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: unknown,
  ) {
    if (!this._checkEventRateLimit(client, 'robot:telemetry')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    const parsed = this.parseWsPayload(client, data, robotTelemetrySchema, 'Invalid telemetry payload');
    if (!parsed) {
      return;
    }

    if (!client.isRobot || !client.robotId) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Only robot clients can send telemetry' } }));
      return;
    }
    try {
      await this.robotsService.ingestRobotTelemetryByRobotId(client.robotId, parsed);
    } catch (err) {
      this.logger.warn(`Telemetry ingest failed for robot ${client.robotId}: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_ACTIONS_PULL)
  async handleRobotActionsPull(@ConnectedSocket() client: WsClient, @MessageBody() data?: unknown) {
    if (!this._checkEventRateLimit(client, WS_EVENTS.ROBOT_ACTIONS_PULL)) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    if (!this.parseWsPayload(client, data, emptyPayloadSchema, 'Invalid robot action poll payload')) {
      return;
    }

    if (!client.isRobot || !client.robotId) {
      client.send(
        JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Only robot clients can pull actions' } }),
      );
      return;
    }

    try {
      const payload = await this.robotsService.consumeActionsByRobotId(client.robotId);
      client.send(JSON.stringify({ event: WS_EVENTS.ROBOT_ACTIONS, data: payload }));
    } catch (err) {
      this.logger.error('Failed to pull robot actions', err);
    }
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_EMERGENCY_STOP)
  async handleEmergencyStopMessage(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: unknown,
  ) {
    if (!this._checkEventRateLimit(client, 'estop')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    const parsed = this.parseWsPayload(client, data, emergencyStopSchema, 'Invalid emergency stop payload');
    if (!parsed) {
      return;
    }

    if (client.watchingRobotId !== parsed.robotId || !client.userId) {
      client.send(
        JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Join the room before using E-STOP' } }),
      );
      return;
    }

    try {
      const access = await this.robotsService.getAccessPolicy(parsed.robotId);
      if (access.estop === 'DISABLED') {
        client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'E-STOP is disabled for this room' } }));
        return;
      }
      if (access.estop === 'AUTHENTICATED' && client.isGuest) {
        client.send(
          JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Please sign in to use E-STOP' } }),
        );
        return;
      }

      this._triggerEmergencyStop(parsed.robotId, `Manual E-STOP by ${client.userId}`);
    } catch {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Failed to validate E-STOP access' } }));
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

  private async _leaveRoom(client: WsClient) {
    const robotId = client.watchingRobotId!;
    const room = this.rooms.get(robotId);
    room?.delete(client.id);
    if (room && room.size === 0) {
      this.rooms.delete(robotId);
    }

    client.watchingRobotId = undefined;
    if (client.isGuest) {
      this.guestSockets.unregister(client);
    }
    if (!client.userId) {
      return;
    }

    const snapshot = await this.removeSharedPresenceState(client, robotId);
    if (snapshot.focusUserConnections === 0) {
      this._broadcastToRoom(robotId, WS_EVENTS.PRESENCE_LEAVE, {
        userId: client.userId,
        username: client.username,
      });
    }
    if (snapshot.cleanedStaleEntries) {
      this._broadcastToRoom(robotId, WS_EVENTS.PRESENCE_UPDATE, {
        viewers: snapshot.presenceList,
      });
    }
    this.robotsService
      .setViewerCount(robotId, snapshot.viewerCount)
      .catch(() => {});
  }

  private async refreshSharedPresenceState(client: WsClient, robotId: string): Promise<SharedPresenceSnapshot> {
    return this.presence.refresh(client, robotId);
  }

  private async touchSharedPresenceState(client: WsClient, robotId: string): Promise<void> {
    return this.presence.touch(client, robotId);
  }

  private async removeSharedPresenceState(client: WsClient, robotId: string): Promise<SharedPresenceSnapshot> {
    return this.presence.remove(client, robotId);
  }

  private async getSharedPresenceSnapshot(robotId: string, focusUserId?: string): Promise<SharedPresenceSnapshot> {
    return this.presence.getSnapshot(robotId, focusUserId);
  }

  private viewerSocketKey(clientId: string) {
    return this.presence.viewerSocketKey(clientId);
  }

  private viewerRoomIndexKey(robotId: string) {
    return this.presence.viewerRoomIndexKey(robotId);
  }

  private robotClaimKey(robotId: string) {
    return this.claimLock.claimKey(robotId);
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

  private _broadcastSystemLocally(event: string, data: unknown) {
    const message = JSON.stringify({ event, data });
    for (const client of this.clients.values()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private async syncTurnLifecycle(
    robotId: string,
    queue: Array<{ userId: string; user?: { username?: string; displayName?: string | null } }>,
  ) {
    return this.turnHandler.syncTurnLifecycle(robotId, queue);
  }

  private async handleTurnTimeout(robotId: string, userId: string) {
    return this.turnHandler.handleTurnTimeout(robotId, userId);
  }

  private async clearTurnState(robotId: string, reason: 'handoff' | 'timeout' | 'clear' = 'handoff') {
    return this.turnHandler.clearTurnState(robotId, reason);
  }

  private async enforceModerationEvent(robotId: string, payload: { event?: string; data?: unknown }) {
    return this.moderationEnforcer.enforce(robotId, payload);
  }

  private disconnectUserFromRoom(robotId: string, targetUserId: string) {
    return this.moderationEnforcer.disconnectUserFromRoom(robotId, targetUserId);
  }

  private buildModerationSystemMessage(event: string, data: unknown): string | null {
    return this.moderationEnforcer.buildSystemMessage(event, data);
  }

  private async acquireRobotClaimLock(robotId: string, clientId: string): Promise<boolean> {
    return this.claimLock.acquire(robotId, clientId);
  }

  private async refreshRobotClaimLock(robotId: string, clientId: string): Promise<void> {
    return this.claimLock.refresh(robotId, clientId);
  }

  private async releaseRobotClaimLock(robotId: string, clientId: string): Promise<void> {
    return this.claimLock.release(robotId, clientId);
  }

  private async resolveSocketUser(accessToken?: string, cookieHeader?: string): Promise<JwtPayload | null> {
    const token =
      accessToken?.trim() ||
      parseCookie(cookieHeader, getAccessCookieName(this.configService));
    if (!token) {
      return null;
    }

    return this.authService.resolveValidAccessTokenPayload(token);
  }

  private resolveRobotSocketIdentity(robotAuthToken?: string): string | null {
    const token = robotAuthToken?.trim();
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<{ sub?: string; scope?: string; deviceHash?: string }>(token, {
        secret: this.getRobotJwtSecret(),
      });
      if (payload.scope !== 'robot' || typeof payload.sub !== 'string' || !payload.sub.trim()) {
        return null;
      }
      if (typeof payload.deviceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.deviceHash)) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  private getRobotJwtSecret() {
    return this.configService.getOrThrow<string>('ROBOT_JWT_SECRET');
  }

  private parseWsPayload<TSchema extends ZodTypeAny>(
    client: WsClient,
    payload: unknown,
    schema: TSchema,
    errorMessage: string,
  ): z.infer<TSchema> | null {
    const result = schema.safeParse(payload);
    if (result.success) {
      return result.data;
    }

    this.logger.debug(`${errorMessage}: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
    client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: errorMessage } }));
    return null;
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
      isStaffRole(client.role),
    );
  }

  private async consumeControlCooldown(
    client: WsClient,
    robotId: string,
    command: string,
    cooldownMs: number,
  ): Promise<boolean> {
    if (cooldownMs <= 0) {
      return true;
    }

    const actorKey = client.userId ?? client.id;
    const normalizedCommand = command.trim().toLowerCase();
    if (!actorKey || !normalizedCommand) {
      return true;
    }

    const key = this.buildControlCooldownKey(actorKey, robotId, normalizedCommand);

    try {
      const acquired = await this.redis.set(key, Date.now().toString(), 'PX', cooldownMs, 'NX');
      this.markControlCooldownRedisHealthy();
      return acquired === 'OK';
    } catch (err) {
      if (!this._controlCooldownRedisFallbackActive) {
        this.logger.warn(`Redis control cooldown unavailable; falling back to local cache: ${(err as Error).message}`);
        this._controlCooldownRedisFallbackActive = true;
      }
      return this.consumeLocalControlCooldown(key, cooldownMs);
    }
  }

  private buildControlCooldownKey(actorKey: string, robotId: string, command: string): string {
    return `ws:control-cooldown:${robotId}:${actorKey}:${command}`;
  }

  private consumeLocalControlCooldown(key: string, cooldownMs: number): boolean {
    const now = Date.now();
    const nextAllowedAt = this.controlCooldownFallbacks.get(key) ?? 0;
    if (nextAllowedAt > now) {
      return false;
    }

    if (this.controlCooldownFallbacks.size > 4096) {
      for (const [entryKey, expiresAt] of this.controlCooldownFallbacks.entries()) {
        if (expiresAt <= now) {
          this.controlCooldownFallbacks.delete(entryKey);
        }
      }
    }

    this.controlCooldownFallbacks.set(key, now + cooldownMs);
    return true;
  }

  private markControlCooldownRedisHealthy(): void {
    if (!this._controlCooldownRedisFallbackActive) {
      return;
    }

    this._controlCooldownRedisFallbackActive = false;
    this.controlCooldownFallbacks.clear();
    this.logger.log('Redis control cooldown recovered; local fallback cache cleared');
  }

  private _buildCommandMetadata(client: WsClient, robotId: string, ownerId?: string | null): CommandMetadata {
    const isRobotOwner = Boolean(ownerId) && Boolean(client.userId) && client.userId === ownerId;
    const isSiteAdmin = client.role === 'ADMIN';
    const isSiteModerator = isStaffRole(client.role) && !isSiteAdmin;
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

  private resolveClientIp(request?: {
    headers?: { cookie?: string; 'x-forwarded-for'?: string };
    socket?: { remoteAddress?: string };
  }): string {
    const forwardedFor = request?.headers?.['x-forwarded-for'];
    if (forwardedFor) {
      const first = forwardedFor.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }

    const remoteAddress = request?.socket?.remoteAddress?.trim();
    if (remoteAddress) {
      return remoteAddress;
    }

    return 'unknown';
  }

  getRuntimeMetricsSnapshot() {
    let roomMemberships = 0;
    for (const members of this.rooms.values()) {
      roomMemberships += members.size;
    }

    return {
      connectedClients: this.clients.size,
      connectedRobotClients: this.robotClients.size,
      activeRooms: this.rooms.size,
      roomMemberships,
      activeTurns: this.activeTurns.localSize(),
      controlCooldowns: this.controlCooldownFallbacks.size,
    };
  }

  @SubscribeMessage(WS_EVENTS.CHAT_MESSAGE)
  async handleChatMessage(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: unknown,
  ) {
    if (!this._checkEventRateLimit(client, 'chat')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }
    return this.chatHandler.handle(client, data);
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_COMMAND)
  async handleControlCommand(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: unknown,
  ) {
    if (!this._checkEventRateLimit(client, 'control')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }
    return this.controlHandler.handle(client, data);
  }
}
