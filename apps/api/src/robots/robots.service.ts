import { Inject, Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isRecord } from '../common/json-value';
import { RedisService } from '../redis/redis.service';
import { createRobotSchema, updateRobotSchema } from '@botparty/shared';
import type { z } from 'zod';
import { Prisma } from '@botparty/prisma';
import { RobotTelemetryService } from './robot-telemetry.service';
import { RobotThumbnailService } from './robot-thumbnail.service';
import { RobotAccessService } from './robot-access.service';
import { RobotWebhookService } from './robot-webhook.service';
import { RobotDeviceService } from './robot-device.service';
import { RobotSlugService } from './robot-slug.service';
import { RobotInviteService } from './robot-invite.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { RobotCameraService } from './robot-camera.service';
import { RobotActionQueueService } from './robot-action-queue.service';
import { readNonNegativeIntegerEnv } from '../common/config-number';
import {
  RobotPublicOverviewService,
  type PublicRobotOverview,
} from './robot-public-overview.service';
import { RobotRoomStateHelper, type RobotRoomStateDatabase } from './robot-room-state.helper';
import {
  RobotWriteHelper,
  type RobotWriteDatabase,
  type RobotWriteTransaction,
} from './robot-write.helper';
import { PlatformUserService } from '../wallet/platform-user.service';
import { sanitizeManagedRobot, toPublicRobot } from './robots.service.helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageDeletionService } from '../storage/storage-deletion.service';
import type {
  AllowedUserSummary,
  ChatHistoryMessage,
  ChatHistoryPage,
  RobotAccessPolicy,
  RobotActionPayload,
  RobotStreamPolicy,
  RoomAccessGrant,
} from './robots.types';

const PUBLIC_ROBOT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  thumbnailUrl: true,
  status: true,
  lastOnlineAt: true,
  visibility: true,
  accessMode: true,
  queueMode: true,
  scheduleStart: true,
  scheduleEnd: true,
  timezone: true,
  maxTurnTime: true,
  maxViewers: true,
  maxControllers: true,
  metadata: true,
  recordSessions: true,
  tags: true,
  viewerCount: true,
  createdAt: true,
  owner: {
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  },
} satisfies Prisma.RobotSelect;

type PublicRobot = ReturnType<typeof toPublicRobot>;

const PUBLIC_DISCOVERY_CACHE_TTL_MS = 5_000;
const PUBLIC_DISCOVERY_CACHE_MAX_ENTRIES = 64;

type RobotsDatabase = RobotWriteDatabase &
  RobotRoomStateDatabase & {
    $transaction<T>(
      callback: (transaction: RobotWriteTransaction) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ): Promise<T>;
    controlButton: Pick<PrismaService['controlButton'], 'count'>;
    robot: Pick<PrismaService['robot'], 'findMany' | 'findUnique' | 'update' | 'updateMany'>;
  };

