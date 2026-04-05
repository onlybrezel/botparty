import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { createRobotSchema, updateRobotSchema } from '@botparty/shared';
import { randomBytes } from 'crypto';
import type { z } from 'zod';
import type { Prisma } from '@botparty/prisma';

export type GuestAccess = 'ALL' | 'AUTHENTICATED' | 'DISABLED';

export interface RobotAccessPolicy {
  video: GuestAccess;
  control: GuestAccess;
  chat: GuestAccess;
  estop: GuestAccess;
}

export interface RobotStreamPolicy {
  targetBitrateKbps: number | null;
}

export type RobotActionType =
  | 'restart_video'
  | 'restart_control'
  | 'restart_chat'
  | 'set_log_stream';

export interface RobotActionPayload {
  type: RobotActionType;
  durationSec?: number;
}

const DEFAULT_ACCESS_POLICY: RobotAccessPolicy = {
  video: 'AUTHENTICATED',
  control: 'AUTHENTICATED',
  chat: 'AUTHENTICATED',
  estop: 'AUTHENTICATED',
};

const DEFAULT_STREAM_POLICY: RobotStreamPolicy = {
  targetBitrateKbps: null,
};

type PolicyCacheEntry = {
  access: RobotAccessPolicy;
  stream: RobotStreamPolicy;
  expiresAt: number;
};

