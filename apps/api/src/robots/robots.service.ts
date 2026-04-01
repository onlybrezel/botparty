import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createRobotSchema, updateRobotSchema } from '@botparty/shared';
import { randomBytes } from 'crypto';
import type { z } from 'zod';
import type { Prisma } from '@botparty/prisma';

export type GuestAccess = 'ALL' | 'AUTHENTICATED' | 'DISABLED';

export interface RobotAccessPolicy {
  video: GuestAccess;
  control: GuestAccess;
  chat: GuestAccess;
}

export interface RobotStreamPolicy {
  targetBitrateKbps: number | null;
}

const DEFAULT_ACCESS_POLICY: RobotAccessPolicy = {
  video: 'AUTHENTICATED',
  control: 'AUTHENTICATED',
  chat: 'AUTHENTICATED',
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

  constructor(private readonly prisma: PrismaService) {}

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

  async findAll(filters?: { visibility?: string; status?: string; tag?: string }) {
    return this.prisma.robot.findMany({
      where: {
        visibility: 'PUBLIC',
        ...(filters?.status && { status: filters.status as 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE' }),
        ...(filters?.tag && { tags: { has: filters.tag } }),
      },
      orderBy: [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
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

  async delete(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    await this.prisma.robot.delete({ where: { id } });
    this.logger.log(`Robot deleted: ${robot.name}`);
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
    return this.prisma.robot.findMany({
      where: { isFeatured: true, visibility: 'PUBLIC' },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
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
    acl?: { video?: GuestAccess; control?: GuestAccess; chat?: GuestAccess },
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
    if (typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 8000) {
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