@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);
  private readonly maxRobotsPerOwner: number;
  private readonly writeHelper: RobotWriteHelper;
  private readonly roomStateHelper: RobotRoomStateHelper;
  private readonly platformUserId: string;
  private readonly publicDiscoveryCache = new Map<
    string,
    { expiresAt: number; robots: PublicRobot[] }
  >();
  private readonly publicDiscoveryRefreshes = new Map<string, Promise<PublicRobot[]>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: RobotsDatabase,
    @Inject(RedisService) private readonly redis: Pick<RedisService, 'del' | 'get' | 'set'>,
    @Inject(RobotTelemetryService)
    private readonly telemetry: Pick<
      RobotTelemetryService,
      'getLogs' | 'getTelemetry' | 'ingestLogsByRobotId' | 'ingestTelemetryByRobotId'
    >,
    @Inject(RobotThumbnailService)
    private readonly thumbnail: Pick<RobotThumbnailService, 'clear' | 'read' | 'save'>,
    @Inject(RobotAccessService)
    private readonly access: Pick<
      RobotAccessService,
      | 'addAllowedUser'
      | 'getAccessPolicy'
      | 'getAllowedUsers'
      | 'getStreamPolicy'
      | 'invalidateCache'
      | 'issueRoomAccessGrant'
      | 'removeAllowedUser'
      | 'resolveGuestActorId'
      | 'resolveRoomAccessActorId'
      | 'validateRoomAccess'
    >,
    @Inject(RobotWebhookService)
    private readonly webhooks: Pick<RobotWebhookService, 'emitRobotStatus'>,
    @Inject(ChatPersistenceService)
    private readonly chatPersistence: Pick<ChatPersistenceService, 'enqueue'>,
    @Inject(ConfigService) private readonly configService: { get(key: string): unknown },
    @Inject(RobotDeviceService)
    private readonly deviceService: Pick<
      RobotDeviceService,
      | 'clearBoundDeviceMetadata'
      | 'findByClaimToken'
      | 'validateOrBindRobotDevice'
      | 'validateRobotAuth'
      | 'withClaimTokenIssuedAt'
    >,
    @Inject(RobotSlugService)
    private readonly slugService: Pick<
      RobotSlugService,
      'buildSlugUpdate' | 'findRobotBySlugAny' | 'generateSlug' | 'validateAndNormalizeSlugInput'
    >,
    @Inject(RobotInviteService)
    private readonly inviteService: Pick<
      RobotInviteService,
      'ensureInviteCodeForManagedRobot' | 'generateUniqueInviteCode' | 'resolveInviteCode'
    >,
    @Inject(RobotCameraService)
    private readonly cameraService: Pick<
      RobotCameraService,
      'removeExternalStreamCamera' | 'upsertExternalStreamCamera'
    >,
    @Inject(RobotActionQueueService)
    private readonly actionQueueService: Pick<
      RobotActionQueueService,
      'consumeActionsByRobotId' | 'enqueueAction' | 'enqueueActionForRobot' | 'getPendingActions'
    >,
    @Inject(RobotPublicOverviewService)
    private readonly publicOverviewService: Pick<RobotPublicOverviewService, 'getPublicOverview'>,
    @Inject(PlatformUserService)
    private readonly platformUser: Pick<PlatformUserService, 'getPlatformUserId'>,
    @Inject(NotificationsService)
    private readonly notifications: Pick<NotificationsService, 'publishSafely'>,
    @Inject(StorageDeletionService)
    private readonly storageDeletion: Pick<
      StorageDeletionService,
      'enqueue' | 'recordingBucket' | 'thumbnailBucket'
    >,
  ) {
    this.maxRobotsPerOwner = readNonNegativeIntegerEnv(
      this.configService,
      'MAX_ROBOTS_PER_OWNER',
      25,
    );
    this.platformUserId = this.platformUser.getPlatformUserId();
    this.writeHelper = new RobotWriteHelper(
      this.prisma,
      this.access,
      this.deviceService,
      this.slugService,
      this.inviteService,
    );
    this.roomStateHelper = new RobotRoomStateHelper(
      this.prisma,
      this.redis,
      this.access,
      this.chatPersistence,
    );
  }

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>) {
    const robot = await this.writeHelper.create(ownerId, input, this.maxRobotsPerOwner);
    this.publicDiscoveryCache.clear();
    this.logger.log(`Robot created: ${robot.name} (${robot.slug}) by ${ownerId}`);
    return robot;
  }

  async findAll(filters?: {
    visibility?: string;
    status?: string;
    tag?: string;
    q?: string;
    sort?: string;
    limit?: string;
    offset?: string;
  }) {
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

    const cacheKey = JSON.stringify({
      operation: 'findAll',
      query: query ?? null,
      sort: sort ?? null,
      status: statusFilter ?? null,
      tag: filters?.tag ?? null,
      take,
      skip,
    });

    return this.cachedPublicDiscovery(cacheKey, async () => {
      const robots = await this.prisma.robot.findMany({
        where: {
          visibility: 'PUBLIC',
          ownerId: { not: this.platformUserId },
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
        select: PUBLIC_ROBOT_SELECT,
      });

      return robots.map((robot) => toPublicRobot(robot));
    });
  }

  private async cachedPublicDiscovery(
    key: string,
    load: () => Promise<PublicRobot[]>,
  ): Promise<PublicRobot[]> {
    const now = Date.now();
    const cached = this.publicDiscoveryCache.get(key);
    if (cached && cached.expiresAt > now) return cached.robots;
    if (cached) this.publicDiscoveryCache.delete(key);

    const activeRefresh = this.publicDiscoveryRefreshes.get(key);
    if (activeRefresh) return activeRefresh;

    const refresh = load().then((robots) => {
      if (this.publicDiscoveryCache.size >= PUBLIC_DISCOVERY_CACHE_MAX_ENTRIES) {
        const oldestKey = this.publicDiscoveryCache.keys().next().value as string | undefined;
        if (oldestKey) this.publicDiscoveryCache.delete(oldestKey);
      }
      this.publicDiscoveryCache.set(key, {
        expiresAt: Date.now() + PUBLIC_DISCOVERY_CACHE_TTL_MS,
        robots,
      });
      return robots;
    });
    this.publicDiscoveryRefreshes.set(key, refresh);
    try {
      return await refresh;
    } finally {
      this.publicDiscoveryRefreshes.delete(key);
    }
  }

  async findBySlug(slug: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.visibility === 'PRIVATE') throw new NotFoundException('Robot not found');
    return toPublicRobot(robot);
  }

  async findByUsernameAndSlug(username: string, slug: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.visibility === 'PRIVATE') throw new NotFoundException('Robot not found');
    if (robot.owner.username.toLowerCase() !== username.trim().toLowerCase()) {
      throw new NotFoundException('Robot not found');
    }
    return toPublicRobot(robot);
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
    const normalizedRobots = await Promise.all(
      robots.map((robot) => this.inviteService.ensureInviteCodeForManagedRobot(robot)),
    );
    return normalizedRobots.map((robot) => sanitizeManagedRobot(robot));
  }

  async update(id: string, ownerId: string, input: z.infer<typeof updateRobotSchema>) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new NotFoundException('Robot not found');
    }

    await this.assertPublicationReady(robot, input, ownerId);

    const updated = await this.writeHelper.applyRobotUpdate(robot, input);
    this.publicDiscoveryCache.clear();
    await this.roomStateHelper.invalidateRealtimeRobot(id);
    return updated;
  }

  async updateByStaff(id: string, input: z.infer<typeof updateRobotSchema>) {
    const existing = await this.findById(id);
    await this.assertPublicationReady(existing, input, existing.ownerId);
    const updated = await this.writeHelper.applyRobotUpdate(existing, input);
    this.publicDiscoveryCache.clear();
    await this.roomStateHelper.invalidateRealtimeRobot(id);
    return updated;
  }

  private async assertPublicationReady(
    robot: { id: string; visibility: string },
    input: z.infer<typeof updateRobotSchema>,
    ownerId: string,
  ) {
    if (input.visibility !== 'PUBLIC' || robot.visibility === 'PUBLIC') return;
    const onboarding = await this.getOnboardingStatus(robot.id, ownerId);
    if (onboarding.canPublish) return;
    throw new BadRequestException({
      code: 'ROBOT_ONBOARDING_INCOMPLETE',
      message: 'Complete the required go-live checks before publishing this robot.',
      missingSteps: onboarding.steps
        .filter((step) => step.required && !step.complete)
        .map((step) => step.id),
    });
  }

  async delete(id: string, ownerId: string) {
    const name = await this.deleteWithObjects(id, ownerId);
    this.publicDiscoveryCache.clear();
    await this.roomStateHelper.invalidateRealtimeRobot(id);
    this.logger.log(`Robot deleted: ${name}`);
  }

  async deleteByStaff(id: string) {
    const name = await this.deleteWithObjects(id, null);
    this.publicDiscoveryCache.clear();
    await this.roomStateHelper.invalidateRealtimeRobot(id);
    this.logger.log(`Robot deleted by staff: ${name}`);
  }

  private async deleteWithObjects(id: string, ownerId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${id}::uuid FOR UPDATE`);
      const robot = await tx.robot.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          ownerId: true,
          recordings: { select: { objectKey: true } },
        },
      });
      if (!robot || (ownerId !== null && robot.ownerId !== ownerId)) {
        throw new NotFoundException('Robot not found');
      }
      await this.storageDeletion.enqueue(
        tx,
        this.storageDeletion.recordingBucket,
        robot.recordings.map((recording) => recording.objectKey),
      );
      await this.storageDeletion.enqueue(tx, this.storageDeletion.thumbnailBucket, [
        `robot-thumbnails/${robot.id}/`,
      ]);
      await tx.robot.delete({ where: { id } });
      return robot.name;
    });
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
      throw new NotFoundException('Robot not found');
    }

    return this.writeHelper.regenerateClaimToken(robot);
  }

  async regenerateInviteCode(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new NotFoundException('Robot not found');
    }

    if (robot.accessMode !== 'LINK_ONLY') {
      throw new BadRequestException('Invite links are only used in link-only mode');
    }

    return this.writeHelper.regenerateInviteCode(robot.id);
  }

  async ensureInviteCode(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new NotFoundException('Robot not found');
    }

    if (robot.inviteCode) {
      return { id: robot.id, inviteCode: robot.inviteCode };
    }

    return this.writeHelper.ensureInviteCode(robot.id);
  }

  async saveRobotThumbnail(id: string, ownerId: string, dataUrl: string) {
    return this.thumbnail.save(id, ownerId, dataUrl);
  }

  async clearRobotThumbnail(id: string, ownerId: string) {
    return this.thumbnail.clear(id, ownerId);
  }

  async readRobotThumbnail(id: string, requesterId: string | null) {
    return this.thumbnail.read(id, requesterId);
  }

  async findPrivateBySlugForUser(slug: string, requesterId: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    await this.writeHelper.assertPrivateAccessForRequester(robot, requesterId);
    return toPublicRobot(robot);
  }

  async findPrivateByUsernameAndSlugForUser(username: string, slug: string, requesterId: string) {
    const robot = await this.slugService.findRobotBySlugAny(slug);
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.owner.username.toLowerCase() !== username.trim().toLowerCase()) {
      throw new NotFoundException('Robot not found');
    }

    await this.writeHelper.assertPrivateAccessForRequester(robot, requesterId);
    return toPublicRobot(robot);
  }

  async getAllowedUsers(robotId: string, ownerId: string): Promise<AllowedUserSummary[]> {
    return this.access.getAllowedUsers(robotId, ownerId);
  }

  async addAllowedUser(
    robotId: string,
    ownerId: string,
    username: string,
  ): Promise<AllowedUserSummary> {
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
        ...(status === 'ONLINE' ? { lastOnlineAt: new Date() } : {}),
      },
      select: { id: true, name: true, slug: true, status: true, ownerId: true },
    });
    if (previous?.status !== updated.status) {
      this.webhooks.emitRobotStatus(updated);
      await this.roomStateHelper.invalidatePublicOverviewCache();
      if (updated.status === 'OFFLINE') {
        void this.notifications.publishSafely({
          userId: updated.ownerId,
          kind: 'ROBOT_OFFLINE',
          category: 'ROBOT',
          title: `${updated.name} is offline`,
          body: 'The robot stopped reporting. Check its connection and power before reopening control.',
          actionUrl: '/dashboard',
          dedupeKey: `robot-offline:${updated.id}:${Date.now()}`,
        });
      }
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

  async validateRobotAuth(robotId: string, deviceHash: string, tokenVersion: number) {
    return this.deviceService.validateRobotAuth(robotId, deviceHash, tokenVersion);
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
    await this.findById(robotId);
    return this.telemetry.ingestTelemetryByRobotId(robotId, payload);
  }

  async getOnboardingStatus(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true, status: true, accessMode: true, metadata: true },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

    const [rawTelemetry, buttonCount] = await Promise.all([
      this.redis.get(`robot:telemetry:${robotId}:latest`),
      this.prisma.controlButton.count({ where: { robotId, isEnabled: true } }),
    ]);
    let telemetry: Record<string, unknown> = {};
    try {
      const parsed: unknown = rawTelemetry ? JSON.parse(rawTelemetry) : {};
      telemetry = isRecord(parsed) ? parsed : {};
    } catch {
      telemetry = {};
    }
    const fresh = typeof telemetry['ts'] === 'number' && Date.now() - telemetry['ts'] < 180_000;
    const access = await this.getAccessPolicy(robotId);
    const videoRequired = access.video !== 'DISABLED';
    const controlRequired = access.control !== 'DISABLED';
    const connected = fresh && (robot.status === 'ONLINE' || robot.status === 'BUSY');
    const steps = [
      { id: 'claim' as const, label: 'Robot claimed', required: true, complete: connected },
      {
        id: 'connectivity' as const,
        label: 'Connection healthy',
        required: true,
        complete: connected && telemetry['controlConnected'] === true,
      },
      {
        id: 'camera' as const,
        label: 'Camera publishing',
        required: videoRequired,
        complete:
          !videoRequired ||
          (fresh &&
            telemetry['livekitConnected'] === true &&
            Number(telemetry['cameraFrames'] ?? 0) > 0),
      },
      {
        id: 'control' as const,
        label: 'Control command received',
        required: controlRequired,
        complete:
          !controlRequired ||
          (fresh &&
            telemetry['controlConnected'] === true &&
            Number(telemetry['commandsReceived'] ?? 0) > 0),
      },
      {
        id: 'emergency_stop' as const,
        label: 'Hardware E-Stop verified',
        required: controlRequired,
        complete: !controlRequired || (fresh && telemetry['emergencyStopVerified'] === true),
      },
      {
        id: 'access' as const,
        label: 'Room access configured',
        required: true,
        complete: Boolean(robot.accessMode),
      },
      {
        id: 'moderation' as const,
        label: 'Control policy configured',
        required: controlRequired,
        complete: !controlRequired || buttonCount > 0,
      },
      {
        id: 'preview' as const,
        label: 'Live preview ready',
        required: videoRequired,
        complete:
          !videoRequired ||
          (fresh &&
            telemetry['livekitConnected'] === true &&
            Number(telemetry['cameraFrames'] ?? 0) > 0),
      },
    ];
    return {
      canPublish: steps.every((step) => !step.required || step.complete),
      generatedAt: new Date().toISOString(),
      steps,
    };
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

  async findByIdCached(id: string) {
    return this.roomStateHelper.findByIdCached(id, async () => {
      const robot = await this.prisma.robot.findUnique({
        where: { id },
        select: { id: true, name: true, ownerId: true, queueMode: true },
      });
      if (!robot) throw new NotFoundException('Robot not found');
      return robot;
    });
  }

  async appendChatMessage(
    robotId: string,
    userId: string | null | undefined,
    content: string,
    timestampMs: number,
    clientMessageId: string,
  ) {
    return this.roomStateHelper.appendChatMessage(
      robotId,
      userId,
      content,
      timestampMs,
      clientMessageId,
    );
  }

  async getRecentChatMessages(robotId: string, limit?: number): Promise<ChatHistoryMessage[]> {
    return this.roomStateHelper.getRecentChatMessages(robotId, limit);
  }

  async getChatHistoryPage(input: {
    robotId: string;
    requesterUserId: string | null;
    guestSessionId?: string;
    roomAccessToken?: string | undefined;
    before?: number;
    beforeId?: string;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    return this.roomStateHelper.getChatHistoryPage(input);
  }

  async getFeatured() {
    return this.cachedPublicDiscovery('featured', async () => {
      const robots = await this.prisma.robot.findMany({
        where: { isFeatured: true, visibility: 'PUBLIC', ownerId: { not: this.platformUserId } },
        select: PUBLIC_ROBOT_SELECT,
      });

      return robots.map((robot) => toPublicRobot(robot));
    });
  }

  async getPublicOverview(): Promise<PublicRobotOverview> {
    return this.publicOverviewService.getPublicOverview();
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
    roomAccessToken?: string | undefined;
  }): Promise<boolean> {
    return this.access.validateRoomAccess(input);
  }

  async resolveRoomAccessActorId(
    robotId: string,
    roomAccessToken?: string,
  ): Promise<string | null> {
    return this.access.resolveRoomAccessActorId(robotId, roomAccessToken);
  }

  resolveGuestActorId(guestSessionId?: string): string | null {
    return this.access.resolveGuestActorId(guestSessionId);
  }

  async setViewerCount(robotId: string, viewerCount: number) {
    return this.roomStateHelper.setViewerCount(robotId, viewerCount);
  }
}
