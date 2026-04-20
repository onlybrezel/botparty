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
import { randomBytes } from 'crypto';
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
import { RobotDeviceService } from './robot-device.service';
import { RobotSlugService } from './robot-slug.service';
import { RobotInviteService } from './robot-invite.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { mergeRobotMetadata, normalizeRobotMetadata } from './robot-metadata.schema';
import { RobotCameraService } from './robot-camera.service';
import { RobotActionQueueService } from './robot-action-queue.service';

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

export interface ChatHistoryMessage {
  userId: string;
  username: string;
  content: string;
  timestamp: number;
}

export interface ChatHistoryPage {
  messages: ChatHistoryMessage[];
  nextCursor: number | null;
  hasMore: boolean;
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
const REALTIME_ROBOT_CACHE_TTL_SEC = 30;

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
    private readonly chatPersistence: ChatPersistenceService,
    private readonly configService: ConfigService,
    private readonly deviceService: RobotDeviceService,
    private readonly slugService: RobotSlugService,
    private readonly inviteService: RobotInviteService,
    private readonly cameraService: RobotCameraService,
    private readonly actionQueueService: RobotActionQueueService,
  ) {}

  onModuleDestroy() {
    // Lifecycle cleanup handled by sub-services.
  }

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>) {
    const data = createRobotSchema.parse(input);
    this.assertRobotTextAllowed(data);
    const metadata = this.withStreamKeyIssuedAt(
      this.deviceService.withClaimTokenIssuedAt(this.mergeMetadata(null, data.acl, data.stream)),
    );
    const accessPassword = data.accessPassword;
    const baseData = this.stripRobotWriteFields(data);

    let slug = this.slugService.generateSlug(data.name);
    if (data.slug) {
      const nextSlug = this.slugService.validateAndNormalizeSlugInput(data.slug);
      const conflict = await this.prisma.robot.findUnique({ where: { slug: nextSlug }, select: { id: true } });
      if (conflict) {
        throw new ConflictException('This slug is already taken');
      }
      await this.slugService.reclaimSlugAlias(nextSlug);
      slug = nextSlug;
    }
    const streamKey = randomBytes(32).toString('hex');
    const claimToken = randomBytes(32).toString('hex');
    const passwordHash =
      data.accessMode === 'PASSWORD' && accessPassword
        ? await hash(accessPassword, { type: 2 })
        : null;
    const inviteCode = await this.inviteService.resolveInviteCode({
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
    const normalizedStatus = filters?.status?.trim().toUpperCase();
    const statusFilter =
      normalizedStatus === 'ONLINE' ||
      normalizedStatus === 'OFFLINE' ||
      normalizedStatus === 'BUSY' ||
      normalizedStatus === 'MAINTENANCE'
        ? normalizedStatus
        : undefined;
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
        ...(statusFilter && { status: statusFilter }),
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

    return robots.map((robot) => this.toPublicRobot(robot));
  }

  async findBySlug(slug: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.visibility === 'PRIVATE') throw new NotFoundException('Robot not found');
    return this.toPublicRobot(robot);
  }

  async findByUsernameAndSlug(username: string, slug: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
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
    const normalizedRobots = await Promise.all(robots.map((robot) => this.inviteService.ensureInviteCodeForManagedRobot(robot)));
    return normalizedRobots.map((robot) => this.sanitizeManagedRobot(robot));
  }

  async update(id: string, ownerId: string, input: z.infer<typeof updateRobotSchema>) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    return this.applyRobotUpdate(robot, input);
  }

  async updateByStaff(id: string, input: z.infer<typeof updateRobotSchema>) {
    const existing = await this.findById(id);
    return this.applyRobotUpdate(existing, input);
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
    return this.cameraService.upsertExternalStreamCamera(robotId, ownerId, camera);
  }

  async removeExternalStreamCamera(robotId: string, ownerId: string, cameraId: string) {
    return this.cameraService.removeExternalStreamCamera(robotId, ownerId, cameraId);
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
        metadata: this.deviceService.withClaimTokenIssuedAt(this.deviceService.clearBoundDeviceMetadata(robot.metadata)) as Prisma.InputJsonValue,
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

    const inviteCode = await this.inviteService.generateUniqueInviteCode();
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

    const inviteCode = await this.inviteService.generateUniqueInviteCode();
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
    const robot = await this.slugService.findRobotBySlugAny(slug);

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    await this.assertPrivateAccessForRequester(robot, requesterId);

    return this.toPublicRobot(robot);
  }

  async findPrivateByUsernameAndSlugForUser(username: string, slug: string, requesterId: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.owner.username.toLowerCase() !== username.trim().toLowerCase()) {
      throw new NotFoundException('Robot not found');
    }

    await this.assertPrivateAccessForRequester(robot, requesterId);

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
      await this.redis.del(this.publicOverviewCacheKey());
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
    return this.deviceService.validateOrBindRobotDevice(robotId, deviceKey);
  }

  async findByClaimToken(claimToken: string) {
    return this.deviceService.findByClaimToken(claimToken);
  }

  async enqueueAction(robotId: string, ownerId: string, payload: RobotActionPayload) {
    return this.actionQueueService.enqueueAction(robotId, ownerId, payload);
  }

  async enqueueActionForRobot(robotId: string, payload: RobotActionPayload) {
    return this.actionQueueService.enqueueActionForRobot(robotId, payload);
  }

  async getPendingActions(robotId: string, ownerId: string) {
    return this.actionQueueService.getPendingActions(robotId, ownerId);
  }

  async consumeActionsByRobotId(robotId: string) {
    return this.actionQueueService.consumeActionsByRobotId(robotId);
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

  async findByIdCached(id: string): Promise<Awaited<ReturnType<RobotsService['findById']>>> {
    const cacheKey = this.realtimeRobotCacheKey(id);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Awaited<ReturnType<RobotsService['findById']>>;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const robot = await this.findById(id);
    await this.redis.set(cacheKey, JSON.stringify(robot), 'EX', REALTIME_ROBOT_CACHE_TTL_SEC);
    return robot;
  }

  async appendChatMessage(robotId: string, userId: string | null | undefined, content: string, timestampMs: number) {
    if (!userId || userId.startsWith('guest:')) {
      return;
    }

    await this.chatPersistence.enqueue({
      robotId,
      userId,
      content,
      timestampMs,
    });
  }

  async getRecentChatMessages(robotId: string, limit = LIMITS.CHAT_HISTORY_ON_JOIN): Promise<ChatHistoryMessage[]> {
    const clampedLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        robotId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: clampedLimit,
      select: {
        userId: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    return rows.reverse().map((row) => ({
      userId: row.userId,
      username: row.user.username,
      content: row.content,
      timestamp: row.createdAt.getTime(),
    }));
  }

  async getChatHistoryPage(input: {
    robotId: string;
    requesterUserId: string | null;
    guestSessionId?: string;
    roomAccessToken?: string;
    before?: number;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: input.robotId },
      select: { id: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const access = await this.access.getAccessPolicy(input.robotId);
    if (access.chat === 'DISABLED') {
      throw new ForbiddenException('Chat is disabled for this room');
    }

    const actorId = input.requesterUserId
      ?? this.access.resolveGuestActorId(input.guestSessionId)
      ?? 'guest:chat-history';

    const canAccessRoom = await this.access.validateRoomAccess({
      robotId: input.robotId,
      actorId,
      roomAccessToken: input.roomAccessToken,
    });
    if (!canAccessRoom) {
      throw new ForbiddenException('Room access verification required');
    }

    if (access.chat === 'AUTHENTICATED' && !input.requesterUserId) {
      throw new ForbiddenException('Sign in to read chat history');
    }

    const clampedLimit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const beforeDate =
      typeof input.before === 'number' && Number.isFinite(input.before)
        ? new Date(input.before)
        : null;

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        robotId: input.robotId,
        deletedAt: null,
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: clampedLimit + 1,
      select: {
        userId: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    const hasMore = rows.length > clampedLimit;
    const pageRows = hasMore ? rows.slice(0, clampedLimit) : rows;
    const messages = pageRows.reverse().map((row) => ({
      userId: row.userId,
      username: row.user.username,
      content: row.content,
      timestamp: row.createdAt.getTime(),
    }));

    return {
      messages,
      nextCursor: hasMore && messages.length > 0 ? messages[0]!.timestamp : null,
      hasMore,
    };
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
    const cacheKey = this.publicOverviewCacheKey();
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PublicRobotOverview;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const staleCutoff = this.staleRobotCutoff();

    const [aggregateRows, queueEntries, topTagRows, featuredRows, liveRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        publicRobots: number | bigint;
        liveRobots: number | bigint;
        featuredRobots: number | bigint;
        totalViewers: number | bigint;
        online: number | bigint;
        busy: number | bigint;
        offline: number | bigint;
        maintenance: number | bigint;
      }>>`
        SELECT
          COUNT(*)::int AS "publicRobots",
          SUM(CASE WHEN "status" IN ('ONLINE', 'BUSY') AND "lastOnlineAt" >= ${staleCutoff} THEN 1 ELSE 0 END)::int AS "liveRobots",
          SUM(CASE WHEN "isFeatured" THEN 1 ELSE 0 END)::int AS "featuredRobots",
          SUM(
            CASE
              WHEN "status" = 'MAINTENANCE' THEN GREATEST("viewerCount", 0)
              WHEN "status" IN ('ONLINE', 'BUSY') AND "lastOnlineAt" >= ${staleCutoff} THEN GREATEST("viewerCount", 0)
              ELSE 0
            END
          )::int AS "totalViewers",
          SUM(CASE WHEN "status" = 'ONLINE' AND "lastOnlineAt" >= ${staleCutoff} THEN 1 ELSE 0 END)::int AS "online",
          SUM(CASE WHEN "status" = 'BUSY' AND "lastOnlineAt" >= ${staleCutoff} THEN 1 ELSE 0 END)::int AS "busy",
          SUM(CASE WHEN "status" = 'OFFLINE' OR ("status" IN ('ONLINE', 'BUSY') AND ("lastOnlineAt" IS NULL OR "lastOnlineAt" < ${staleCutoff})) THEN 1 ELSE 0 END)::int AS "offline",
          SUM(CASE WHEN "status" = 'MAINTENANCE' THEN 1 ELSE 0 END)::int AS "maintenance"
        FROM "robots"
        WHERE "visibility" = 'PUBLIC'
      `,
      this.prisma.queueEntry.count({
        where: {
          robot: {
            visibility: 'PUBLIC',
            status: { in: ['ONLINE', 'BUSY'] },
            lastOnlineAt: { gte: staleCutoff },
          },
        },
      }),
      this.prisma.$queryRaw<Array<{ tag: string; count: number | bigint }>>`
        SELECT
          BTRIM(tag) AS tag,
          COUNT(*)::int AS count
        FROM "robots"
        CROSS JOIN LATERAL UNNEST("tags") AS tag_table(tag)
        WHERE "visibility" = 'PUBLIC'
          AND BTRIM(tag) <> ''
        GROUP BY BTRIM(tag)
        ORDER BY COUNT(*) DESC, BTRIM(tag) ASC
        LIMIT 12
      `,
      this.prisma.robot.findMany({
        where: { visibility: 'PUBLIC', isFeatured: true },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          viewerCount: true,
          lastOnlineAt: true,
          tags: true,
          owner: {
            select: {
              username: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ viewerCount: 'desc' }, { createdAt: 'desc' }],
        take: 6,
      }),
      this.prisma.robot.findMany({
        where: {
          visibility: 'PUBLIC',
          status: { in: ['ONLINE', 'BUSY'] },
          lastOnlineAt: { gte: staleCutoff },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          viewerCount: true,
          lastOnlineAt: true,
          queueMode: true,
          tags: true,
          isFeatured: true,
          owner: {
            select: {
              username: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
    ]);

    const aggregates = aggregateRows[0] ?? {
      publicRobots: 0,
      liveRobots: 0,
      featuredRobots: 0,
      totalViewers: 0,
      online: 0,
      busy: 0,
      offline: 0,
      maintenance: 0,
    };

    const overview: PublicRobotOverview = {
      totals: {
        publicRobots: this.toCount(aggregates.publicRobots),
        liveRobots: this.toCount(aggregates.liveRobots),
        featuredRobots: this.toCount(aggregates.featuredRobots),
        totalViewers: this.toCount(aggregates.totalViewers),
        queueEntries,
      },
      statusBreakdown: {
        online: this.toCount(aggregates.online),
        busy: this.toCount(aggregates.busy),
        offline: this.toCount(aggregates.offline),
        maintenance: this.toCount(aggregates.maintenance),
      },
      featured: featuredRows.map((robot) => ({
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: this.normalizeStatus(robot.status, robot.lastOnlineAt),
        viewerCount: this.normalizeViewerCount(robot.status, robot.lastOnlineAt, robot.viewerCount),
        tags: robot.tags,
        owner: robot.owner,
      })),
      liveNow: liveRows.map((robot) => ({
        id: robot.id,
        name: robot.name,
        slug: robot.slug,
        status: this.normalizeStatus(robot.status, robot.lastOnlineAt),
        viewerCount: this.normalizeViewerCount(robot.status, robot.lastOnlineAt, robot.viewerCount),
        queueMode: robot.queueMode,
        tags: robot.tags,
        owner: robot.owner,
      })),
      topTags: topTagRows.map((row) => ({ tag: row.tag, count: this.toCount(row.count) })),
    };

    await this.redis.set(cacheKey, JSON.stringify(overview), 'EX', 30);
    return overview;
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

  private mergeMetadata(
    current: unknown,
    acl?: { video?: GuestAccess; control?: GuestAccess; chat?: GuestAccess; estop?: GuestAccess },
    stream?: {
      targetBitrateKbps?: number;
      activeCameraId?: string;
      cameras?: RobotStreamCameraDescriptor[];
    },
  ): Record<string, unknown> {
    return mergeRobotMetadata(current, {
      access: acl
        ? {
            ...DEFAULT_ACCESS_POLICY,
            ...acl,
          }
        : undefined,
      stream: stream
        ? {
            ...DEFAULT_STREAM_POLICY,
            ...stream,
          }
        : undefined,
    }) as Record<string, unknown>;
  }

    private async applyRobotUpdate(
      robot: {
        id: string;
        slug: string;
        metadata: unknown;
        accessMode: string;
        accessPassword: string | null;
        inviteCode: string | null;
        slugAliases?: string[];
      },
      input: z.infer<typeof updateRobotSchema>,
    ) {
      const data = updateRobotSchema.parse(input);
      this.assertRobotTextAllowed(data);
      const metadata = this.mergeMetadata(robot.metadata, data.acl, data.stream);
      const accessPassword = data.accessPassword;
      const baseData = this.stripRobotWriteFields(data);
      this.access.invalidateCache(robot.id);

      const slugUpdate = await this.slugService.buildSlugUpdate(
        robot.id,
        robot.slug,
        robot.slugAliases,
        data.slug,
      );

      const nextAccessMode = data.accessMode ?? robot.accessMode;
      const nextAccessPassword =
        nextAccessMode === 'PASSWORD'
          ? accessPassword
            ? await hash(accessPassword, { type: 2 })
            : robot.accessPassword
          : null;
      const nextInviteCode = await this.inviteService.resolveInviteCode({
        currentAccessMode: robot.accessMode,
        currentInviteCode: robot.inviteCode,
        nextAccessMode,
      });

      const updated = await this.prisma.robot.update({
        where: { id: robot.id },
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

  private realtimeRobotCacheKey(robotId: string): string {
    return `robot:realtime:${robotId}`;
  }

  private publicOverviewCacheKey(): string {
    return 'robots:public-overview';
  }

  private async isRequesterStaff(requesterId: string): Promise<boolean> {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });
    return isStaffRole(requester?.role);
  }

  private async assertPrivateAccessForRequester(
    robot: { visibility: string; ownerId: string },
    requesterId: string,
  ): Promise<void> {
    const isStaff = await this.isRequesterStaff(requesterId);

    if (robot.visibility !== 'PRIVATE' && !isStaff && robot.ownerId !== requesterId) {
      throw new ForbiddenException('Robot is public');
    }

    if (robot.ownerId !== requesterId && !isStaff) {
      throw new ForbiddenException('Not allowed to access this robot');
    }
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

  private withStreamKeyIssuedAt(metadata: unknown): Record<string, unknown> {
    const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
    base.streamKeyIssuedAt = new Date().toISOString();
    return base;
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

  private sanitizeManagedRobot<T extends { accessPassword?: string | null }>(robot: T): T {
    return {
      ...robot,
      accessPassword: null,
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
      metadata: normalizeRobotMetadata(robot.metadata),
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

  private toCount(value: number | bigint | null | undefined): number {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return 0;
  }

}
