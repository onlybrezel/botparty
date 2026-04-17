import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { createRobotSchema, updateRobotSchema, LIMITS } from '@botparty/shared';
import { createHash, randomBytes } from 'crypto';
import { hash, verify } from 'argon2';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import type { Prisma } from '@botparty/prisma';
import { isStaffRole } from '../common/robot-access';
import { RobotTelemetryService } from './robot-telemetry.service';
import { RobotThumbnailService } from './robot-thumbnail.service';
import { RobotAccessService } from './robot-access.service';
import { RobotWebhookService } from './robot-webhook.service';
import { SLUG_PROFANITY_TERMS } from './profanity-terms';

export type GuestAccess = 'ALL' | 'AUTHENTICATED' | 'DISABLED';

export interface RobotAccessPolicy {
  video: GuestAccess;
  control: GuestAccess;
  chat: GuestAccess;
  estop: GuestAccess;
}

export interface RobotStreamPolicy {
  targetBitrateKbps: number | null;
  activeCameraId?: string;
  cameras?: RobotStreamCameraDescriptor[];
}

type RobotStreamCameraDescriptor = {
  id: string;
  label?: string;
  role?: string;
  enabled?: boolean;
  publishMode?: string;
};

type PublicRobotStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';

type RobotAuthMetadata = {
  auth?: {
    boundDeviceHash?: string;
  };
};

export interface PublicRobotOverview {
  totals: {
    publicRobots: number;
    liveRobots: number;
    featuredRobots: number;
    totalViewers: number;
    queueEntries: number;
  };
  statusBreakdown: {
    online: number;
    busy: number;
    offline: number;
    maintenance: number;
  };
  featured: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
    viewerCount: number;
    tags: string[];
    owner: {
      username: string;
      displayName: string | null;
    };
  }>;
  liveNow: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
    viewerCount: number;
    queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
    tags: string[];
    owner: {
      username: string;
      displayName: string | null;
    };
  }>;
  topTags: Array<{
    tag: string;
    count: number;
  }>;
}

export interface RoomAccessGrant {
  token: string;
  expiresAt: string;
}

export interface AllowedUserSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  addedAt: string;
}

export type RobotActionType =
  | 'restart_video'
  | 'restart_control'
  | 'restart_chat'
  | 'update_client'
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

const DEFAULT_ROBOT_CONTROLS = [
  { label: 'Forward', command: 'forward', hotKey: 'w', icon: '▲', position: 0 },
  { label: 'Left', command: 'left', hotKey: 'a', icon: '◀', position: 1 },
  { label: 'Back', command: 'backward', hotKey: 's', icon: '▼', position: 2 },
  { label: 'Right', command: 'right', hotKey: 'd', icon: '▶', position: 3 },
] as const;

const ROBOT_TEXT_PROFANITY_TERMS = Array.from(new Set(SLUG_PROFANITY_TERMS));

@Injectable()
export class RobotsService implements OnModuleDestroy {
  private readonly logger = new Logger(RobotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly telemetry: RobotTelemetryService,
    private readonly thumbnail: RobotThumbnailService,
    private readonly access: RobotAccessService,
    private readonly webhooks: RobotWebhookService,
    private readonly configService: ConfigService,
  ) {}

