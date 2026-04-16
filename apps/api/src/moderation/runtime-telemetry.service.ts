import {
  Injectable,
  ForbiddenException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LivekitService } from '../livekit/livekit.service';
import { isStaffRole } from '../common/robot-access';

type ContainerMetricAccumulator = {
  service: string;
  containerName: string | null;
  cpuUsageSeconds: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  rxBytes: number;
  txBytes: number;
};

type CadvisorSample = {
  capturedAt: number;
  machineCpuCores: number | null;
  machineMemoryBytes: number | null;
  hostCpuUsageSeconds: number | null;
  hostMemoryUsageBytes: number | null;
  hostRxBytes: number;
  hostTxBytes: number;
  containers: Map<string, ContainerMetricAccumulator>;
};

@Injectable()
export class RuntimeTelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeTelemetryService.name);
  private previousCadvisorSample: CadvisorSample | null = null;
  private cadvisorWarmupInterval: ReturnType<typeof setInterval> | null = null;
  private cadvisorWarmupInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly livekit: LivekitService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    void this._warmCadvisorSample();
    this.cadvisorWarmupInterval = setInterval(() => {
      void this._warmCadvisorSample();
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.cadvisorWarmupInterval) {
      clearInterval(this.cadvisorWarmupInterval);
      this.cadvisorWarmupInterval = null;
    }
  }

  async getAdminRuntimeOverview(requesterId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester || !isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    const robots = await this.prisma.robot.findMany({
      orderBy: [{ status: 'asc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
      take: 120,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        visibility: true,
        queueMode: true,
        viewerCount: true,
        lastOnlineAt: true,
        createdAt: true,
        owner: { select: { id: true, username: true, displayName: true } },
      },
    });

    const robotIds = robots.map((robot) => robot.id);

    const [queueEntries, activeSessions, heartbeatRaw, telemetryRaw, livekitRuntime, cadvisorRuntime] = await Promise.all([
      robotIds.length === 0
        ? Promise.resolve([])
        : this.prisma.queueEntry.findMany({
            where: { robotId: { in: robotIds } },
            select: {
              robotId: true,
              userId: true,
              position: true,
              votes: true,
              isPriority: true,
              joinedAt: true,
              user: { select: { id: true, username: true, displayName: true } },
            },
          }),
      robotIds.length === 0
        ? Promise.resolve([])
        : this.prisma.session.findMany({
            where: { robotId: { in: robotIds }, status: 'ACTIVE' },
            select: {
              id: true,
              robotId: true,
              startedAt: true,
              user: { select: { id: true, username: true, displayName: true } },
            },
          }),
      robotIds.length === 0 ? Promise.resolve([]) : this.redis.mget(...robotIds.map((id) => `robot:heartbeat:${id}`)),
      robotIds.length === 0
        ? Promise.resolve([])
        : this.redis.mget(...robotIds.map((id) => `robot:telemetry:${id}:latest`)),
      this._getLivekitRuntime(),
      this._getCadvisorRuntime(),
    ]);

    const now = Date.now();

    const heartbeatByRobot = new Map<string, number | null>(
      robotIds.map((robotId, index) => {
        const raw = heartbeatRaw[index];
        const parsed = raw ? Number(raw) : NaN;
        return [robotId, Number.isFinite(parsed) ? parsed : null];
      }),
    );

    const telemetryByRobot = new Map<string, Record<string, unknown> | null>(
      robotIds.map((robotId, index) => {
        const raw = telemetryRaw[index];
        if (!raw) {
          return [robotId, null];
        }

        try {
          return [robotId, JSON.parse(raw) as Record<string, unknown>];
        } catch {
          return [robotId, null];
        }
      }),
    );

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
      const queue = [...(queueByRobot.get(robot.id) ?? [])].sort((left, right) =>
        this._compareQueueEntries(robot.queueMode, left, right),
      );
      const activeSession = activeSessionByRobot.get(robot.id) ?? null;
      const telemetryTs = this._asNumber(telemetry?.ts);

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
              clientVersion: this._asString(telemetry.clientVersion),
              botpartyStreamerVersion: this._asString(telemetry.botpartyStreamerVersion),
              gitBranch: this._asString(telemetry.gitBranch),
              gitCommit: this._asString(telemetry.gitCommit),
              gitDirty: Boolean(telemetry.gitDirty),
              pythonVersion: this._asString(telemetry.pythonVersion),
              cpuPercent: this._asNumber(telemetry.cpuPercent),
              memoryPercent: this._asNumber(telemetry.memoryPercent),
              temperatureC: this._asNumber(telemetry.temperatureC),
              uptimeSec: this._asNumber(telemetry.uptimeSec),
              controlConnected: Boolean(telemetry.controlConnected),
              livekitConnected: Boolean(telemetry.livekitConnected),
              commandsReceived: this._asNumber(telemetry.commandsReceived) ?? 0,
              cameraFrames: this._asNumber(telemetry.cameraFrames) ?? 0,
            }
          : null,
        livekit: room,
      };
    });

    const platformRuntime = this._mergePlatformRuntimeWithLivekit(cadvisorRuntime, livekitRuntime);

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

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async _getLivekitRuntime() {
    try {
      const rooms = await this.livekit.listRooms();
      const robotRooms = rooms.filter((room) => room.name.startsWith('robot-'));
      const mappedRooms = await Promise.all(
        robotRooms.map(async (room) => {
          const participants = await this.livekit.listParticipants(room.name);
          const participantSummaries = participants.map((participant) => ({
            identity: participant.identity,
            name: participant.name,
            isPublisher: participant.isPublisher,
            joinedAt: this._livekitTimestampToIso(participant.joinedAtMs, participant.joinedAt),
            trackCount: participant.tracks.length,
          }));
          const publishers = participants.filter((participant) => participant.isPublisher).length;
          const subscribers = participants.filter((participant) => !participant.identity.startsWith('robot-')).length;

          return {
            roomName: room.name,
            robotId: this._robotIdFromRoomName(room.name),
            sid: room.sid,
            participants: room.numParticipants,
            publishers: room.numPublishers || publishers,
            subscribers,
            activeRecording: room.activeRecording,
            createdAt: this._livekitTimestampToIso(room.creationTimeMs, room.creationTime),
            estimatedIngressKbps: Math.round(
              participants.reduce((sum, participant) => sum + this._estimateParticipantIngressBps(participant), 0) / 1000,
            ),
            participantNames: participantSummaries.map((participant) => participant.name || participant.identity).slice(0, 8),
            participantDetails: participantSummaries,
          };
        }),
      );

      return { error: null, rooms: mappedRooms };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'LiveKit runtime unavailable',
        rooms: [],
      };
    }
  }

  private _mergePlatformRuntimeWithLivekit(
    cadvisorRuntime: Awaited<ReturnType<RuntimeTelemetryService['_getCadvisorRuntime']>>,
    livekitRuntime: Awaited<ReturnType<RuntimeTelemetryService['_getLivekitRuntime']>>,
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

  private async _getCadvisorRuntime() {
    const cadvisorUrl = this.config.get<string>('CADVISOR_URL')?.trim();
    if (!cadvisorUrl) {
      return {
        available: false,
        error: 'CADVISOR_URL not configured',
        host: null,
        containers: [] as Array<{
          service: string;
          containerName: string | null;
          cpuPercent: number | null;
          memoryUsageBytes: number | null;
          memoryLimitBytes: number | null;
          memoryPercent: number | null;
          rxKbps: number | null;
          txKbps: number | null;
        }>,
      };
    }

    try {
      const response = await fetch(`${cadvisorUrl.replace(/\/$/, '')}/metrics`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        throw new Error(`cAdvisor returned ${response.status}`);
      }

      const text = await response.text();
      const current = this._parseCadvisorMetrics(text);
      const previous = this.previousCadvisorSample;
      this.previousCadvisorSample = current;

      const hostCpuPercent = this._computeCpuPercent(
        current.hostCpuUsageSeconds,
        previous?.hostCpuUsageSeconds ?? null,
        current.capturedAt,
        previous?.capturedAt ?? null,
        current.machineCpuCores,
      );
      const hostRxKbps = this._computeRateKbps(current.hostRxBytes, previous?.hostRxBytes ?? null, current.capturedAt, previous?.capturedAt ?? null);
      const hostTxKbps = this._computeRateKbps(current.hostTxBytes, previous?.hostTxBytes ?? null, current.capturedAt, previous?.capturedAt ?? null);

      const containers = Array.from(current.containers.values())
        .map((container) => {
          const previousContainer = previous?.containers.get(container.service) ?? null;
          const memoryLimitBytes =
            typeof container.memoryLimitBytes === 'number' && container.memoryLimitBytes > 0
              ? container.memoryLimitBytes
              : current.machineMemoryBytes;
          const memoryPercent =
            typeof container.memoryUsageBytes === 'number' && typeof memoryLimitBytes === 'number' && memoryLimitBytes > 0
              ? Number(((container.memoryUsageBytes / memoryLimitBytes) * 100).toFixed(1))
              : null;

          return {
            service: container.service,
            containerName: container.containerName,
            cpuPercent: this._computeCpuPercent(
              container.cpuUsageSeconds,
              previousContainer?.cpuUsageSeconds ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
              current.machineCpuCores,
            ),
            memoryUsageBytes: container.memoryUsageBytes,
            memoryLimitBytes,
            memoryPercent,
            rxKbps: this._computeRateKbps(
              container.rxBytes,
              previousContainer?.rxBytes ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
            ),
            txKbps: this._computeRateKbps(
              container.txBytes,
              previousContainer?.txBytes ?? null,
              current.capturedAt,
              previous?.capturedAt ?? null,
            ),
          };
        })
        .sort((left, right) => left.service.localeCompare(right.service));

      return {
        available: true,
        error: null,
        host: {
          cpuCores: current.machineCpuCores,
          memoryBytes: current.machineMemoryBytes,
          cpuPercent: hostCpuPercent,
          memoryUsageBytes: current.hostMemoryUsageBytes,
          memoryPercent:
            typeof current.hostMemoryUsageBytes === 'number' && typeof current.machineMemoryBytes === 'number' && current.machineMemoryBytes > 0
              ? Number(((current.hostMemoryUsageBytes / current.machineMemoryBytes) * 100).toFixed(1))
              : null,
          rxKbps: hostRxKbps,
          txKbps: hostTxKbps,
        },
        containers,
      };
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : 'cAdvisor unavailable',
        host: null,
        containers: [],
      };
    }
  }

  private async _warmCadvisorSample() {
    const cadvisorUrl = this.config.get<string>('CADVISOR_URL')?.trim();
    if (!cadvisorUrl || this.cadvisorWarmupInFlight) {
      return;
    }

    this.cadvisorWarmupInFlight = true;
    try {
      await this._getCadvisorRuntime();
    } catch (err) {
      this.logger.debug(`cAdvisor warmup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      this.cadvisorWarmupInFlight = false;
    }
  }

  private _parseCadvisorMetrics(text: string): CadvisorSample {
    const containers = new Map<string, ContainerMetricAccumulator>();
    const sample: CadvisorSample = {
      capturedAt: Date.now(),
      machineCpuCores: null,
      machineMemoryBytes: null,
      hostCpuUsageSeconds: null,
      hostMemoryUsageBytes: null,
      hostRxBytes: 0,
      hostTxBytes: 0,
      containers,
    };

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const parsed = this._parsePrometheusLine(line);
      if (!parsed) {
        continue;
      }

      const { metric, labels, value } = parsed;
      if (metric === 'machine_cpu_cores') {
        sample.machineCpuCores = value;
        continue;
      }
      if (metric === 'machine_memory_bytes') {
        sample.machineMemoryBytes = value;
        continue;
      }

      const id = labels.id ?? labels.name ?? '';
      const containerName = this._normalizeCadvisorContainerName(labels.name?.trim() || labels.container?.trim() || null);
      const service = this._resolveCadvisorService(labels, containerName);
      const interfaceName = labels.interface?.trim();

      if (id === '/') {
        if (metric === 'container_cpu_usage_seconds_total') {
          sample.hostCpuUsageSeconds = value;
        } else if (metric === 'container_memory_working_set_bytes') {
          sample.hostMemoryUsageBytes = value;
        } else if (metric === 'container_network_receive_bytes_total' && interfaceName !== 'lo') {
          sample.hostRxBytes += value;
        } else if (metric === 'container_network_transmit_bytes_total' && interfaceName !== 'lo') {
          sample.hostTxBytes += value;
        }
        continue;
      }

      if (!service) {
        continue;
      }

      const entry = containers.get(service) ?? {
        service,
        containerName,
        cpuUsageSeconds: null,
        memoryUsageBytes: null,
        memoryLimitBytes: null,
        rxBytes: 0,
        txBytes: 0,
      };
      if (!entry.containerName && containerName) {
        entry.containerName = containerName;
      }

      if (metric === 'container_cpu_usage_seconds_total') {
        entry.cpuUsageSeconds = value;
      } else if (metric === 'container_memory_working_set_bytes') {
        entry.memoryUsageBytes = value;
      } else if (metric === 'container_spec_memory_limit_bytes') {
        entry.memoryLimitBytes = value;
      } else if (metric === 'container_network_receive_bytes_total' && interfaceName !== 'lo') {
        entry.rxBytes += value;
      } else if (metric === 'container_network_transmit_bytes_total' && interfaceName !== 'lo') {
        entry.txBytes += value;
      }

      containers.set(service, entry);
    }

    return sample;
  }

  private _parsePrometheusLine(line: string): { metric: string; labels: Record<string, string>; value: number } | null {
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?:\s+[-+]?\d+)?$/,
    );
    if (!match) {
      return null;
    }

    const metric = match[1];
    const labelsRaw = match[3] ?? '';
    const value = Number(match[4]);
    if (!metric || !Number.isFinite(value)) {
      return null;
    }

    const labels: Record<string, string> = {};
    const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;
    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelPattern.exec(labelsRaw)) !== null) {
      const labelKey = labelMatch[1];
      const labelValue = labelMatch[2];
      if (!labelKey || labelValue === undefined) {
        continue;
      }
      labels[labelKey] = labelValue
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    return { metric, labels, value };
  }

  private _normalizeCadvisorContainerName(name: string | null): string | null {
    if (!name) {
      return null;
    }

    const normalized = name.trim().replace(/^\/+/, '');
    return normalized || null;
  }

  private _resolveCadvisorService(labels: Record<string, string>, containerName: string | null) {
    const composeProject = labels.container_label_com_docker_compose_project?.trim().toLowerCase() ?? '';
    const composeService = labels.container_label_com_docker_compose_service?.trim();
    const normalizedContainerName = containerName?.trim().toLowerCase() ?? '';
    const belongsToBotparty = composeProject.includes('botparty') || normalizedContainerName.includes('botparty');

    if (composeService && belongsToBotparty) {
      return this._matchKnownCadvisorService(composeService) ?? composeService;
    }

    if (!containerName || !belongsToBotparty) {
      return '';
    }

    return this._matchKnownCadvisorService(containerName) ?? containerName;
  }

  private _matchKnownCadvisorService(value: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/^\/+/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!normalized) {
      return null;
    }

    const knownServices = [
      'livekit-ingress',
      'livekit-egress',
      'livekit',
      'postgres',
      'redis',
      'cadvisor',
      'nginx',
      'api',
      'web',
    ] as const;

    for (const service of knownServices) {
      if (
        normalized === service ||
        normalized.endsWith(`-${service}`) ||
        normalized.startsWith(`${service}-`) ||
        normalized.includes(`-${service}-`)
      ) {
        return service;
      }
    }

    return null;
  }

  private _computeCpuPercent(
    currentValue: number | null,
    previousValue: number | null,
    currentTs: number,
    previousTs: number | null,
    machineCpuCores: number | null,
  ) {
    if (
      typeof currentValue !== 'number' ||
      typeof previousValue !== 'number' ||
      typeof previousTs !== 'number' ||
      typeof machineCpuCores !== 'number' ||
      machineCpuCores <= 0
    ) {
      return null;
    }

    const deltaSeconds = (currentTs - previousTs) / 1000;
    const deltaCpu = currentValue - previousValue;
    if (deltaSeconds <= 0 || deltaCpu < 0) {
      return null;
    }

    return Number(Math.max(0, Math.min(100, (deltaCpu / deltaSeconds / machineCpuCores) * 100)).toFixed(1));
  }

  private _computeRateKbps(
    currentValue: number,
    previousValue: number | null,
    currentTs: number,
    previousTs: number | null,
  ) {
    if (typeof previousValue !== 'number' || typeof previousTs !== 'number') {
      return null;
    }

    const deltaSeconds = (currentTs - previousTs) / 1000;
    const deltaBytes = currentValue - previousValue;
    if (deltaSeconds <= 0 || deltaBytes < 0) {
      return null;
    }

    return Number((((deltaBytes * 8) / 1000) / deltaSeconds).toFixed(1));
  }

  private _robotIdFromRoomName(roomName: string): string | null {
    if (!roomName.startsWith('robot-')) {
      return null;
    }

    const robotId = roomName.slice('robot-'.length).trim();
    return robotId || null;
  }

  private _livekitTimestampToIso(msValue?: bigint, secValue?: bigint): string | null {
    let timestampMs: bigint | null = null;

    if (typeof msValue === 'bigint' && msValue > 0n) {
      timestampMs = msValue;
    } else if (typeof secValue === 'bigint' && secValue > 0n) {
      timestampMs = secValue * 1000n;
    }

    if (timestampMs === null || timestampMs > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }

    return new Date(Number(timestampMs)).toISOString();
  }

  private _estimateParticipantIngressBps(participant: {
    tracks: Array<{
      layers?: Array<{ bitrate: number }>;
      codecs?: Array<{ layers?: Array<{ bitrate: number }> }>;
    }>;
  }): number {
    return participant.tracks.reduce((sum, track) => sum + this._estimateTrackBitrateBps(track), 0);
  }

  private _estimateTrackBitrateBps(track: {
    layers?: Array<{ bitrate: number }>;
    codecs?: Array<{ layers?: Array<{ bitrate: number }> }>;
  }): number {
    let bestBitrate = 0;

    for (const codec of track.codecs ?? []) {
      for (const layer of codec.layers ?? []) {
        if (typeof layer.bitrate === 'number' && Number.isFinite(layer.bitrate)) {
          bestBitrate = Math.max(bestBitrate, layer.bitrate);
        }
      }
    }

    if (bestBitrate > 0) {
      return bestBitrate;
    }

    for (const layer of track.layers ?? []) {
      if (typeof layer.bitrate === 'number' && Number.isFinite(layer.bitrate)) {
        bestBitrate = Math.max(bestBitrate, layer.bitrate);
      }
    }

    return bestBitrate;
  }

  private _compareQueueEntries(
    queueMode: string,
    left: {
      isPriority: boolean;
      votes: number;
      position: number;
      joinedAt: Date;
    },
    right: {
      isPriority: boolean;
      votes: number;
      position: number;
      joinedAt: Date;
    },
  ) {
    if (left.isPriority !== right.isPriority) {
      return left.isPriority ? -1 : 1;
    }

    if (queueMode === 'VOTING' && left.votes !== right.votes) {
      return right.votes - left.votes;
    }

    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.joinedAt.getTime() - right.joinedAt.getTime();
  }

  private _asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private _asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

}
