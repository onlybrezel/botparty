import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { parseJsonRecord } from '../common/json-value';

@Injectable()
export class RobotTelemetryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async ingestLogsByRobotId(robotId: string, lines: string[]) {
    if (lines.length === 0) {
      return { ok: true };
    }

    const key = `robot:logs:${robotId}`;
    const now = Date.now();
    const pipeline = this.redis.pipeline();

    for (const line of lines.slice(-100)) {
      pipeline.rpush(key, JSON.stringify({ ts: now, line: line.slice(0, 1000) }));
    }

    pipeline.ltrim(key, -400, -1);
    pipeline.expire(key, 1800);
    await pipeline.exec();
    return { ok: true };
  }

  async ingestTelemetryByRobotId(
    robotId: string,
    payload: {
      clientVersion?: string | undefined;
      gitBranch?: string | undefined;
      gitCommit?: string | undefined;
      gitDirty?: boolean | undefined;
      botpartyStreamerVersion?: string | undefined;
      streamerVersion?: string | undefined;
      pythonVersion?: string | undefined;
      cpuPercent?: number | undefined;
      memoryPercent?: number | undefined;
      temperatureC?: number | undefined;
      uptimeSec?: number | undefined;
      controlConnected?: boolean | undefined;
      livekitConnected?: boolean | undefined;
      commandsReceived?: number | undefined;
      cameraFrames?: number | undefined;
      emergencyStopVerified?: boolean | undefined;
    },
  ) {
    const telemetry = {
      ts: Date.now(),
      clientVersion:
        typeof payload.clientVersion === 'string' && payload.clientVersion.trim()
          ? payload.clientVersion.trim().slice(0, 64)
          : null,
      gitBranch:
        typeof payload.gitBranch === 'string' && payload.gitBranch.trim()
          ? payload.gitBranch.trim().slice(0, 128)
          : null,
      gitCommit:
        typeof payload.gitCommit === 'string' && payload.gitCommit.trim()
          ? payload.gitCommit.trim().slice(0, 64)
          : null,
      gitDirty: Boolean(payload.gitDirty),
      botpartyStreamerVersion:
        typeof payload.botpartyStreamerVersion === 'string' && payload.botpartyStreamerVersion.trim()
          ? payload.botpartyStreamerVersion.trim().slice(0, 64)
          : typeof payload.streamerVersion === 'string' && payload.streamerVersion.trim()
            ? payload.streamerVersion.trim().slice(0, 64)
            : null,
      pythonVersion:
        typeof payload.pythonVersion === 'string' && payload.pythonVersion.trim()
          ? payload.pythonVersion.trim().slice(0, 64)
          : null,
      cpuPercent:
        typeof payload.cpuPercent === 'number' && Number.isFinite(payload.cpuPercent)
          ? Math.max(0, Math.min(100, payload.cpuPercent))
          : null,
      memoryPercent:
        typeof payload.memoryPercent === 'number' && Number.isFinite(payload.memoryPercent)
          ? Math.max(0, Math.min(100, payload.memoryPercent))
          : null,
      temperatureC:
        typeof payload.temperatureC === 'number' && Number.isFinite(payload.temperatureC)
          ? payload.temperatureC
          : null,
      uptimeSec:
        typeof payload.uptimeSec === 'number' && Number.isFinite(payload.uptimeSec)
          ? Math.max(0, Math.floor(payload.uptimeSec))
          : null,
      controlConnected: Boolean(payload.controlConnected),
      livekitConnected: Boolean(payload.livekitConnected),
      commandsReceived:
        typeof payload.commandsReceived === 'number' && Number.isFinite(payload.commandsReceived)
          ? Math.max(0, Math.floor(payload.commandsReceived))
          : 0,
      cameraFrames:
        typeof payload.cameraFrames === 'number' && Number.isFinite(payload.cameraFrames)
          ? Math.max(0, Math.floor(payload.cameraFrames))
          : 0,
      emergencyStopVerified: payload.emergencyStopVerified === true,
    };

    const latestKey = `robot:telemetry:${robotId}:latest`;
    const historyKey = `robot:telemetry:${robotId}:history`;
    const pipeline = this.redis.pipeline();
    pipeline.set(latestKey, JSON.stringify(telemetry), 'EX', 300);
    pipeline.rpush(historyKey, JSON.stringify(telemetry));
    pipeline.ltrim(historyKey, -300, -1);
    pipeline.expire(historyKey, 60 * 60 * 24);
    await pipeline.exec();

    return { ok: true };
  }

  async getTelemetry(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true },
    });
    if (!robot || robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

    const latestKey = `robot:telemetry:${robotId}:latest`;
    const historyKey = `robot:telemetry:${robotId}:history`;
    const [latestRaw, historyRaw] = await Promise.all([
      this.redis.get(latestKey),
      this.redis.lrange(historyKey, -120, -1),
    ]);

    const latest = latestRaw ? parseJsonRecord(latestRaw) : null;
    const history = historyRaw
      .map(parseJsonRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    return { latest, history };
  }

  async getLogs(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true },
    });
    if (!robot || robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

    const key = `robot:logs:${robotId}`;
    const raw = await this.redis.lrange(key, 0, -1);
    return raw
      .map((entry) => {
        try {
          const parsed = parseJsonRecord(entry);
          if (!parsed || typeof parsed['line'] !== 'string' || !parsed['line']) return null;
          return {
            ts: typeof parsed['ts'] === 'number' ? parsed['ts'] : Date.now(),
            line: parsed['line'],
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { ts: number; line: string } => entry !== null);
  }
}
