import { Injectable } from '@nestjs/common';
import { RuntimeTelemetryDbService } from './runtime-telemetry-db.service';
import { RuntimeTelemetryGatewayService } from './runtime-telemetry-gateway.service';
import { RuntimeTelemetryLivekitService } from './runtime-telemetry-livekit.service';
import { RuntimeTelemetryCadvisorService } from './runtime-telemetry-cadvisor.service';

@Injectable()
export class RuntimeTelemetryService {
  constructor(
    private readonly db: RuntimeTelemetryDbService,
    private readonly gateway: RuntimeTelemetryGatewayService,
    private readonly livekit: RuntimeTelemetryLivekitService,
    private readonly cadvisor: RuntimeTelemetryCadvisorService,
  ) {}

  async getAdminRuntimeOverview(requesterId: string) {
    await this.db.getStaffRequester(requesterId);

    const robots = await this.db.getRobots();
    const robotIds = robots.map((robot) => robot.id);

    const [queueEntries, activeSessions, gatewayRuntime, livekitRuntime, cadvisorRuntime] = await Promise.all([
      this.db.getQueueEntries(robotIds),
      this.db.getActiveSessions(robotIds),
      this.gateway.getRobotRuntime(robotIds),
      this.livekit.getRuntime(),
      this.cadvisor.getRuntime(),
    ]);

    const now = Date.now();
    const heartbeatByRobot = gatewayRuntime.heartbeats;
    const telemetryByRobot = gatewayRuntime.telemetry;

    const queueByRobot = new Map<string, typeof queueEntries>();
    for (const entry of queueEntries) {
      const bucket = queueByRobot.get(entry.robotId) ?? [];
      bucket.push(entry);
      queueByRobot.set(entry.robotId, bucket);
    }

    const activeSessionByRobot = new Map(activeSessions.map((session) => [session.robotId, session]));
    const livekitRoomByRobot = new Map(
      livekitRuntime.rooms
        .filter((room) => room.robotId)
        .map((room) => [room.robotId as string, room]),
    );

    const robotRuntime = robots.map((robot) => {
      const telemetry = telemetryByRobot.get(robot.id);
      const heartbeatTs = heartbeatByRobot.get(robot.id);
      const room = livekitRoomByRobot.get(robot.id) ?? null;
      const queue = this.db.sortQueueEntries(robot.queueMode, queueByRobot.get(robot.id) ?? []);
      const activeSession = activeSessionByRobot.get(robot.id) ?? null;
      const telemetryTs = this.asNumber(telemetry?.ts);

      return {
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: robot.status,
        visibility: robot.visibility,
        queueMode: robot.queueMode,
        viewerCount: robot.viewerCount,
        owner: robot.owner,
        lastOnlineAt: robot.lastOnlineAt?.toISOString() ?? null,
        heartbeatAgeSec: heartbeatTs ? Math.max(0, Math.floor((now - heartbeatTs) / 1000)) : null,
        telemetryAgeSec: telemetryTs ? Math.max(0, Math.floor((now - telemetryTs) / 1000)) : null,
        queueLength: queue.length,
        queueHead:
          queue[0] ? { id: queue[0].user.id, username: queue[0].user.username, displayName: queue[0].user.displayName } : null,
        activeSession:
          activeSession
            ? {
                id: activeSession.id,
                startedAt: activeSession.startedAt.toISOString(),
                user: activeSession.user,
              }
            : null,
        telemetry: telemetry
          ? {
              ts: telemetryTs,
              clientVersion: this.asString(telemetry.clientVersion),
              botpartyStreamerVersion: this.asString(telemetry.botpartyStreamerVersion),
              gitBranch: this.asString(telemetry.gitBranch),
              gitCommit: this.asString(telemetry.gitCommit),
              gitDirty: Boolean(telemetry.gitDirty),
              pythonVersion: this.asString(telemetry.pythonVersion),
              cpuPercent: this.asNumber(telemetry.cpuPercent),
              memoryPercent: this.asNumber(telemetry.memoryPercent),
              temperatureC: this.asNumber(telemetry.temperatureC),
              uptimeSec: this.asNumber(telemetry.uptimeSec),
              controlConnected: Boolean(telemetry.controlConnected),
              livekitConnected: Boolean(telemetry.livekitConnected),
              commandsReceived: this.asNumber(telemetry.commandsReceived) ?? 0,
              cameraFrames: this.asNumber(telemetry.cameraFrames) ?? 0,
            }
          : null,
        livekit: room,
      };
    });

    const platformRuntime = this.mergePlatformRuntime(cadvisorRuntime, livekitRuntime);
    const cpuSamples = robotRuntime
      .map((robot) => robot.telemetry?.cpuPercent)
      .filter((value): value is number => typeof value === 'number');
    const memorySamples = robotRuntime
      .map((robot) => robot.telemetry?.memoryPercent)
      .filter((value): value is number => typeof value === 'number');

    return {
      generatedAt: new Date(now).toISOString(),
      summary: {
        totalRobots: robots.length,
        onlineRobots: robots.filter((robot) => robot.status === 'ONLINE').length,
        busyRobots: robots.filter((robot) => robot.status === 'BUSY').length,
        offlineRobots: robots.filter((robot) => robot.status === 'OFFLINE').length,
        maintenanceRobots: robots.filter((robot) => robot.status === 'MAINTENANCE').length,
        totalViewers: robots.reduce((sum, robot) => sum + robot.viewerCount, 0),
        queuedUsers: robotRuntime.reduce((sum, robot) => sum + robot.queueLength, 0),
        activeSessions: activeSessions.length,
        telemetryFreshRobots: robotRuntime.filter((robot) => typeof robot.telemetryAgeSec === 'number' && robot.telemetryAgeSec <= 180)
          .length,
        controlConnectedRobots: robotRuntime.filter((robot) => robot.telemetry?.controlConnected).length,
        livekitConnectedRobots: robotRuntime.filter((robot) => robot.telemetry?.livekitConnected).length,
        avgCpuPercent: cpuSamples.length > 0 ? Number((cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length).toFixed(1)) : null,
        avgMemoryPercent:
          memorySamples.length > 0
            ? Number((memorySamples.reduce((sum, value) => sum + value, 0) / memorySamples.length).toFixed(1))
            : null,
        totalIngressKbps: platformRuntime.containers.reduce((sum, container) => sum + (container.rxKbps ?? 0), 0),
        totalEgressKbps: platformRuntime.containers.reduce((sum, container) => sum + (container.txKbps ?? 0), 0),
      },
      platform: platformRuntime,
      livekit: {
        available: livekitRuntime.error === null,
        error: livekitRuntime.error,
        rooms: livekitRuntime.rooms,
        totals: {
          rooms: livekitRuntime.rooms.length,
          participants: livekitRuntime.rooms.reduce((sum, room) => sum + room.participants, 0),
          publishers: livekitRuntime.rooms.reduce((sum, room) => sum + room.publishers, 0),
          subscribers: livekitRuntime.rooms.reduce((sum, room) => sum + room.subscribers, 0),
          estimatedIngressKbps: livekitRuntime.rooms.reduce((sum, room) => sum + room.estimatedIngressKbps, 0),
        },
      },
      robots: robotRuntime,
    };
  }

  private asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private mergePlatformRuntime(
    cadvisorRuntime: Awaited<ReturnType<RuntimeTelemetryCadvisorService['getRuntime']>>,
    livekitRuntime: Awaited<ReturnType<RuntimeTelemetryLivekitService['getRuntime']>>,
  ) {
    if (!cadvisorRuntime.containers.length) {
      return cadvisorRuntime;
    }

    const livekitIngressKbps = livekitRuntime.rooms.reduce((sum, room) => sum + room.estimatedIngressKbps, 0);
    if (livekitIngressKbps <= 0) {
      return cadvisorRuntime;
    }

    return {
      ...cadvisorRuntime,
      containers: cadvisorRuntime.containers.map((container) => {
        if (container.service !== 'livekit') {
          return container;
        }

        const hasMeasuredIngress = typeof container.rxKbps === 'number' && container.rxKbps > 0;
        if (hasMeasuredIngress) {
          return container;
        }

        return {
          ...container,
          rxKbps: livekitIngressKbps,
        };
      }),
    };
  }
}