@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);
  private readonly policyCache = new Map<string, PolicyCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>) {
    const data = createRobotSchema.parse(input);
    const metadata = this.mergeMetadata(null, data.acl, data.stream);
    const { acl: _acl, stream: _stream, ...baseData } = data;

    const slug = this.generateSlug(data.name);
    const streamKey = randomBytes(32).toString('hex');
    const claimToken = randomBytes(32).toString('hex');

    const robot = await this.prisma.robot.create({
      data: {
        ...baseData,
        metadata: metadata as Prisma.InputJsonValue,
        slug,
        streamKey,
        claimToken,
        ownerId,
      },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    this.logger.log(`Robot created: ${robot.name} (${robot.slug}) by ${ownerId}`);
    return robot;
  }

  async findAll(filters?: { visibility?: string; status?: string; tag?: string; q?: string; sort?: string }) {
    await this.refreshStaleStatus();

    const query = filters?.q?.trim();
    const sort = filters?.sort?.trim().toLowerCase();

    const orderBy: Prisma.RobotOrderByWithRelationInput[] =
      sort === 'new'
        ? [{ createdAt: 'desc' }]
        : sort === 'sessions'
          ? [{ totalSessions: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }]
          : sort === 'name'
            ? [{ name: 'asc' }, { createdAt: 'desc' }]
            : [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }];

    return this.prisma.robot.findMany({
      where: {
        visibility: 'PUBLIC',
        ...(filters?.status && { status: filters.status as 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE' }),
        ...(filters?.tag && { tags: { has: filters.tag } }),
        ...(query && {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            {
              owner: {
                OR: [
                  { username: { contains: query, mode: 'insensitive' } },
                  { displayName: { contains: query, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }),
      },
      orderBy,
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    await this.refreshStaleStatus();

    const robot = await this.prisma.robot.findUnique({
      where: { slug },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
        },
      },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    return robot;
  }

  async findById(id: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    return robot;
  }

  async findByOwner(ownerId: string) {
    await this.refreshStaleStatus();

    return this.prisma.robot.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, ownerId: string, input: z.infer<typeof updateRobotSchema>) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const data = updateRobotSchema.parse(input);
    const metadata = this.mergeMetadata(robot.metadata, data.acl, data.stream);
    const { acl: _acl, stream: _stream, ...baseData } = data;
    this.policyCache.delete(id);

    return this.prisma.robot.update({
      where: { id },
      data: {
        ...baseData,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async updateByStaff(id: string, input: z.infer<typeof updateRobotSchema>) {
    await this.findById(id);
    const data = updateRobotSchema.parse(input);

    const current = await this.prisma.robot.findUnique({
      where: { id },
      select: { metadata: true },
    });

    const metadata = this.mergeMetadata(current?.metadata, data.acl, data.stream);
    const { acl: _acl, stream: _stream, ...baseData } = data;
    this.policyCache.delete(id);

    return this.prisma.robot.update({
      where: { id },
      data: {
        ...baseData,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async delete(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    await this.prisma.robot.delete({ where: { id } });
    this.logger.log(`Robot deleted: ${robot.name}`);
  }

  async deleteByStaff(id: string) {
    const robot = await this.findById(id);
    await this.prisma.robot.delete({ where: { id } });
    this.logger.log(`Robot deleted by staff: ${robot.name}`);
  }

  async regenerateClaimToken(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const claimToken = randomBytes(32).toString('hex');
    return this.prisma.robot.update({
      where: { id },
      data: { claimToken },
      select: { id: true, claimToken: true },
    });
  }

  async updateStatus(id: string, status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE') {
    return this.prisma.robot.update({
      where: { id },
      data: {
        status,
        lastOnlineAt: status === 'ONLINE' ? new Date() : undefined,
      },
    });
  }

  async touchHeartbeat(id: string) {
    return this.prisma.robot.update({
      where: { id },
      data: {
        status: 'ONLINE',
        lastOnlineAt: new Date(),
      },
      select: { id: true },
    });
  }

  async findByClaimToken(claimToken: string) {
    return this.prisma.robot.findUnique({ where: { claimToken } });
  }

  async enqueueAction(robotId: string, ownerId: string, payload: RobotActionPayload) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const key = `robot:actions:${robotId}`;
    const queued = await this.redis.lrange(key, 0, -1);
    const existing = queued
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.type === payload.type);

    if (existing) {
      return {
        id: typeof existing.id === 'string' ? existing.id : randomBytes(8).toString('hex'),
        type: String(existing.type),
        createdAt: typeof existing.createdAt === 'number' ? existing.createdAt : Date.now(),
        alreadyQueued: true,
      };
    }

    const action = {
      id: randomBytes(8).toString('hex'),
      type: payload.type,
      durationSec: payload.durationSec,
      createdAt: Date.now(),
      alreadyQueued: false,
    };

    if (payload.type === 'set_log_stream') {
      await this.redis.del(`robot:logs:${robotId}`);
    }
    await this.redis.rpush(key, JSON.stringify(action));
    await this.redis.ltrim(key, -50, -1);
    await this.redis.expire(key, 900);
    return action;
  }

  async getPendingActions(robotId: string, ownerId: string) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const raw = await this.redis.lrange(`robot:actions:${robotId}`, 0, -1);
    const actions = raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    return { robotId, actions };
  }

  async consumeActionsByClaimToken(claimToken: string) {
    const robot = await this.findByClaimToken(claimToken);
    if (!robot) {
      throw new ForbiddenException('Invalid claim token');
    }

    return this.consumeActionsByRobotId(robot.id);
  }

  async consumeActionsByRobotId(robotId: string) {
    const robot = await this.findById(robotId);

    const key = `robot:actions:${robot.id}`;
    const raw = await this.redis.lrange(key, 0, -1);
    const stream = await this.getStreamPolicy(robot.id);

    if (raw.length === 0) {
      return {
        robotId: robot.id,
        stream,
        actions: [] as Array<Record<string, unknown>>,
      };
    }

    await this.redis.del(key);
    const actions = raw
      .map((entry) => {
        try {
          const parsed = JSON.parse(entry) as Record<string, unknown>;
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);

    return { robotId: robot.id, stream, actions };
  }

  async ingestRobotLogs(claimToken: string, lines: string[]) {
    const robot = await this.findByClaimToken(claimToken);
    if (!robot) {
      throw new ForbiddenException('Invalid claim token');
    }

    if (lines.length === 0) {
      return { ok: true };
    }

    const key = `robot:logs:${robot.id}`;
    const now = Date.now();
    const pipeline = this.redis.pipeline();

    for (const line of lines.slice(-100)) {
      pipeline.rpush(
        key,
        JSON.stringify({
          ts: now,
          line: line.slice(0, 1000),
        }),
      );
    }

    pipeline.ltrim(key, -400, -1);
    pipeline.expire(key, 1800);
    await pipeline.exec();
    return { ok: true };
  }

  async ingestRobotTelemetry(
    claimToken: string,
    payload: {
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
    const robot = await this.findByClaimToken(claimToken);
    if (!robot) {
      throw new ForbiddenException('Invalid claim token');
    }

    const telemetry = {
      ts: Date.now(),
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

    const latestKey = `robot:telemetry:${robot.id}:latest`;
    const historyKey = `robot:telemetry:${robot.id}:history`;
    const pipeline = this.redis.pipeline();
    pipeline.set(latestKey, JSON.stringify(telemetry), 'EX', 300);
    pipeline.rpush(historyKey, JSON.stringify(telemetry));
    pipeline.ltrim(historyKey, -300, -1);
    pipeline.expire(historyKey, 60 * 60 * 24);
    await pipeline.exec();

    return { ok: true };
  }

  async getRobotTelemetry(robotId: string, ownerId: string) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const latestKey = `robot:telemetry:${robotId}:latest`;
    const historyKey = `robot:telemetry:${robotId}:history`;
    const [latestRaw, historyRaw] = await Promise.all([
      this.redis.get(latestKey),
      this.redis.lrange(historyKey, -120, -1),
    ]);

    const latest = latestRaw
      ? (JSON.parse(latestRaw) as Record<string, unknown>)
      : null;

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

  async getRobotLogs(robotId: string, ownerId: string) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

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

  async getAccessPolicy(robotId: string): Promise<RobotAccessPolicy> {
    const cached = this.policyCache.get(robotId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.access;
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { metadata: true },
    });

    const access = this.parseAccessFromMetadata(robot?.metadata);
    const stream = this.parseStreamFromMetadata(robot?.metadata);

    this.policyCache.set(robotId, {
      access,
      stream,
      expiresAt: now + 5000,
    });

    return access;
  }

  async getStreamPolicy(robotId: string): Promise<RobotStreamPolicy> {
    const cached = this.policyCache.get(robotId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.stream;
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { metadata: true },
    });

    const access = this.parseAccessFromMetadata(robot?.metadata);
    const stream = this.parseStreamFromMetadata(robot?.metadata);

    this.policyCache.set(robotId, {
      access,
      stream,
      expiresAt: now + 5000,
    });

    return stream;
  }

  async getFeatured() {
    await this.refreshStaleStatus();

    return this.prisma.robot.findMany({
      where: { isFeatured: true, visibility: 'PUBLIC' },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async setViewerCount(robotId: string, viewerCount: number) {
    await this.prisma.robot.update({
      where: { id: robotId },
      data: {
        viewerCount: Math.max(0, viewerCount),
      },
      select: { id: true },
    });
  }

  private async refreshStaleStatus() {
    const staleBefore = new Date(Date.now() - 45_000);
    await this.prisma.robot.updateMany({
      where: {
        status: { in: ['ONLINE', 'BUSY'] },
        OR: [{ lastOnlineAt: null }, { lastOnlineAt: { lt: staleBefore } }],
      },
      data: {
        status: 'OFFLINE',
        viewerCount: 0,
      },
    });
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }

  private mergeMetadata(
    current: unknown,
    acl?: { video?: GuestAccess; control?: GuestAccess; chat?: GuestAccess; estop?: GuestAccess },
    stream?: { targetBitrateKbps?: number },
  ): Record<string, unknown> {
    const existing =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};

    if (acl) {
      existing.access = {
        ...DEFAULT_ACCESS_POLICY,
        ...((existing.access as Record<string, unknown>) ?? {}),
        ...acl,
      };
    }

    if (stream) {
      existing.stream = {
        ...DEFAULT_STREAM_POLICY,
        ...((existing.stream as Record<string, unknown>) ?? {}),
        ...stream,
      };
    }

    return existing;
  }

  private parseAccessFromMetadata(metadata: unknown): RobotAccessPolicy {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return DEFAULT_ACCESS_POLICY;
    }
    const accessRaw = (metadata as Record<string, unknown>).access;
    if (!accessRaw || typeof accessRaw !== 'object' || Array.isArray(accessRaw)) {
      return DEFAULT_ACCESS_POLICY;
    }

    const access = accessRaw as Record<string, unknown>;
    return {
      video: this.readAccessValue(access.video),
      control: this.readAccessValue(access.control),
      chat: this.readAccessValue(access.chat),
      estop: this.readAccessValue(access.estop),
    };
  }

  private parseStreamFromMetadata(metadata: unknown): RobotStreamPolicy {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return DEFAULT_STREAM_POLICY;
    }
    const streamRaw = (metadata as Record<string, unknown>).stream;
    if (!streamRaw || typeof streamRaw !== 'object' || Array.isArray(streamRaw)) {
      return DEFAULT_STREAM_POLICY;
    }

    const stream = streamRaw as Record<string, unknown>;
    const bitrate = stream.targetBitrateKbps;
    if (typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 3000) {
      return { targetBitrateKbps: Math.round(bitrate) };
    }

    return DEFAULT_STREAM_POLICY;
  }

  private readAccessValue(value: unknown): GuestAccess {
    if (value === 'ALL' || value === 'AUTHENTICATED' || value === 'DISABLED') {
      return value;
    }
    return 'AUTHENTICATED';
  }
}
