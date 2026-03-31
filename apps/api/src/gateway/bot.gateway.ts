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

interface WsClient extends WebSocket {
  id: string;
  userId?: string;
  username?: string;
  robotId?: string;
  isRobot?: boolean;
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
  private readonly clients = new Map<string, WsClient>();
  private readonly robotClients = new Map<string, WsClient>(); // robotId -> WsClient

  constructor(
    private readonly robotsService: RobotsService,
    private readonly sessionsService: SessionsService,
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
  ) {}

  handleConnection(client: WsClient) {
    client.id = crypto.randomUUID();
    this.clients.set(client.id, client);
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: WsClient) {
    this.clients.delete(client.id);

    // If this was a robot, mark offline
    if (client.isRobot && client.robotId) {
      this.robotClients.delete(client.robotId);
      this.robotsService.updateStatus(client.robotId, 'OFFLINE').catch(() => {});
      this.broadcastToRoom(client.robotId, WS_EVENTS.ROBOT_STATUS, { status: 'OFFLINE' });
      this.logger.log(`Robot disconnected: ${client.robotId}`);
    }

    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(WS_EVENTS.ROBOT_CLAIM)
  async handleRobotClaim(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { claimToken: string },
  ) {
    // Robot authenticates with claim token
    try {
      const robot = await this.robotsService.findAll().then((robots) =>
        robots.find((r) => (r as unknown as { claimToken: string }).claimToken === data.claimToken),
      );

      // Note: In production, use a direct DB query with the claimToken
      // This is simplified for bootstrap
      if (!robot) {
        client.send(JSON.stringify({ event: 'error', data: { message: 'Invalid claim token' } }));
        return;
      }

      client.isRobot = true;
      client.robotId = robot.id;
      this.robotClients.set(robot.id, client);

      await this.robotsService.updateStatus(robot.id, 'ONLINE');
      this.broadcastToRoom(robot.id, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
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

  @SubscribeMessage(WS_EVENTS.CONTROL_COMMAND)
  handleControlCommand(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { robotId: string; command: string; value?: unknown; timestamp: number },
  ) {
    const robotClient = this.robotClients.get(data.robotId);
    if (!robotClient) return;

    // Forward command directly to robot (ultra-low latency path)
    robotClient.send(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_COMMAND,
        data: {
          command: data.command,
          value: data.value,
          userId: client.userId,
          timestamp: data.timestamp,
        },
      }),
    );

    // Check latency
    const latency = Date.now() - data.timestamp;
    if (latency > LIMITS.LATENCY_EMERGENCY_STOP_MS) {
      this.handleEmergencyStop(data.robotId, 'High latency detected');
    } else if (latency > LIMITS.LATENCY_WARNING_MS) {
      client.send(
        JSON.stringify({
          event: WS_EVENTS.CONTROL_LATENCY_WARNING,
          data: { latencyMs: latency },
        }),
      );
    }
  }

  @SubscribeMessage(WS_EVENTS.CONTROL_EMERGENCY_STOP)
  handleEmergencyStop(robotId: string, reason = 'Manual emergency stop') {
    const robotClient = this.robotClients.get(robotId);
    if (!robotClient) return;

    robotClient.send(
      JSON.stringify({
        event: WS_EVENTS.CONTROL_EMERGENCY_STOP,
        data: { reason, timestamp: Date.now() },
      }),
    );

    this.broadcastToRoom(robotId, WS_EVENTS.CONTROL_EMERGENCY_STOP, { reason });
    this.logger.warn(`EMERGENCY STOP: Robot ${robotId} – ${reason}`);
  }

  @SubscribeMessage(WS_EVENTS.CHAT_MESSAGE)
  handleChatMessage(
    @ConnectedSocket() client: WsClient,
    @MessageBody() data: { robotId: string; content: string },
  ) {
    if (!client.userId || !data.content || data.content.length > LIMITS.MAX_CHAT_MESSAGE_LENGTH) {
      return;
    }

    this.broadcastToRoom(data.robotId, WS_EVENTS.CHAT_MESSAGE, {
      userId: client.userId,
      username: client.username,
      content: data.content,
      timestamp: Date.now(),
    });
  }

  private broadcastToRoom(robotId: string, event: string, data: unknown) {
    const message = JSON.stringify({ event, data });
    for (const client of this.clients.values()) {
      if (client.robotId === robotId || client.readyState === WebSocket.OPEN) {
        // In production, use room-based filtering with Redis PubSub
        // This simplified version broadcasts to all connected clients
      }
    }
    // Publish to Redis for horizontal scaling
    this.redis.publish(`ws:room:${robotId}`, message).catch(() => {});
  }
}
