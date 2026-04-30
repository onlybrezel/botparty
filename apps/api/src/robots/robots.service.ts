import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { createRobotSchema, updateRobotSchema } from '@botparty/shared';
import type { z } from 'zod';
import type { Prisma } from '@botparty/prisma';
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
import { RobotPublicOverviewService, type PublicRobotOverview } from './robot-public-overview.service';
import { RobotRoomStateHelper } from './robot-room-state.helper';
import { RobotWriteHelper } from './robot-write.helper';
import { PlatformUserService } from '../wallet/platform-user.service';
import {
  sanitizeManagedRobot,
  toPublicRobot,
  type RobotStreamCameraDescriptor,
} from './robots.service.helpers';

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

export interface RoomAccessGrant {
  token: string;
  expiresAt: string;
}

export interface ChatHistoryMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
}

export interface ChatHistoryPage {
  messages: ChatHistoryMessage[];
  nextCursor: number | null;
  nextCursorId: string | null;
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

@Injectable()
export class RobotsService implements OnModuleDestroy {
  private readonly logger = new Logger(RobotsService.name);
  private readonly maxRobotsPerOwner: number;
  private readonly writeHelper: RobotWriteHelper;
  private readonly roomStateHelper: RobotRoomStateHelper;
  private readonly platformUserId: string;

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
    private readonly publicOverviewService: RobotPublicOverviewService,
    private readonly platformUser: PlatformUserService,
  ) {
    this.maxRobotsPerOwner = readNonNegativeIntegerEnv(this.configService, 'MAX_ROBOTS_PER_OWNER', 25);
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

  onModuleDestroy() {
    // Lifecycle cleanup handled by sub-services.
  }

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>) {
    const robot = await this.writeHelper.create(ownerId, input, this.maxRobotsPerOwner);
    this.logger.log(`Robot created: ${robot.name} (${robot.slug}) by ${ownerId}`);
    return robot;
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
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return robots.map((robot) => toPublicRobot(robot));
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
      throw new ForbiddenException('Not your robot');
    }

    return this.writeHelper.applyRobotUpdate(robot, input);
  }

  async updateByStaff(id: string, input: z.infer<typeof updateRobotSchema>) {
    const existing = await this.findById(id);
    return this.writeHelper.applyRobotUpdate(existing, input);
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

    return this.writeHelper.regenerateClaimToken(robot);
  }

  async regenerateInviteCode(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    if (robot.accessMode !== 'LINK_ONLY') {
      throw new BadRequestException('Invite links are only used in link-only mode');
    }

    return this.writeHelper.regenerateInviteCode(robot.id);
  }

  async ensureInviteCode(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
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

  async readRobotThumbnail(id: string) {
    return this.thumbnail.read(id);
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
      await this.roomStateHelper.invalidatePublicOverviewCache();
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
    return this.roomStateHelper.findByIdCached(id, () => this.findById(id));
  }

  async appendChatMessage(robotId: string, userId: string | null | undefined, content: string, timestampMs: number) {
    return this.roomStateHelper.appendChatMessage(robotId, userId, content, timestampMs);
  }

  async getRecentChatMessages(robotId: string, limit?: number): Promise<ChatHistoryMessage[]> {
    return this.roomStateHelper.getRecentChatMessages(robotId, limit);
  }

  async getChatHistoryPage(input: {
    robotId: string;
    requesterUserId: string | null;
    guestSessionId?: string;
    roomAccessToken?: string;
    before?: number;
    beforeId?: string;
    limit?: number;
  }): Promise<ChatHistoryPage> {
    return this.roomStateHelper.getChatHistoryPage(input);
  }

  async getFeatured() {
    const robots = await this.prisma.robot.findMany({
      where: { isFeatured: true, visibility: 'PUBLIC', ownerId: { not: this.platformUserId } },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return robots.map((robot) => toPublicRobot(robot));
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
    return this.roomStateHelper.setViewerCount(robotId, viewerCount);
  }
}
