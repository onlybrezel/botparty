import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { hash, verify } from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isStaffRole } from '../common/robot-access';
import type {
  RobotAccessPolicy,
  RobotStreamPolicy,
  RobotStreamCameraDescriptor,
  RoomAccessGrant,
  AllowedUserSummary,
  GuestAccess,
} from './robots.types';
import { normalizeRobotMetadata } from './robot-metadata.schema';

type PolicyCacheEntry = {
  access: RobotAccessPolicy;
  stream: RobotStreamPolicy;
  expiresAt: number;
};

const DEFAULT_ACCESS_POLICY: RobotAccessPolicy = {
  video: 'AUTHENTICATED',
  control: 'AUTHENTICATED',
  chat: 'AUTHENTICATED',
  estop: 'AUTHENTICATED',
};

const DEFAULT_STREAM_POLICY: RobotStreamPolicy = {
  targetBitrateKbps: null,
};

@Injectable()
export class RobotAccessService implements OnModuleDestroy {
  private readonly logger = new Logger(RobotAccessService.name);
  private readonly policyCache = new Map<string, PolicyCacheEntry>();
  private readonly _policyCacheSweeper: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this._policyCacheSweeper = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.policyCache.entries()) {
        if (entry.expiresAt <= now) this.policyCache.delete(key);
      }
    }, 30_000);
  }

  onModuleDestroy() {
    clearInterval(this._policyCacheSweeper);
  }

  async getAccessPolicy(robotId: string): Promise<RobotAccessPolicy> {
    const entry = this._getCacheEntry(robotId);
    if (entry) return entry.access;
    await this._loadPolicyFromDb(robotId);
    return this.policyCache.get(robotId)!.access;
  }

  async getStreamPolicy(robotId: string): Promise<RobotStreamPolicy> {
    const entry = this._getCacheEntry(robotId);
    if (entry) return entry.stream;
    await this._loadPolicyFromDb(robotId);
    return this.policyCache.get(robotId)!.stream;
  }

  async getAllowedUsers(robotId: string, ownerId: string): Promise<AllowedUserSummary[]> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId }, select: { ownerId: true } });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

    const entries = await this.prisma.robotAllowedUser.findMany({
      where: { robotId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.user.id,
      username: entry.user.username,
      displayName: entry.user.displayName,
      avatarUrl: entry.user.avatarUrl,
      addedAt: entry.createdAt.toISOString(),
    }));
  }

  async addAllowedUser(robotId: string, ownerId: string, username: string): Promise<AllowedUserSummary> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId }, select: { ownerId: true } });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

    const normalizedUsername = username.trim();
    if (!normalizedUsername) throw new NotFoundException('Username is required');

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const entry = await this.prisma.robotAllowedUser.upsert({
      where: { robotId_userId: { robotId, userId: user.id } },
      update: {},
      create: { robotId, userId: user.id },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    return {
      id: entry.user.id,
      username: entry.user.username,
      displayName: entry.user.displayName,
      avatarUrl: entry.user.avatarUrl,
      addedAt: entry.createdAt.toISOString(),
    };
  }

  async removeAllowedUser(robotId: string, ownerId: string, userId: string) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId }, select: { ownerId: true } });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

    await this.prisma.robotAllowedUser.deleteMany({ where: { robotId, userId } });
    return { ok: true };
  }

  async issueRoomAccessGrant(input: {
    robotId: string;
    requesterUserId: string | null;
    guestSessionId?: string;
    password?: string;
    inviteCode?: string;
  }): Promise<RoomAccessGrant> {
    const robot = await this._getRoomAccessContext(input.robotId, input.requesterUserId);

    if (!robot) throw new NotFoundException('Robot not found');

    const actorId = input.requesterUserId ?? `guest:${randomBytes(16).toString('hex')}`;
    const isOwner = input.requesterUserId === robot.ownerId;
    const isStaff = isStaffRole(robot.requesterRole);
    const isAllowedUser =
      Boolean(input.requesterUserId) &&
      (isOwner || isStaff || robot.allowedUsers.some((entry) => entry.userId === input.requesterUserId));

    if (robot.visibility === 'PRIVATE' && !isOwner && !isStaff) {
      throw new NotFoundException('Robot not found');
    }

    if (robot.accessMode === 'ALLOWED_USERS' && !isAllowedUser) {
      throw new ForbiddenException('You are not on the allow list for this robot');
    }

    if (robot.accessMode === 'PASSWORD' && !isOwner && !isStaff) {
      const password = input.password?.trim() ?? '';
      if (!password) throw new ForbiddenException('Password required');

      const matches = robot.accessPassword
        ? await this._verifyStoredPassword(robot.id, password, robot.accessPassword)
        : false;

      if (!matches) throw new ForbiddenException('Invalid room password');
    }

    if (robot.accessMode === 'LINK_ONLY' && !isOwner && !isStaff) {
      const inviteCode = input.inviteCode?.trim() ?? '';
      if (!inviteCode) throw new ForbiddenException('Invite link required');
      if (!robot.inviteCode || inviteCode !== robot.inviteCode) {
        throw new ForbiddenException('Invalid invite link');
      }
    }

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.redis.set(
      this._roomAccessKey(token),
      JSON.stringify({ robotId: robot.id, actorId }),
      'EX',
      60 * 60,
    );

    return { token, expiresAt: expiresAt.toISOString() };
  }

  async validateRoomAccess(input: {
    robotId: string;
    actorId: string;
    roomAccessToken?: string;
  }): Promise<boolean> {
    const requesterUserId = input.actorId.startsWith('guest:') ? null : input.actorId;
    const robot = await this._getRoomAccessContext(input.robotId, requesterUserId);

    if (!robot) return false;

    const isOwner = requesterUserId === robot.ownerId;
    const isStaff = isStaffRole(robot.requesterRole);
    const isAllowedUser =
      Boolean(requesterUserId) &&
      (isOwner || isStaff || robot.allowedUsers.some((entry) => entry.userId === requesterUserId));

    if (robot.visibility === 'PRIVATE') return isOwner || isStaff;
    if (robot.accessMode === 'ALLOWED_USERS' && isAllowedUser) return true;
    if (robot.accessMode === 'LINK_ONLY' && (isOwner || isStaff)) return true;
    if (robot.accessMode === 'PASSWORD' && (isOwner || isStaff)) return true;

    const requiresGrant =
      robot.accessMode === 'PASSWORD' ||
      robot.accessMode === 'ALLOWED_USERS' ||
      robot.accessMode === 'LINK_ONLY';

    if (!requiresGrant) return true;
    const grant = await this.resolveRoomAccessActorId(input.robotId, input.roomAccessToken);
    if (!grant) return false;

    if (grant === input.actorId) {
      return true;
    }

    // For guests, treat a valid room access grant as authoritative identity.
    const requesterIsGuest = input.actorId.startsWith('guest:');
    const grantIsGuest = grant.startsWith('guest:');
    return requesterIsGuest && grantIsGuest;
  }

  async resolveRoomAccessActorId(robotId: string, roomAccessToken?: string): Promise<string | null> {
    if (!roomAccessToken) {
      return null;
    }

    const raw = await this.redis.get(this._roomAccessKey(roomAccessToken));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as { robotId?: string; actorId?: string };
      if (parsed.robotId !== robotId || typeof parsed.actorId !== 'string' || !parsed.actorId.trim()) {
        return null;
      }
      return parsed.actorId;
    } catch {
      return null;
    }
  }

  resolveGuestActorId(guestSessionId?: string): string | null {
    const raw = guestSessionId?.trim().toLowerCase() ?? '';
    if (/^[a-z0-9_-]{6,64}$/.test(raw)) return `guest:${raw}`;
    return null;
  }

  parseStreamFromMetadata(metadata: unknown): RobotStreamPolicy {
    return this._parseStreamFromMetadata(metadata);
  }

  private _getCacheEntry(robotId: string): PolicyCacheEntry | undefined {
    const cached = this.policyCache.get(robotId);
    return cached && cached.expiresAt > Date.now() ? cached : undefined;
  }

  private async _loadPolicyFromDb(robotId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { metadata: true },
    });

    const access = this._parseAccessFromMetadata(robot?.metadata);
    const stream = this._parseStreamFromMetadata(robot?.metadata);
    this.policyCache.set(robotId, { access, stream, expiresAt: Date.now() + 5000 });
  }

  private async _getRoomAccessContext(robotId: string, requesterUserId: string | null) {
    if (!requesterUserId) {
      const robot = await this.prisma.robot.findUnique({
        where: { id: robotId },
        select: {
          id: true,
          ownerId: true,
          visibility: true,
          accessMode: true,
          accessPassword: true,
          inviteCode: true,
        },
      });

      if (!robot) return null;
      return {
        ...robot,
        allowedUsers: [],
        requesterRole: null as 'ADMIN' | 'MOD' | 'USER' | null,
      };
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: {
        id: true,
        ownerId: true,
        visibility: true,
        accessMode: true,
        accessPassword: true,
        inviteCode: true,
        allowedUsers: {
          where: { userId: requesterUserId },
          select: { userId: true },
        },
      },
    });

    if (!robot) return null;

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { role: true },
    });

    return { ...robot, requesterRole: requester?.role ?? null };
  }

  private _parseAccessFromMetadata(metadata: unknown): RobotAccessPolicy {
    const access = normalizeRobotMetadata(metadata).access;
    if (!access) return DEFAULT_ACCESS_POLICY;
    return {
      video: this._readAccessValue(access.video),
      control: this._readAccessValue(access.control),
      chat: this._readAccessValue(access.chat),
      estop: this._readAccessValue(access.estop),
    };
  }

  private _parseStreamFromMetadata(metadata: unknown): RobotStreamPolicy {
    const stream = normalizeRobotMetadata(metadata).stream;
    if (!stream) return DEFAULT_STREAM_POLICY;
    const bitrate = stream.targetBitrateKbps;
    const activeCameraId = typeof stream.activeCameraId === 'string' ? stream.activeCameraId.trim() : '';
    const cameras: RobotStreamCameraDescriptor[] | undefined = Array.isArray(stream.cameras)
      ? stream.cameras.reduce<RobotStreamCameraDescriptor[]>((acc, entry) => {
          const id = typeof entry.id === 'string' ? entry.id.trim() : '';
          if (!id) return acc;
          acc.push({
            id,
            label: typeof entry.label === 'string' ? entry.label.trim() || undefined : undefined,
            role: typeof entry.role === 'string' ? entry.role.trim() || undefined : undefined,
            enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
            publishMode: typeof entry.publishMode === 'string' ? entry.publishMode.trim() || undefined : undefined,
          });
          return acc;
        }, [])
      : undefined;

    return {
      targetBitrateKbps:
        typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 3000
          ? Math.round(bitrate)
          : DEFAULT_STREAM_POLICY.targetBitrateKbps,
      activeCameraId: activeCameraId || undefined,
      cameras: cameras?.length ? cameras : undefined,
    };
  }

  private _readAccessValue(value: unknown): GuestAccess {
    if (value === 'ALL' || value === 'AUTHENTICATED' || value === 'DISABLED') return value;
    return 'AUTHENTICATED';
  }

  private async _verifyStoredPassword(robotId: string, password: string, stored: string): Promise<boolean> {
    try {
      return await verify(stored, password);
    } catch {
      if (stored !== password) return false;
      await this.prisma.robot.update({
        where: { id: robotId },
        data: { accessPassword: await hash(password, { type: 2 }) },
      });
      this.logger.warn(`Migrated legacy plaintext room password for robot ${robotId}`);
      return true;
    }
  }

  private _roomAccessKey(token: string): string {
    return `robot:room-access:${token}`;
  }

  invalidateCache(robotId: string) {
    this.policyCache.delete(robotId);
  }
}