  onModuleDestroy() {
    // Lifecycle cleanup handled by sub-services.
  }

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>) {
    const data = createRobotSchema.parse(input);
    this.assertRobotTextAllowed(data);
    const metadata = this.withStreamKeyIssuedAt(
      this.withClaimTokenIssuedAt(this.mergeMetadata(null, data.acl, data.stream)),
    );
    const accessPassword = data.accessPassword;
    const baseData = this.stripRobotWriteFields(data);

    let slug = this.generateSlug(data.name);
    if (data.slug) {
      const nextSlug = this.validateAndNormalizeSlugInput(data.slug);
      const conflict = await this.prisma.robot.findUnique({ where: { slug: nextSlug }, select: { id: true } });
      if (conflict) {
        throw new ConflictException('This slug is already taken');
      }
      await this.reclaimSlugAlias(nextSlug);
      slug = nextSlug;
    }
    const streamKey = randomBytes(32).toString('hex');
    const claimToken = randomBytes(32).toString('hex');
    const passwordHash =
      data.accessMode === 'PASSWORD' && accessPassword
        ? await hash(accessPassword, { type: 2 })
        : null;
    const inviteCode = await this.resolveInviteCode({
      currentAccessMode: null,
      currentInviteCode: null,
      nextAccessMode: data.accessMode,
    });

    const robot = await this.prisma.robot.create({
      data: {
        ...baseData,
        accessPassword: passwordHash,
        inviteCode,
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

    await this.prisma.controlButton.createMany({
      data: DEFAULT_ROBOT_CONTROLS.map((button) => ({
        ...button,
        robotId: robot.id,
        cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
        access: 'QUEUE_TURN',
        isEnabled: true,
      })),
    });

    this.logger.log(`Robot created: ${robot.name} (${robot.slug}) by ${ownerId}`);
    return this.sanitizeManagedRobot(robot);
  }

  async findAll(filters?: { visibility?: string; status?: string; tag?: string; q?: string; sort?: string; limit?: string; offset?: string }) {
    const query = filters?.q?.trim();
    const sort = filters?.sort?.trim().toLowerCase();
    const take = Math.min(Math.max(Number(filters?.limit) || 50, 1), 200);
    const skip = Math.max(Number(filters?.offset) || 0, 0);

    const orderBy: Prisma.RobotOrderByWithRelationInput[] =
      sort === 'new'
        ? [{ createdAt: 'desc' }]
        : sort === 'sessions'
          ? [{ totalSessions: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }]
          : sort === 'name'
            ? [{ name: 'asc' }, { createdAt: 'desc' }]
            : [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }];

    const robots = await this.prisma.robot.findMany({
      where: {
        visibility: 'PUBLIC',
        ...(filters?.tag && { tags: { has: filters.tag } }),
        ...(query && {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { tags: { has: query } },
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
      take,
      skip,
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return robots
      .map((robot) => this.toPublicRobot(robot))
      .filter((robot) => !filters?.status || robot.status === filters.status);
  }

  async findBySlug(slug: string) {
    const robot = await this.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.visibility === 'PRIVATE') throw new NotFoundException('Robot not found');
    return this.toPublicRobot(robot);
  }

  async findByUsernameAndSlug(username: string, slug: string) {
    const robot = await this.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.visibility === 'PRIVATE') throw new NotFoundException('Robot not found');
    if (robot.owner.username.toLowerCase() !== username.trim().toLowerCase()) {
      throw new NotFoundException('Robot not found');
    }
    return this.toPublicRobot(robot);
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
    const robots = await this.prisma.robot.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    const normalizedRobots = await Promise.all(robots.map((robot) => this.ensureInviteCodeForManagedRobot(robot)));
    return normalizedRobots.map((robot) => this.sanitizeManagedRobot(robot));
  }

  async update(id: string, ownerId: string, input: z.infer<typeof updateRobotSchema>) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const data = updateRobotSchema.parse(input);
    this.assertRobotTextAllowed(data);
    const metadata = this.mergeMetadata(robot.metadata, data.acl, data.stream);
    const accessPassword = data.accessPassword;
    const baseData = this.stripRobotWriteFields(data);
    this.access.invalidateCache(id);

    let slugUpdate: { slug: string; slugAliases: { set: string[] } } | undefined;
    if (data.slug && data.slug !== robot.slug) {
      const nextSlug = this.validateAndNormalizeSlugInput(data.slug);
      const conflict = await this.prisma.robot.findFirst({ where: { slug: nextSlug, NOT: { id } }, select: { id: true } });
      if (conflict) throw new ConflictException('This slug is already taken');
      await this.reclaimSlugAlias(nextSlug, id);
      const currentAliases = Array.isArray((robot as { slugAliases?: string[] }).slugAliases)
        ? ((robot as { slugAliases?: string[] }).slugAliases ?? [])
        : [];
      slugUpdate = {
        slug: nextSlug,
        slugAliases: { set: Array.from(new Set([...currentAliases, robot.slug])) },
      };
    }

    const nextAccessMode = data.accessMode ?? robot.accessMode;
    const nextAccessPassword =
      nextAccessMode === 'PASSWORD'
        ? accessPassword
          ? await hash(accessPassword, { type: 2 })
          : robot.accessPassword
        : null;
    const nextInviteCode = await this.resolveInviteCode({
      currentAccessMode: robot.accessMode,
      currentInviteCode: robot.inviteCode,
      nextAccessMode,
    });

    const updated = await this.prisma.robot.update({
      where: { id },
      data: {
        ...baseData,
        accessPassword: nextAccessPassword,
        inviteCode: nextInviteCode,
        metadata: metadata as Prisma.InputJsonValue,
        ...slugUpdate,
      },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    return this.sanitizeManagedRobot(updated);
  }

  async updateByStaff(id: string, input: z.infer<typeof updateRobotSchema>) {
    const existing = await this.findById(id);
    const data = updateRobotSchema.parse(input);
    this.assertRobotTextAllowed(data);

    const current = await this.prisma.robot.findUnique({
      where: { id },
      select: { metadata: true },
    });

    const metadata = this.mergeMetadata(current?.metadata, data.acl, data.stream);
    const accessPassword = data.accessPassword;
    const baseData = this.stripRobotWriteFields(data);
    this.access.invalidateCache(id);
    const currentRobot = await this.prisma.robot.findUnique({
      where: { id },
      select: { accessMode: true, accessPassword: true, inviteCode: true },
    });
    const nextAccessMode = data.accessMode ?? currentRobot?.accessMode ?? 'OPEN';
    const nextAccessPassword =
      nextAccessMode === 'PASSWORD'
        ? accessPassword
          ? await hash(accessPassword, { type: 2 })
          : currentRobot?.accessPassword ?? null
        : null;
    const nextInviteCode = await this.resolveInviteCode({
      currentAccessMode: currentRobot?.accessMode ?? null,
      currentInviteCode: currentRobot?.inviteCode ?? null,
      nextAccessMode,
    });

    let slugUpdate: { slug: string; slugAliases: { set: string[] } } | undefined;
    if (data.slug && data.slug !== existing.slug) {
      const nextSlug = this.validateAndNormalizeSlugInput(data.slug);
      const conflict = await this.prisma.robot.findFirst({ where: { slug: nextSlug, NOT: { id } }, select: { id: true } });
      if (conflict) throw new ConflictException('This slug is already taken');
      await this.reclaimSlugAlias(nextSlug, id);
      const currentAliases = Array.isArray((existing as { slugAliases?: string[] }).slugAliases)
        ? ((existing as { slugAliases?: string[] }).slugAliases ?? [])
        : [];
      slugUpdate = {
        slug: nextSlug,
        slugAliases: { set: Array.from(new Set([...currentAliases, existing.slug])) },
      };
    }

    const updated = await this.prisma.robot.update({
      where: { id },
      data: {
        ...baseData,
        accessPassword: nextAccessPassword,
        inviteCode: nextInviteCode,
        metadata: metadata as Prisma.InputJsonValue,
        ...slugUpdate,
      },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    return this.sanitizeManagedRobot(updated);
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

  async upsertExternalStreamCamera(
    robotId: string,
    ownerId: string,
    camera: {
      id: string;
      label?: string;
      role?: string;
      enabled?: boolean;
      publishMode?: string;
    },
  ) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const cameraId = camera.id.trim();
    if (!cameraId) {
      throw new BadRequestException('camera id is required');
    }

    const stream = this.access.parseStreamFromMetadata(robot.metadata);
    const currentCameras = stream.cameras ?? [];
    const withoutCamera = currentCameras.filter((entry) => entry.id !== cameraId);

    const nextCamera: RobotStreamCameraDescriptor = {
      id: cameraId,
      label: camera.label?.trim() || undefined,
      role: camera.role?.trim() || undefined,
      enabled: camera.enabled ?? true,
      publishMode: camera.publishMode?.trim() || 'always_on',
    };

    const existingIndex = currentCameras.findIndex((entry) => entry.id === cameraId);
    const nextCameras = [...withoutCamera];
    if (existingIndex >= 0) {
      nextCameras.splice(Math.min(existingIndex, nextCameras.length), 0, nextCamera);
    } else {
      nextCameras.push(nextCamera);
    }
    const nextStream: RobotStreamPolicy = {
      targetBitrateKbps: stream.targetBitrateKbps,
      activeCameraId: stream.activeCameraId || nextCameras[0]?.id,
      cameras: nextCameras,
    };

    const metadata = this.mergeMetadata(robot.metadata, undefined, {
      targetBitrateKbps: nextStream.targetBitrateKbps ?? undefined,
      activeCameraId: nextStream.activeCameraId,
      cameras: nextStream.cameras,
    });
    this.access.invalidateCache(robotId);
    return this.prisma.robot.update({
      where: { id: robotId },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async removeExternalStreamCamera(robotId: string, ownerId: string, cameraId: string) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const normalizedCameraId = cameraId.trim();
    if (!normalizedCameraId) {
      return robot;
    }

    const stream = this.access.parseStreamFromMetadata(robot.metadata);
    const currentCameras = stream.cameras ?? [];
    const nextCameras = currentCameras.filter((entry) => entry.id !== normalizedCameraId);
    const nextStream: RobotStreamPolicy = {
      targetBitrateKbps: stream.targetBitrateKbps,
      activeCameraId:
        stream.activeCameraId && stream.activeCameraId !== normalizedCameraId
          ? stream.activeCameraId
          : nextCameras[0]?.id,
      cameras: nextCameras.length ? nextCameras : undefined,
    };

    const metadata = this.mergeMetadata(robot.metadata, undefined, {
      targetBitrateKbps: nextStream.targetBitrateKbps ?? undefined,
      activeCameraId: nextStream.activeCameraId,
      cameras: nextStream.cameras,
    });
    this.access.invalidateCache(robotId);
    return this.prisma.robot.update({
      where: { id: robotId },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async regenerateClaimToken(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const claimToken = randomBytes(32).toString('hex');
    return this.prisma.robot.update({
      where: { id },
      data: {
        claimToken,
        metadata: this.withClaimTokenIssuedAt(this.clearBoundDeviceMetadata(robot.metadata)) as Prisma.InputJsonValue,
      },
      select: { id: true, claimToken: true },
    });
  }

  async regenerateInviteCode(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    if (robot.accessMode !== 'LINK_ONLY') {
      throw new BadRequestException('Invite links are only used in link-only mode');
    }

    const inviteCode = await this.generateUniqueInviteCode();
    return this.prisma.robot.update({
      where: { id },
      data: { inviteCode },
      select: { id: true, inviteCode: true },
    });
  }

  async ensureInviteCode(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    if (robot.inviteCode) {
      return { id: robot.id, inviteCode: robot.inviteCode };
    }

    const inviteCode = await this.generateUniqueInviteCode();
    const updated = await this.prisma.robot.update({
      where: { id },
      data: { inviteCode },
      select: { id: true, inviteCode: true },
    });
    return updated;
  }

  async saveRobotThumbnail(id: string, ownerId: string, dataUrl: string) {
    return this.thumbnail.save(id, ownerId, dataUrl);
  }

  async clearRobotThumbnail(id: string, ownerId: string) {
    return this.thumbnail.clear(id, ownerId);
  }

  async readRobotThumbnail(id: string) {
    return this.thumbnail.read(id);
  }
  async findPrivateBySlugForUser(slug: string, requesterId: string) {
    const robot = await this.findRobotBySlugAny(slug);

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });

    const isStaff = isStaffRole(requester?.role);
    if (robot.visibility !== 'PRIVATE' && !isStaff && robot.ownerId !== requesterId) {
      throw new ForbiddenException('Robot is public');
    }

    if (robot.ownerId !== requesterId && !isStaff) {
      throw new ForbiddenException('Not allowed to access this robot');
    }

    return this.toPublicRobot(robot);
  }

  async findPrivateByUsernameAndSlugForUser(username: string, slug: string, requesterId: string) {
    const robot = await this.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.owner.username.toLowerCase() !== username.trim().toLowerCase()) {
      throw new NotFoundException('Robot not found');
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });
    const isStaff = requester?.role === 'ADMIN' || requester?.role === 'MOD';

    if (robot.visibility !== 'PRIVATE' && !isStaff && robot.ownerId !== requesterId) {
      throw new ForbiddenException('Robot is public');
    }

    if (robot.ownerId !== requesterId && !isStaff) {
      throw new ForbiddenException('Not allowed to access this robot');
    }

    return this.toPublicRobot(robot);
  }

  async getAllowedUsers(robotId: string, ownerId: string): Promise<AllowedUserSummary[]> {
    return this.access.getAllowedUsers(robotId, ownerId);
  }

  async addAllowedUser(robotId: string, ownerId: string, username: string): Promise<AllowedUserSummary> {
    return this.access.addAllowedUser(robotId, ownerId, username);
  }

  async removeAllowedUser(robotId: string, ownerId: string, userId: string) {
    return this.access.removeAllowedUser(robotId, ownerId, userId);
  }
  async updateStatus(id: string, status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE') {
    const previous = await this.prisma.robot.findUnique({
      where: { id },
      select: { status: true },
    });
    const updated = await this.prisma.robot.update({
      where: { id },
      data: {
        status,
        lastOnlineAt: status === 'ONLINE' ? new Date() : undefined,
      },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (previous?.status !== updated.status) {
      this.webhooks.emitRobotStatus(updated);
    }
    return updated;
  }

  async touchHeartbeat(id: string) {
    await this.prisma.robot.updateMany({
      where: {
        id,
        status: { in: ['ONLINE', 'BUSY'] },
      },
      data: {
        lastOnlineAt: new Date(),
      },
    });

    return { id };
  }

  async validateOrBindRobotDevice(robotId: string, deviceKey?: string | null) {
    const normalizedDeviceKey = deviceKey?.trim() ?? '';
    if (normalizedDeviceKey.length < 32) {
      throw new ForbiddenException('Valid robot device key required');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, metadata: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const deviceHash = this.hashDeviceKey(normalizedDeviceKey);
    const currentHash = this.readBoundDeviceHash(robot.metadata);
    if (currentHash && currentHash !== deviceHash) {
      throw new ForbiddenException('Claim token is bound to a different robot device');
    }

    if (!currentHash) {
      await this.prisma.robot.update({
        where: { id: robotId },
        data: {
          metadata: this.setBoundDeviceMetadata(robot.metadata, deviceHash) as Prisma.InputJsonValue,
        },
      });
    }

    return { robotId, deviceHash };
  }

  async findByClaimToken(claimToken: string) {
    const robot = await this.prisma.robot.findUnique({ where: { claimToken } });
    if (!robot) {
      return null;
    }

    const maxAgeDays = Number(this.configService.get<string>('ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS', '90'));
    if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
      return robot;
    }

    const tokenIssuedAt = this.readClaimTokenIssuedAt(robot.metadata) ?? robot.createdAt;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    if (Date.now() - tokenIssuedAt.getTime() > maxAgeMs) {
      this.logger.warn(`Rejected expired claim token for robot ${robot.id}`);
      return null;
    }

    return robot;
  }

  async enqueueAction(robotId: string, ownerId: string, payload: RobotActionPayload) {
    const robot = await this.findById(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    return this.enqueueActionForRobot(robotId, payload);
  }

  async enqueueActionForRobot(robotId: string, payload: RobotActionPayload) {
    await this.findById(robotId);

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

  async ingestRobotLogsByRobotId(robotId: string, lines: string[]) {
    await this.findById(robotId);
    return this.telemetry.ingestLogsByRobotId(robotId, lines);
  }

  async ingestRobotTelemetryByRobotId(
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
    await this.findById(robotId);
    return this.telemetry.ingestTelemetryByRobotId(robotId, payload);
  }

  async getRobotTelemetry(robotId: string, ownerId: string) {
    return this.telemetry.getTelemetry(robotId, ownerId);
  }

  async getRobotLogs(robotId: string, ownerId: string) {
    return this.telemetry.getLogs(robotId, ownerId);
  }

  async getAccessPolicy(robotId: string): Promise<RobotAccessPolicy> {
    return this.access.getAccessPolicy(robotId);
  }

  async getStreamPolicy(robotId: string): Promise<RobotStreamPolicy> {
    return this.access.getStreamPolicy(robotId);
  }
  async getFeatured() {
    const robots = await this.prisma.robot.findMany({
      where: { isFeatured: true, visibility: 'PUBLIC' },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return robots.map((robot) => this.toPublicRobot(robot));
  }

  async getPublicOverview(): Promise<PublicRobotOverview> {
    const publicRobots = await this.prisma.robot.findMany({
      where: { visibility: 'PUBLIC' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        viewerCount: true,
        lastOnlineAt: true,
        queueMode: true,
        isFeatured: true,
        tags: true,
        owner: {
          select: {
            username: true,
            displayName: true,
          },
        },
      },
      orderBy: [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
    });

    const normalizedRobots = publicRobots.map((robot) => ({
      ...robot,
      status: this.normalizeStatus(robot.status, robot.lastOnlineAt),
      viewerCount: this.normalizeViewerCount(robot.status, robot.lastOnlineAt, robot.viewerCount),
    }));
    const liveStatuses = new Set<string>(['ONLINE', 'BUSY']);
    const liveRobots = normalizedRobots.filter((robot) => liveStatuses.has(robot.status as string));
    const featuredRobots = normalizedRobots.filter((robot) => robot.isFeatured);
    const topTags = new Map<string, number>();

    for (const robot of normalizedRobots) {
      for (const tag of robot.tags) {
        const normalized = tag.trim();
        if (!normalized) {
          continue;
        }
        topTags.set(normalized, (topTags.get(normalized) ?? 0) + 1);
      }
    }

    const liveRobotIds = liveRobots.map((robot) => robot.id);
    const queueEntries = liveRobotIds.length
      ? await this.prisma.queueEntry.count({ where: { robotId: { in: liveRobotIds } } })
      : 0;

    return {
      totals: {
        publicRobots: normalizedRobots.length,
        liveRobots: liveRobots.length,
        featuredRobots: featuredRobots.length,
        totalViewers: normalizedRobots.reduce((sum, robot) => sum + robot.viewerCount, 0),
        queueEntries,
      },
      statusBreakdown: {
        online: normalizedRobots.filter((robot) => robot.status === 'ONLINE').length,
        busy: normalizedRobots.filter((robot) => robot.status === 'BUSY').length,
        offline: normalizedRobots.filter((robot) => robot.status === 'OFFLINE').length,
        maintenance: normalizedRobots.filter((robot) => robot.status === 'MAINTENANCE').length,
      },
      featured: featuredRobots.slice(0, 6).map((robot) => ({
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: robot.status,
        viewerCount: robot.viewerCount,
        tags: robot.tags,
        owner: robot.owner,
      })),
      liveNow: liveRobots.slice(0, 8).map((robot) => ({
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: robot.status,
        viewerCount: robot.viewerCount,
        queueMode: robot.queueMode,
        tags: robot.tags,
        owner: robot.owner,
      })),
      topTags: [...topTags.entries()]
        .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
        .slice(0, 12)
        .map(([tag, count]) => ({ tag, count })),
    };
  }

  async issueRoomAccessGrant(input: {
    robotId: string;
    requesterUserId: string | null;
    guestSessionId?: string;
    password?: string;
    inviteCode?: string;
  }): Promise<RoomAccessGrant> {
    return this.access.issueRoomAccessGrant(input);
  }

  async validateRoomAccess(input: {
    robotId: string;
    actorId: string;
    roomAccessToken?: string;
  }): Promise<boolean> {
    return this.access.validateRoomAccess(input);
  }

  async resolveRoomAccessActorId(robotId: string, roomAccessToken?: string): Promise<string | null> {
    return this.access.resolveRoomAccessActorId(robotId, roomAccessToken);
  }

  resolveGuestActorId(guestSessionId?: string): string | null {
    return this.access.resolveGuestActorId(guestSessionId);
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

  private generateSlug(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'robot'; // fallback for emoji-only or non-ASCII names
    const compact = base.replace(/-/g, '');
    const safeBase = SLUG_PROFANITY_TERMS.some((term) => compact.includes(term)) ? 'robot' : base;
    const suffix = randomBytes(3).toString('hex');
    return `${safeBase}-${suffix}`;
  }

  private mergeMetadata(
    current: unknown,
    acl?: { video?: GuestAccess; control?: GuestAccess; chat?: GuestAccess; estop?: GuestAccess },
    stream?: {
      targetBitrateKbps?: number;
      activeCameraId?: string;
      cameras?: RobotStreamCameraDescriptor[];
    },
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


  private stripRobotWriteFields<T extends { acl?: unknown; stream?: unknown; accessPassword?: unknown; slug?: unknown }>(
    data: T,
  ): Omit<T, 'acl' | 'stream' | 'accessPassword' | 'slug'> {
    const rest = {
      ...(data as T & {
        acl?: unknown;
        stream?: unknown;
        accessPassword?: unknown;
        slug?: unknown;
      }),
    };
    delete rest.acl;
    delete rest.stream;
    delete rest.accessPassword;
    delete rest.slug;
    return rest as Omit<T, 'acl' | 'stream' | 'accessPassword' | 'slug'>;
  }

  private withClaimTokenIssuedAt(metadata: unknown): Record<string, unknown> {
    const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
    base.claimTokenIssuedAt = new Date().toISOString();
    return base;
  }

  private withStreamKeyIssuedAt(metadata: unknown): Record<string, unknown> {
    const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
    base.streamKeyIssuedAt = new Date().toISOString();
    return base;
  }

  private readClaimTokenIssuedAt(metadata: unknown): Date | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const raw = (metadata as Record<string, unknown>).claimTokenIssuedAt;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return null;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  private validateAndNormalizeSlugInput(rawSlug: string): string {
    const slug = rawSlug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      throw new BadRequestException('Slug must be 3-50 lowercase alphanumeric characters and hyphens');
    }

    const compact = slug.replace(/-/g, '');
    if (SLUG_PROFANITY_TERMS.some((term) => compact.includes(term))) {
      throw new BadRequestException('Slug blocked by moderation policy');
    }

    return slug;
  }

  private assertRobotTextAllowed(input: {
    name?: string;
    description?: string;
    tags?: string[];
  }) {
    this.assertFieldModeration('name', input.name);
    this.assertFieldModeration('description', input.description);
    for (const tag of input.tags ?? []) {
      this.assertFieldModeration('tag', tag);
    }
  }

  private assertFieldModeration(field: 'name' | 'description' | 'tag', value?: string) {
    if (!value) {
      return;
    }

    const normalized = this.normalizeModerationText(value);
    if (!normalized) {
      return;
    }

    const compact = normalized.replace(/[\s_-]+/g, '');
    const blocked = ROBOT_TEXT_PROFANITY_TERMS.some((term) => {
      return normalized.includes(term) || compact.includes(term);
    });

    if (!blocked) {
      return;
    }

    if (field === 'tag') {
      throw new BadRequestException('One or more tags are blocked by moderation policy');
    }
    throw new BadRequestException(`${field} blocked by moderation policy`);
  }

  private normalizeModerationText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async reclaimSlugAlias(slug: string, excludeRobotId?: string) {
    const holders = await this.prisma.robot.findMany({
      where: {
        slugAliases: { has: slug },
        ...(excludeRobotId ? { NOT: { id: excludeRobotId } } : {}),
      },
      select: { id: true, slugAliases: true },
    });

    if (holders.length === 0) return;

    await this.prisma.$transaction(
      holders.map((row) =>
        this.prisma.robot.update({
          where: { id: row.id },
          data: {
            slugAliases: { set: (row.slugAliases ?? []).filter((entry) => entry !== slug) },
          },
        }),
      ),
    );
  }

  private async findRobotBySlugAny(slug: string) {
    const canonical = await this.prisma.robot.findUnique({
      where: { slug },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
        },
      },
    });
    if (canonical) return canonical;

    return this.prisma.robot.findFirst({
      where: { slugAliases: { has: slug } },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private sanitizeManagedRobot<T extends { accessPassword?: string | null }>(robot: T): T {
    return {
      ...robot,
      accessPassword: null,
    };
  }

  private async ensureInviteCodeForManagedRobot<
    T extends { id: string; accessMode: string; inviteCode?: string | null },
  >(robot: T): Promise<T> {
    if (robot.accessMode !== 'LINK_ONLY' || robot.inviteCode) {
      return robot;
    }

    const inviteCode = await this.generateUniqueInviteCode();
    await this.prisma.robot.update({
      where: { id: robot.id },
      data: { inviteCode },
    });

    return {
      ...robot,
      inviteCode,
    };
  }

  private toPublicRobot<
    T extends {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      thumbnailUrl: string | null;
      status: string;
      lastOnlineAt?: Date | null;
      visibility: string;
      accessMode: string;
      queueMode: string;
      scheduleStart?: Date | null;
      scheduleEnd?: Date | null;
      timezone?: string;
      maxTurnTime: number;
      maxViewers: number;
      maxControllers: number;
      metadata: unknown;
      tags: string[];
      viewerCount: number;
      createdAt: Date;
      owner?: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
    },
  >(robot: T) {
    return {
      id: robot.id,
      name: robot.name,
      slug: robot.slug,
      description: robot.description,
      thumbnailUrl: robot.thumbnailUrl,
      visibility: robot.visibility,
      accessMode: robot.accessMode,
      queueMode: robot.queueMode,
      scheduleStart: robot.scheduleStart ? robot.scheduleStart.toISOString() : null,
      scheduleEnd: robot.scheduleEnd ? robot.scheduleEnd.toISOString() : null,
      timezone: robot.timezone ?? 'UTC',
      maxTurnTime: robot.maxTurnTime,
      maxViewers: robot.maxViewers,
      maxControllers: robot.maxControllers,
      metadata:
        robot.metadata && typeof robot.metadata === 'object' && !Array.isArray(robot.metadata)
          ? robot.metadata
          : null,
      tags: robot.tags,
      status: this.normalizeStatus(robot.status, 'lastOnlineAt' in robot ? (robot as { lastOnlineAt?: Date | null }).lastOnlineAt ?? null : null),
      viewerCount: this.normalizeViewerCount(
        robot.status,
        'lastOnlineAt' in robot ? (robot as { lastOnlineAt?: Date | null }).lastOnlineAt ?? null : null,
        robot.viewerCount,
      ),
      owner: robot.owner
        ? {
            id: robot.owner.id,
            username: robot.owner.username,
            displayName: robot.owner.displayName,
            avatarUrl: robot.owner.avatarUrl,
          }
        : {
            id: '',
            username: 'unknown',
            displayName: null,
            avatarUrl: null,
          },
      createdAt: robot.createdAt.toISOString(),
    } as const;
  }

  private async resolveInviteCode(input: {
    currentAccessMode: string | null;
    currentInviteCode: string | null;
    nextAccessMode: string;
  }): Promise<string | null> {
    if (input.nextAccessMode !== 'LINK_ONLY') {
      return input.currentInviteCode ?? null;
    }

    if (input.currentAccessMode === 'LINK_ONLY' && input.currentInviteCode) {
      return input.currentInviteCode;
    }

    return this.generateUniqueInviteCode();
  }

  private async generateUniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = randomBytes(12).toString('hex');
      const existing = await this.prisma.robot.findUnique({
        where: { inviteCode },
        select: { id: true },
      });

      if (!existing) {
        return inviteCode;
      }
    }

    throw new Error('Failed to generate unique invite code');
  }

  private staleRobotCutoff(): Date {
    return new Date(Date.now() - 45_000);
  }

  private normalizeStatus(status: string, lastOnlineAt: Date | null | undefined): PublicRobotStatus {
    if (
      (status === 'ONLINE' || status === 'BUSY') &&
      (!lastOnlineAt || lastOnlineAt < this.staleRobotCutoff())
    ) {
      return 'OFFLINE';
    }
    if (status === 'ONLINE' || status === 'OFFLINE' || status === 'BUSY' || status === 'MAINTENANCE') {
      return status;
    }
    return 'OFFLINE';
  }

  private normalizeViewerCount(status: string, lastOnlineAt: Date | null | undefined, viewerCount: number) {
    return this.normalizeStatus(status, lastOnlineAt) === 'OFFLINE' ? 0 : Math.max(0, viewerCount);
  }

  private hashDeviceKey(deviceKey: string) {
    return createHash('sha256').update(deviceKey).digest('hex');
  }

  private readBoundDeviceHash(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const auth = (metadata as RobotAuthMetadata).auth;
    return typeof auth?.boundDeviceHash === 'string' && auth.boundDeviceHash.trim()
      ? auth.boundDeviceHash.trim()
      : null;
  }

  private setBoundDeviceMetadata(metadata: unknown, deviceHash: string): Record<string, unknown> {
    const existing =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...(metadata as Record<string, unknown>) }
        : {};
    const auth =
      existing.auth && typeof existing.auth === 'object' && !Array.isArray(existing.auth)
        ? { ...(existing.auth as Record<string, unknown>) }
        : {};
    auth.boundDeviceHash = deviceHash;
    existing.auth = auth;
    return existing;
  }

  private clearBoundDeviceMetadata(metadata: unknown): Record<string, unknown> {
    const existing =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...(metadata as Record<string, unknown>) }
        : {};
    if (!existing.auth || typeof existing.auth !== 'object' || Array.isArray(existing.auth)) {
      return existing;
    }

    const auth = { ...(existing.auth as Record<string, unknown>) };
    delete auth.boundDeviceHash;
    existing.auth = auth;
    return existing;
  }
}
