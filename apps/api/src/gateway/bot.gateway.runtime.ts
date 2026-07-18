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
import { Server } from 'ws';
import { WS_EVENTS } from '@botparty/shared';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';
import { ControlsService } from '../controls/controls.service';
import { AuthService } from '../auth/auth.service';
import { WalletService } from '../wallet/wallet.service';
import { LivekitService } from '../livekit/livekit.service';
import type { WsClient } from './gateway-types';
import { ChatHandler } from './chat.handler';
import { ControlHandler } from './control.handler';
import { GatewayRuntimeSupport } from './gateway-runtime.support';
import { ModerationEnforcerHandler } from './moderation-enforcer.handler';
import { RedisPubSubHandler } from './redis-pubsub.handler';
import { RoomHandler } from './room.handler';
import { RobotRuntimeHandler } from './robot-runtime.handler';
import { TurnHandler } from './turn.handler';
import { FeatureFlagsService } from '../common/feature-flags.service';
import { NotificationsService } from '../notifications/notifications.service';

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
  private readonly runtime: GatewayRuntimeSupport;
  private readonly clients: Map<string, WsClient>;
  private readonly robotClients: Map<string, WsClient>;
  private readonly roomHandler: RoomHandler;
  private readonly turnHandler: TurnHandler;
  private readonly moderationEnforcer: ModerationEnforcerHandler;
  private readonly chatHandler: ChatHandler;
  private readonly controlHandler: ControlHandler;
  private readonly redisPubSub: RedisPubSubHandler;
  private readonly robotRuntimeHandler: RobotRuntimeHandler;
  private readonly robotDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private turnReconciliationTimer: ReturnType<typeof setInterval> | null = null;

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
    private readonly walletService: WalletService,
    private readonly livekitService: LivekitService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly notifications: NotificationsService,
  ) {
    this.runtime = new GatewayRuntimeSupport(
      this.redis,
      this.authService,
      this.jwtService,
      this.configService,
      this.logger,
    );
    this.clients = this.runtime.clients;
    this.robotClients = this.runtime.robotClients;
    this.roomHandler = new RoomHandler(this.runtime, this.robotsService, this.moderationService);
    this.turnHandler = new TurnHandler(
      {
        robotClients: this.robotClients,
        getActiveTurn: (robotId) => this.runtime.activeTurns.get(robotId),
        hasLocalActiveTurn: (robotId) => this.runtime.activeTurns.hasLocal(robotId),
        isTurnOwner: (state) => state.ownerId === this.runtime.instanceId && state.leaseExpiresAt > Date.now(),
        acquireActiveTurn: (robotId, state) => this.runtime.activeTurns.acquire(robotId, state),
        clearActiveTurn: (robotId, expected) => this.runtime.activeTurns.clear(robotId, expected),
        getTurnTimeout: (robotId) => this.runtime.getTurnTimeout(robotId),
        setTurnTimeout: (robotId, timer) => this.runtime.setTurnTimeout(robotId, timer),
        clearTurnTimeout: (robotId) => this.runtime.clearTurnTimeout(robotId),
        broadcastToRoom: (robotId, event, data, excludeClientId) =>
          this.runtime.broadcastToRoom(robotId, event, data, excludeClientId),
        sendRobotStop: (robotId, reason) => this.runtime.sendRobotStop(robotId, reason),
        revokeController: (robotId, userId) => this.livekitService.revokeController(robotId, userId),
      },
      this.robotsService,
      this.sessionsService,
      this.queueService,
      this.notifications,
    );
    this.moderationEnforcer = new ModerationEnforcerHandler(
      {
        clients: this.clients,
        getActiveTurn: (robotId) => this.runtime.activeTurns.get(robotId),
        clearTurnState: (robotId, reason) => this.clearTurnState(robotId, reason),
        leaveRoom: (client) => this.roomHandler.leaveRoom(client),
      },
      this.queueService,
    );
    const handlerCtx = {
      broadcastToRoom: (robotId: string, event: string, data: unknown, excludeClientId?: string) =>
        this.runtime.broadcastToRoom(robotId, event, data, excludeClientId),
      getOpenRobotClient: (robotId: string) => this.runtime.getOpenRobotClient(robotId),
      buildCommandMetadata: (client: WsClient, robotId: string, ownerId?: string | null) =>
        this.runtime.buildCommandMetadata(client, robotId, ownerId),
      reserveChatMessage: async (actorId: string, clientMessageId: string) =>
        (await this.redis.set(`chat:dedupe:${actorId}:${clientMessageId}`, '1', 'EX', 86_400, 'NX')) === 'OK',
      consumeControlCooldown: async (client: WsClient, robotId: string, command: string, cooldownMs: number) =>
        this.consumeControlCooldown(client, robotId, command, cooldownMs),
      isRoomModerator: (client: WsClient, ownerId?: string | null) =>
        this.runtime.isRoomModerator(client, ownerId),
      triggerEmergencyStop: (robotId: string, reason: string) =>
        this.runtime.triggerEmergencyStop(robotId, reason),
    };
    this.chatHandler = new ChatHandler(handlerCtx, this.robotsService, this.moderationService);
    this.controlHandler = new ControlHandler(
      handlerCtx,
      this.robotsService,
      this.moderationService,
      this.queueService,
      this.controlsService,
      this.walletService,
      this.featureFlags,
    );
    this.robotRuntimeHandler = new RobotRuntimeHandler(
      this.runtime,
      this.robotsService,
      this.queueService,
      (robotId, queue) => this.syncTurnLifecycle(robotId, queue),
    );
    this.redisPubSub = new RedisPubSubHandler(this.redis, this.queueService, {
      instanceId: this.runtime.instanceId,
      hasOpenRobotClient: (robotId) => Boolean(this.runtime.getOpenRobotClient(robotId)),
      hasLocalActiveTurn: (robotId) => this.runtime.activeTurns.hasLocal(robotId),
      syncTurnLifecycle: (robotId, queue) => this.syncTurnLifecycle(robotId, queue),
      clearTurnState: (robotId, reason) => this.clearTurnState(robotId, reason),
      broadcastToRoomLocally: (robotId, event, data, excludeClientId) =>
        this.runtime.broadcastToRoomLocally(robotId, event, data, excludeClientId),
      enforceModerationEvent: (robotId, payload) => this.enforceModerationEvent(robotId, payload),
      buildModerationSystemMessage: (event, data) => this.buildModerationSystemMessage(event, data),
      broadcastSystemLocally: (event, data) => this.runtime.broadcastSystemLocally(event, data),
    });
  }

  async onModuleInit() {
    await this.redisPubSub.start();
    this.runtime.start();
    await this.controlHandler.reconcilePendingCommands();
    this.turnReconciliationTimer = setInterval(() => {
      void this.reconcileTurnLeases();
    }, 5_000);
  }

  async onModuleDestroy() {
    this.controlHandler.shutdown();
    this.runtime.stop();
    await this.redisPubSub.stop();
    if (this.turnReconciliationTimer) clearInterval(this.turnReconciliationTimer);
    for (const timer of this.robotDisconnectTimers.values()) clearTimeout(timer);
  }

  async beforeApplicationShutdown(signal?: string) {
    await this.runtime.beforeApplicationShutdown(signal);
  }

  handleConnection(
    client: WsClient,
    request?: {
      headers?: { cookie?: string; 'x-forwarded-for'?: string; origin?: string };
      socket?: { remoteAddress?: string };
    },
  ) {
    this.runtime.handleConnection(client, request);
  }

  handleDisconnect(client: WsClient) {
    this.runtime.handleDisconnect(client, {
      leaveRoom: (socket) => this.roomHandler.leaveRoom(socket),
      scheduleRobotDisconnect: (robotId) => this.scheduleRobotDisconnect(robotId),
    });
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'room:join')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    return this.roomHandler.handleJoin(client, data);
  }

  @SubscribeMessage('room:ping')
  async handleRoomPing(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'room:ping')) {
      return;
    }

    return this.roomHandler.handlePing(client, data);
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_CLAIM)
  async handleRobotClaim(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'robot:claim')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    const result = await this.robotRuntimeHandler.handleRobotClaim(client, data);
    if (client.robotId) {
      const timer = this.robotDisconnectTimers.get(client.robotId);
      if (timer) clearTimeout(timer);
      this.robotDisconnectTimers.delete(client.robotId);
    }
    return result;
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_HEARTBEAT)
  handleHeartbeat(@ConnectedSocket() client: WsClient) {
    if (!this.runtime.checkEventRateLimit(client, 'robot:heartbeat')) {
      return { event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } };
    }

    return this.robotRuntimeHandler.handleHeartbeat(client);
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_TELEMETRY)
  async handleTelemetry(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'robot:telemetry')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    return this.robotRuntimeHandler.handleTelemetry(client, data);
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_ACTIONS_PULL)
  async handleRobotActionsPull(@ConnectedSocket() client: WsClient, @MessageBody() data?: unknown) {
    if (!this.runtime.checkEventRateLimit(client, WS_EVENTS.ROBOT_ACTIONS_PULL)) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    return this.robotRuntimeHandler.handleRobotActionsPull(client, data);
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_EMERGENCY_STOP)
  async handleEmergencyStopMessage(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'estop')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }

    return this.robotRuntimeHandler.handleEmergencyStopMessage(client, data);
  }

  @SubscribeMessage(WS_EVENTS.CHAT_MESSAGE)
  async handleChatMessage(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'chat')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }
    return this.chatHandler.handle(client, data);
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_COMMAND)
  async handleControlCommand(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'control')) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Too many requests' } }));
      return;
    }
    return this.controlHandler.handle(client, data);
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_ACK)
  async handleControlAck(@ConnectedSocket() client: WsClient, @MessageBody() data: unknown) {
    if (!this.runtime.checkEventRateLimit(client, 'control')) return;
    return this.controlHandler.handleAck(client, data);
  }

  getRuntimeMetricsSnapshot() {
    return this.runtime.getRuntimeMetricsSnapshot();
  }

  private async syncTurnLifecycle(
    robotId: string,
    queue: Array<{ userId: string; user?: { username?: string; displayName?: string | null } }>,
  ) {
    return this.turnHandler.syncTurnLifecycle(robotId, queue);
  }

  private scheduleRobotDisconnect(robotId: string) {
    const existing = this.robotDisconnectTimers.get(robotId);
    if (existing) clearTimeout(existing);
    this.robotDisconnectTimers.set(robotId, setTimeout(() => {
      this.robotDisconnectTimers.delete(robotId);
      if (this.runtime.getOpenRobotClient(robotId)) return;
      void this.clearTurnState(robotId, 'clear').catch((error: unknown) => {
        this.logger.warn(`Failed to clear disconnected robot turn ${robotId}: ${(error as Error).message}`);
      });
      void this.robotsService.updateStatus(robotId, 'OFFLINE').catch((error: unknown) => {
        this.logger.warn(`Failed to mark disconnected robot ${robotId} offline: ${(error as Error).message}`);
      });
      void this.livekitService.stopRoomRecording(robotId).catch((error: unknown) => {
        this.logger.warn(`Failed to stop recording for disconnected robot ${robotId}: ${(error as Error).message}`);
      });
      this.runtime.broadcastToRoom(robotId, WS_EVENTS.ROBOT_STATUS, { status: 'OFFLINE' });
    }, 10_000));
  }

  private async reconcileTurnLeases() {
    const robotIds = await this.queueService.listQueuedRobotIds().catch(() => [] as string[]);
    for (const robotId of robotIds) {
      if (!this.runtime.getOpenRobotClient(robotId)) continue;
      const queue = await this.queueService.getQueue(robotId).catch(() => []);
      await this.syncTurnLifecycle(robotId, queue).catch((error) => {
        this.logger.warn(`Turn reconciliation failed for ${robotId}: ${(error as Error).message}`);
      });
    }
  }

  private async clearTurnState(robotId: string, reason: 'handoff' | 'timeout' | 'clear' = 'handoff') {
    return this.turnHandler.clearTurnState(robotId, reason);
  }

  private async enforceModerationEvent(robotId: string, payload: { event?: string; data?: unknown }) {
    return this.moderationEnforcer.enforce(robotId, payload);
  }

  private buildModerationSystemMessage(event: string, data: unknown): string | null {
    return this.moderationEnforcer.buildSystemMessage(event, data);
  }

  private async _revalidateAuthenticatedSockets() {
    return this.runtime.revalidateAuthenticatedSockets();
  }

  private async consumeControlCooldown(
    client: WsClient,
    robotId: string,
    command: string,
    cooldownMs: number,
  ): Promise<boolean> {
    return this.runtime.consumeControlCooldown(client, robotId, command, cooldownMs);
  }
}
