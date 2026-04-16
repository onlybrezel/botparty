import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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
      clientVersion?: string;
      gitBranch?: string;
      gitCommit?: string;
      gitDirty?: boolean;
      botpartyStreamerVersion?: string;
      streamerVersion?: string;
      pythonVersion?: string;
      cpuPercent?: number;
      memoryPercent?: number;
      temperatureC?: number;
      uptimeSec?: number;
      controlConnected?: boolean;
      livekitConnected?: boolean;
      commandsReceived?: number;
      cameraFrames?: number;
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
    if (!robot) throw new ForbiddenException('Robot not found');
    if (robot.ownerId !== ownerId) throw new ForbiddenException('Not your robot');

    const latestKey = `robot:telemetry:${robotId}:latest`;
    const historyKey = `robot:telemetry:${robotId}:history`;
    const [latestRaw, historyRaw] = await Promise.all([
      this.redis.get(latestKey),
      this.redis.lrange(historyKey, -120, -1),
    ]);

    const latest = latestRaw ? (JSON.parse(latestRaw) as Record<string, unknown>) : null;
    const history = historyRaw
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    return { latest, history };
  }

  async getLogs(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true },
    });
    if (!robot) throw new ForbiddenException('Robot not found');
    if (robot.ownerId !== ownerId) throw new ForbiddenException('Not your robot');

    const key = `robot:logs:${robotId}`;
    const raw = await this.redis.lrange(key, 0, -1);
    return raw
      .map((entry) => {
        try {
          const parsed = JSON.parse(entry) as { ts?: number; line?: string };
          if (!parsed.line) return null;
          return {
            ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
            line: parsed.line,
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { ts: number; line: string } => entry !== null);
  }
}
