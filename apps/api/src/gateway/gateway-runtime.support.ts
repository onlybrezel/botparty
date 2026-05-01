import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { WS_EVENTS } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { WebSocket } from 'ws';
import type { ZodTypeAny } from 'zod';
import type { AuthService } from '../auth/auth.service';
import { getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import { isStaffRole } from '../common/robot-access';
import type { RedisService } from '../redis/redis.service';
import { ActiveTurnStore } from './active-turn.store';
import { GuestSocketHandler } from './guest-socket.handler';
import type { CommandMetadata, WsClient } from './gateway-types';
import { checkWsEventRateLimit } from './gateway-rate-limit';
import { PresenceHandler } from './presence.handler';
import { RobotClaimLockHandler } from './robot-claim-lock.handler';

const WS_AUTH_REVALIDATE_INTERVAL_MS = 120_000;

type GatewayConnectionRequest = {
  headers?: { cookie?: string; origin?: string; 'x-forwarded-for'?: string };
  socket?: { remoteAddress?: string };
};

export class GatewayRuntimeSupport {
  readonly instanceId = crypto.randomUUID();
  readonly clients = new Map<string, WsClient>();
  readonly robotClients = new Map<string, WsClient>();
  readonly rooms = new Map<string, Set<string>>();
  readonly guestSockets = new GuestSocketHandler();
  readonly presence: PresenceHandler;
  readonly activeTurns: ActiveTurnStore;

  private readonly claimLock: RobotClaimLockHandler;
  private readonly turnTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly controlCooldownFallbacks = new Map<string, number>();
  private readonly allowedWsOrigins: Set<string>;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private controlCooldownFallbackCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private authRevalidationInterval: ReturnType<typeof setInterval> | null = null;
  private authRevalidationInFlight = false;
  private controlCooldownRedisFallbackActive = false;
  private shuttingDown = false;

  constructor(
    private readonly redis: RedisService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    readonly logger: Logger,
  ) {
    this.presence = new PresenceHandler(this.redis, this.instanceId);
    this.claimLock = new RobotClaimLockHandler(this.redis);
    this.activeTurns = new ActiveTurnStore(this.redis);
    this.allowedWsOrigins = new Set(
      (this.configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    );
  }

  start() {
    this.pingInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.ping();
          } catch {
            // Ignore heartbeat send errors.
          }
        }
      }
    }, 30_000);

    this.controlCooldownFallbackCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this.controlCooldownFallbacks.entries()) {
        if (expiresAt <= now) {
          this.controlCooldownFallbacks.delete(key);
        }
      }
    }, 60_000);

    this.authRevalidationInterval = setInterval(() => {
      void this.revalidateAuthenticatedSockets();
    }, WS_AUTH_REVALIDATE_INTERVAL_MS);

  }

  stop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.controlCooldownFallbackCleanupInterval) {
      clearInterval(this.controlCooldownFallbackCleanupInterval);
      this.controlCooldownFallbackCleanupInterval = null;
    }
    if (this.authRevalidationInterval) {
      clearInterval(this.authRevalidationInterval);
      this.authRevalidationInterval = null;
    }
  }

  isShuttingDown() {
    return this.shuttingDown;
  }

  checkEventRateLimit(client: WsClient, eventType = 'generic'): boolean {
    return checkWsEventRateLimit(client, eventType === WS_EVENTS.ROBOT_ACTIONS_PULL ? 'robotActionsPull' : eventType);
  }

  handleConnection(client: WsClient, request?: GatewayConnectionRequest) {
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

  handleDisconnect(
    client: WsClient,
    context: {
      leaveRoom(client: WsClient): Promise<void>;
      clearTurnState(robotId: string): Promise<void>;
      clearQueue(robotId: string): Promise<unknown>;
      updateRobotStatus(robotId: string, status: 'OFFLINE'): Promise<unknown>;
      stopRoomRecording(robotId: string): Promise<unknown>;
    },
  ) {
    this.clients.delete(client.id);
    this.guestSockets.unregister(client);

    if (client.watchingRobotId) {
      void context.leaveRoom(client);
    }

    if (!client.isRobot || !client.robotId) {
      return;
    }

    const activeRobotClient = this.robotClients.get(client.robotId);
    if (activeRobotClient !== client) {
      this.logger.debug(`Stale robot socket disconnected: ${client.robotId}`);
      return;
    }

    this.robotClients.delete(client.robotId);
    void this.releaseRobotClaimLock(client.robotId, client.id);
    if (this.shuttingDown) {
      this.logger.log(`Robot realtime socket closed during shutdown: ${client.robotId}`);
      return;
    }

    void context.clearTurnState(client.robotId);
    void context.clearQueue(client.robotId).catch(() => {});
    void context.updateRobotStatus(client.robotId, 'OFFLINE').catch(() => {});
    void context.stopRoomRecording(client.robotId).catch(() => {});
    this.broadcastToRoom(client.robotId, WS_EVENTS.ROBOT_STATUS, { status: 'OFFLINE' });
    this.logger.log(`Robot disconnected: ${client.robotId}`);
  }

  async revalidateAuthenticatedSockets() {
    if (this.authRevalidationInFlight || this.shuttingDown) {
      return;
    }

    this.authRevalidationInFlight = true;
    try {
      for (const client of this.clients.values()) {
        if (client.readyState !== WebSocket.OPEN || client.isRobot || client.isGuest || !client.userId) {
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
      this.authRevalidationInFlight = false;
    }
  }

  async beforeApplicationShutdown(signal?: string) {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
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

  broadcastToRoom(robotId: string, event: string, data: unknown, excludeClientId?: string) {
    this.broadcastToRoomLocally(robotId, event, data, excludeClientId);
    this.redis.publish(
      `ws:room:${robotId}`,
      JSON.stringify({ originId: this.instanceId, event, data }),
    ).catch(() => {});
  }

  broadcastToRoomLocally(robotId: string, event: string, data: unknown, excludeClientId?: string) {
    const message = JSON.stringify({ event, data });
    const room = this.rooms.get(robotId);
    if (!room) {
      return;
    }

    for (const clientId of room) {
      if (clientId === excludeClientId) {
        continue;
      }
      const ws = this.clients.get(clientId);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  broadcastSystemLocally(event: string, data: unknown) {
    const message = JSON.stringify({ event, data });
    for (const client of this.clients.values()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getOpenRobotClient(robotId: string): WsClient | undefined {
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

  getTurnTimeout(robotId: string) {
    return this.turnTimeouts.get(robotId);
  }

  setTurnTimeout(robotId: string, timer: ReturnType<typeof setTimeout>) {
    this.turnTimeouts.set(robotId, timer);
  }

  clearTurnTimeout(robotId: string) {
    const timer = this.turnTimeouts.get(robotId);
    if (timer) {
      clearTimeout(timer);
      this.turnTimeouts.delete(robotId);
    }
  }

  async acquireRobotClaimLock(robotId: string, clientId: string): Promise<boolean> {
    return this.claimLock.acquire(robotId, clientId);
  }

  async refreshRobotClaimLock(robotId: string, clientId: string): Promise<void> {
    return this.claimLock.refresh(robotId, clientId);
  }

  async transferRobotClaimLock(robotId: string, fromClientId: string, toClientId: string): Promise<boolean> {
    return this.claimLock.transfer(robotId, fromClientId, toClientId);
  }

  async releaseRobotClaimLock(robotId: string, clientId: string): Promise<void> {
    return this.claimLock.release(robotId, clientId);
  }

  async resolveSocketUser(accessToken?: string, cookieHeader?: string): Promise<JwtPayload | null> {
    const token = accessToken?.trim() || parseCookie(cookieHeader, getAccessCookieName(this.configService));
    if (!token) {
      return null;
    }

    return this.authService.resolveValidAccessTokenPayload(token);
  }

  resolveRobotSocketIdentity(robotAuthToken?: string): string | null {
    const token = robotAuthToken?.trim();
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<{ sub?: string; scope?: string; deviceHash?: string }>(token, {
        secret: this.configService.getOrThrow<string>('ROBOT_JWT_SECRET'),
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

  parseWsPayload<TSchema extends ZodTypeAny>(
    client: WsClient,
    payload: unknown,
    schema: TSchema,
    errorMessage: string,
  ): TSchema['_output'] | null {
    const result = schema.safeParse(payload);
    if (result.success) {
      return result.data;
    }

    this.logger.debug(`${errorMessage}: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
    client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: errorMessage } }));
    return null;
  }

  isRoomModerator(client: WsClient, ownerId?: string | null): boolean {
    return Boolean((ownerId && client.userId && client.userId === ownerId) || isStaffRole(client.role));
  }

  async consumeControlCooldown(
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

    const key = `ws:control-cooldown:${robotId}:${actorKey}:${normalizedCommand}`;

    try {
      const acquired = await this.redis.set(key, Date.now().toString(), 'PX', cooldownMs, 'NX');
      this.markControlCooldownRedisHealthy();
      return acquired === 'OK';
    } catch (err) {
      if (!this.controlCooldownRedisFallbackActive) {
        this.logger.warn(`Redis control cooldown unavailable; falling back to local cache: ${(err as Error).message}`);
        this.controlCooldownRedisFallbackActive = true;
      }
      return this.consumeLocalControlCooldown(key, cooldownMs);
    }
  }

  buildCommandMetadata(client: WsClient, robotId: string, ownerId?: string | null): CommandMetadata {
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

  recordRobotHeartbeat(robotId: string, clientId: string) {
    void this.redis.set(`robot:heartbeat:${robotId}`, Date.now().toString(), 'EX', 30);
    void this.refreshRobotClaimLock(robotId, clientId);
  }

  sendRobotStop(robotId: string, reason: string) {
    const robotClient = this.getOpenRobotClient(robotId);
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

  triggerEmergencyStop(robotId: string, reason: string) {
    const robotClient = this.getOpenRobotClient(robotId);
    if (robotClient) {
      robotClient.send(
        JSON.stringify({ event: WS_EVENTS.CONTROL_EMERGENCY_STOP, data: { reason, timestamp: Date.now() } }),
      );
    }
    this.broadcastToRoom(robotId, WS_EVENTS.CONTROL_EMERGENCY_STOP, { reason });
    this.logger.warn(`EMERGENCY STOP: Robot ${robotId} - ${reason}`);
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

  private markControlCooldownRedisHealthy() {
    if (!this.controlCooldownRedisFallbackActive) {
      return;
    }

    this.controlCooldownRedisFallbackActive = false;
    this.controlCooldownFallbacks.clear();
    this.logger.log('Redis control cooldown recovered; local fallback cache cleared');
  }

  private resolveClientIp(request?: GatewayConnectionRequest): string {
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
}
