import { WS_EVENTS, WS_MIN_SUPPORTED_PROTOCOL_VERSION, WS_PROTOCOL_VERSION } from '@botparty/shared';
import type { QueueService } from '../queue/queue.service';
import type { RobotsService } from '../robots/robots.service';
import {
  emergencyStopSchema,
  emptyPayloadSchema,
  robotClaimSchema,
  robotTelemetrySchema,
} from './gateway-payloads';
import type { GatewayRuntimeSupport } from './gateway-runtime.support';
import type { WsClient } from './gateway-types';

type QueueSnapshot = Awaited<ReturnType<QueueService['getQueue']>>;

export class RobotRuntimeHandler {
  constructor(
    private readonly runtime: GatewayRuntimeSupport,
    private readonly robotsService: RobotsService,
    private readonly queueService: QueueService,
    private readonly syncTurnLifecycle: (robotId: string, queue: QueueSnapshot) => Promise<void>,
  ) {}

  async handleRobotClaim(client: WsClient, data: unknown) {
    const parsed = this.runtime.parseWsPayload(client, data, robotClaimSchema, 'Invalid robot claim payload');
    if (!parsed) {
      return;
    }
    client.protocolVersion = parsed.protocolVersion;

    try {
      const robotId = this.runtime.resolveRobotSocketIdentity(parsed.robotAuthToken);
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

      const existingRobotClient = this.runtime.getOpenRobotClient(robot.id);
      if (existingRobotClient && existingRobotClient !== client) {
        const claimLockTransferred = await this.runtime.transferRobotClaimLock(robot.id, existingRobotClient.id, client.id);
        if (!claimLockTransferred) {
          this.runtime.logger.warn(`Rejected duplicate robot claim for ${robot.id}`);
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

        this.runtime.logger.warn(`Replacing existing robot realtime socket for ${robot.id}`);
        this.runtime.robotClients.set(robot.id, client);
        try {
          existingRobotClient.close(1012, 'Replaced by newer robot claim');
        } catch {
          // Ignore close failures while replacing the previous socket.
        }
      } else {
        const claimLockAcquired = await this.runtime.acquireRobotClaimLock(robot.id, client.id);
        if (!claimLockAcquired) {
          this.runtime.logger.warn(`Rejected cross-instance duplicate robot claim for ${robot.id}`);
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
      }

      client.isRobot = true;
      client.robotId = robot.id;
      client.watchingRobotId = robot.id;
      this.runtime.robotClients.set(robot.id, client);

      await this.robotsService.updateStatus(robot.id, 'ONLINE');
      const queue = await this.queueService.getQueue(robot.id);
      await this.syncTurnLifecycle(robot.id, queue);
      this.runtime.broadcastToRoomLocally(robot.id, WS_EVENTS.QUEUE_UPDATE, { queue });
      this.runtime.broadcastToRoom(robot.id, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
      this.runtime.logger.log(`Robot claimed: ${robot.name} (${robot.id})`);

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
        await this.runtime.releaseRobotClaimLock(client.robotId, client.id);
      }
      this.runtime.logger.error('Robot claim error', err);
      return { event: WS_EVENTS.ERROR, data: { message: 'Claim failed' } };
    }
  }

  handleHeartbeat(client: WsClient) {
    if (client.robotId) {
      this.runtime.recordRobotHeartbeat(client.robotId, client.id);
      this.robotsService.touchHeartbeat(client.robotId).catch(() => {});
    }
    return { event: WS_EVENTS.ROBOT_HEARTBEAT, data: { ts: Date.now() } };
  }

  async handleTelemetry(client: WsClient, data: unknown) {
    const parsed = this.runtime.parseWsPayload(client, data, robotTelemetrySchema, 'Invalid telemetry payload');
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
      this.runtime.logger.warn(`Telemetry ingest failed for robot ${client.robotId}: ${(err as Error).message}`);
    }
  }

  async handleRobotActionsPull(client: WsClient, data?: unknown) {
    if (!this.runtime.parseWsPayload(client, data, emptyPayloadSchema, 'Invalid robot action poll payload')) {
      return;
    }

    if (!client.isRobot || !client.robotId) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Only robot clients can pull actions' } }));
      return;
    }

    try {
      const payload = await this.robotsService.consumeActionsByRobotId(client.robotId);
      client.send(JSON.stringify({ event: WS_EVENTS.ROBOT_ACTIONS, data: payload }));
    } catch (err) {
      this.runtime.logger.error('Failed to pull robot actions', err);
    }
  }

  async handleEmergencyStopMessage(client: WsClient, data: unknown) {
    const parsed = this.runtime.parseWsPayload(client, data, emergencyStopSchema, 'Invalid emergency stop payload');
    if (!parsed) {
      return;
    }

    if (client.watchingRobotId !== parsed.robotId || !client.userId) {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Join the room before using E-STOP' } }));
      return;
    }

    try {
      const access = await this.robotsService.getAccessPolicy(parsed.robotId);
      if (access.estop === 'DISABLED') {
        client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'E-STOP is disabled for this room' } }));
        return;
      }
      if (access.estop === 'AUTHENTICATED' && client.isGuest) {
        client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Please sign in to use E-STOP' } }));
        return;
      }

      this.runtime.triggerEmergencyStop(parsed.robotId, `Manual E-STOP by ${client.userId}`);
    } catch {
      client.send(JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Failed to validate E-STOP access' } }));
    }
  }
}
