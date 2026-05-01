import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { ModerationActionType, WS_EVENTS } from '@botparty/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ModerateUserDto } from './moderation.dto';
import { ModerationAuditService } from './moderation-audit.service';
import { ModerationOverviewService } from './moderation-overview.service';
import { type RobotActionPayload } from '../robots/robots.service';
import { isStaffRole } from '../common/robot-access';

@Injectable()
export class ModerationService {
  private static readonly ACTION_COOLDOWN_SEC = 4;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditService: ModerationAuditService,
    private readonly overviewService: ModerationOverviewService,
  ) {}

  async moderate(robotId: string, dto: ModerateUserDto, moderatorId: string) {
    const isGuestTarget = this._isGuestUserId(dto.targetUserId);
    const [robot, moderator, target] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: moderatorId } }),
      isGuestTarget ? Promise.resolve(null) : this.prisma.user.findUnique({ where: { id: dto.targetUserId } }),
    ]);

    if (!robot) throw new NotFoundException('Robot not found');
    if (!moderator) throw new NotFoundException('Moderator not found');
    if (!isGuestTarget && !target) throw new NotFoundException('Target user not found');

    const isSiteStaff = isStaffRole(moderator.role);
    if (robot.ownerId !== moderatorId && !isSiteStaff) {
      throw new ForbiddenException('Only the robot owner or site staff can moderate');
    }

    if (!isGuestTarget && target && target.role === 'ADMIN' && !isSiteStaff) {
      throw new ForbiddenException('Cannot moderate a site admin');
    }

    if (isGuestTarget) {
      return this._moderateGuest(robotId, dto, moderatorId);
    }

    await this._assertActionNotCoolingDown(robotId, dto.targetUserId, dto.action, moderatorId);

    const activeRestriction = await this.getActiveRestriction(robotId, dto.targetUserId);
    if (dto.action === ModerationActionType.BAN && activeRestriction?.action === ModerationActionType.BAN) {
      throw new ConflictException('User is already banned');
    }
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (activeRestriction?.action === ModerationActionType.BAN) {
        throw new ConflictException('User is already banned');
      }
      if (activeRestriction?.action === ModerationActionType.TIMEOUT) {
        throw new ConflictException('User is already timed out');
      }
    }

    const createsActiveRestriction =
      dto.action === ModerationActionType.BAN || dto.action === ModerationActionType.TIMEOUT;

    if (createsActiveRestriction) {
      await this.prisma.robotModerationEntry.updateMany({
        where: { robotId, userId: dto.targetUserId, isActive: true },
        data: { isActive: false },
      });
    }

    let expiresAt: Date | null = null;

    if (dto.action === ModerationActionType.TIMEOUT) {
      if (!dto.durationSec) throw new BadRequestException('durationSec required for TIMEOUT');
      expiresAt = new Date(Date.now() + dto.durationSec * 1000);
    }

    if (dto.action === ModerationActionType.UNBAN) {
      const activeBan = await this.prisma.robotModerationEntry.findFirst({
        where: {
          robotId,
          userId: dto.targetUserId,
          isActive: true,
          action: ModerationActionType.BAN,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeBan) {
        throw new BadRequestException('User is not currently banned');
      }

      await this.prisma.robotModerationEntry.updateMany({
        where: {
          robotId,
          userId: dto.targetUserId,
          isActive: true,
          action: ModerationActionType.BAN,
        },
        data: { isActive: false },
      });
      const targetLabel = this._getTargetLabel(dto.targetUserId, target);
      await this.redis.publish(
        `ws:moderation:${robotId}`,
        JSON.stringify({
          event: WS_EVENTS.MOD_UNBAN,
          data: {
            userId: dto.targetUserId,
            robotId,
            username: targetLabel.username,
            displayName: targetLabel.displayName,
          },
        }),
      );
      return { action: 'UNBAN', userId: dto.targetUserId };
    }

    const entry = await this.prisma.robotModerationEntry.create({
      data: {
        robotId,
        userId: dto.targetUserId,
        action: dto.action,
        reason: dto.reason,
        expiresAt,
        isActive: createsActiveRestriction,
        moderatorId,
      },
    });

    const wsEvent =
      dto.action === ModerationActionType.BAN
        ? WS_EVENTS.MOD_BAN
        : dto.action === ModerationActionType.KICK
          ? WS_EVENTS.MOD_KICK
          : WS_EVENTS.MOD_TIMEOUT;
    const targetLabel = this._getTargetLabel(dto.targetUserId, target);

    await this.redis.publish(
      `ws:moderation:${robotId}`,
      JSON.stringify({
        event: wsEvent,
        data: {
          userId: dto.targetUserId,
          username: targetLabel.displayName ?? targetLabel.username,
          displayName: targetLabel.displayName,
          moderatorId,
          reason: dto.reason,
          expiresAt,
          robotId,
        },
      }),
    );

    return entry;
  }

  async getActiveRestriction(robotId: string, userId: string) {
    if (this._isGuestUserId(userId)) {
      return this._getGuestRestriction(robotId, userId);
    }

    const entry = await this.prisma.robotModerationEntry.findFirst({
      where: {
        robotId,
        userId,
        isActive: true,
        action: { in: ['BAN', 'TIMEOUT'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (entry && entry.expiresAt && entry.expiresAt <= new Date()) {
      await this.prisma.robotModerationEntry.update({
        where: { id: entry.id },
        data: { isActive: false },
      });
      return null;
    }

    return entry;
  }

  sanitizeChatContent(raw: string) { return this.auditService.sanitizeChatContent(raw); }
  containsProfanity(content: string) { return this.auditService.containsProfanity(content); }
  containsForbiddenSymbols(content: string) { return this.auditService.containsForbiddenSymbols(content); }
  maskProfanity(content: string) { return this.auditService.maskProfanity(content); }
  async recordProfanityEvent(input: { robotId: string; userId: string; username: string; content: string; }) { return this.auditService.recordProfanityEvent(input); }
  async getProfanityOverview(requesterId: string, robotId: string) { return this.auditService.getProfanityOverview(requesterId, robotId); }
  async getGlobalProfanityOverview(requesterId: string) { return this.auditService.getGlobalProfanityOverview(requesterId); }
  async getLog(robotId: string, requesterId: string) { return this.auditService.getLog(robotId, requesterId); }
  async getAdminOverview(requesterId: string, robotId?: string) { return this.overviewService.getAdminOverview(requesterId, robotId); }
  async getAdminRuntimeOverview(requesterId: string) { return this.overviewService.getAdminRuntimeOverview(requesterId); }
  async enqueueStaffRobotAction(robotId: string, requesterId: string, payload: RobotActionPayload) { return this.overviewService.enqueueStaffRobotAction(robotId, requesterId, payload); }
  async getAdminRobotRecordingStatus(robotId: string, requesterId: string) { return this.overviewService.getAdminRobotRecordingStatus(robotId, requesterId); }
  async startAdminRobotRecording(robotId: string, requesterId: string) { return this.overviewService.startAdminRobotRecording(robotId, requesterId); }
  async stopAdminRobotRecording(robotId: string, requesterId: string) { return this.overviewService.stopAdminRobotRecording(robotId, requesterId); }
  async listAdminRecordings(requesterId: string) { return this.overviewService.listAdminRecordings(requesterId); }
  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> { return this.overviewService.streamAdminRecording(fileName, requesterId); }
  async streamSignedAdminRecording(fileName: string, expires: string | undefined, signature: string | undefined): Promise<StreamableFile> { return this.overviewService.streamSignedAdminRecording(fileName, expires, signature); }

  private async _moderateGuest(robotId: string, dto: ModerateUserDto, moderatorId: string) {
    const key = this._guestRestrictionKey(robotId, dto.targetUserId);
    const targetLabel = this._getTargetLabel(dto.targetUserId, null);
    await this._assertActionNotCoolingDown(robotId, dto.targetUserId, dto.action, moderatorId);

    const existing = await this._getGuestRestriction(robotId, dto.targetUserId);
    if (dto.action === ModerationActionType.BAN && existing?.action === ModerationActionType.BAN) {
      throw new ConflictException('User is already banned');
    }
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (existing?.action === ModerationActionType.BAN) {
        throw new ConflictException('User is already banned');
      }
      if (existing?.action === ModerationActionType.TIMEOUT) {
        throw new ConflictException('User is already timed out');
      }
    }

    if (dto.action === ModerationActionType.UNBAN) {
      if (!existing || existing.action !== ModerationActionType.BAN) {
        throw new BadRequestException('User is not currently banned');
      }

      await this.redis.del(key);
      await this.redis.publish(
        `ws:moderation:${robotId}`,
        JSON.stringify({
          event: WS_EVENTS.MOD_UNBAN,
          data: {
            userId: dto.targetUserId,
            robotId,
            username: targetLabel.username,
            displayName: targetLabel.displayName,
          },
        }),
      );
      return { action: 'UNBAN', userId: dto.targetUserId };
    }

    let expiresAtMs: number | null = null;
    let persistsRestriction = false;
    if (dto.action === ModerationActionType.TIMEOUT) {
      if (!dto.durationSec) throw new BadRequestException('durationSec required for TIMEOUT');
      expiresAtMs = Date.now() + dto.durationSec * 1000;
      persistsRestriction = true;
    } else if (dto.action === ModerationActionType.BAN) {
      persistsRestriction = true;
    }

    const payload = {
      robotId,
      userId: dto.targetUserId,
      action: dto.action,
      reason: dto.reason,
      moderatorId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
      isActive: persistsRestriction,
    };

    if (expiresAtMs) {
      const ttlSec = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
      await this.redis.set(key, JSON.stringify(payload), 'EX', ttlSec);
    } else if (dto.action === ModerationActionType.BAN) {
      await this.redis.set(key, JSON.stringify(payload), 'EX', 60 * 60 * 24 * 30);
    }

    const wsEvent =
      dto.action === ModerationActionType.BAN
        ? WS_EVENTS.MOD_BAN
        : dto.action === ModerationActionType.KICK
          ? WS_EVENTS.MOD_KICK
          : WS_EVENTS.MOD_TIMEOUT;

    await this.redis.publish(
      `ws:moderation:${robotId}`,
      JSON.stringify({
        event: wsEvent,
        data: {
          userId: dto.targetUserId,
          username: targetLabel.username,
          displayName: targetLabel.displayName,
          moderatorId,
          reason: dto.reason,
          expiresAt: payload.expiresAt,
          robotId,
        },
      }),
    );

    return payload;
  }

  private async _getGuestRestriction(robotId: string, userId: string) {
    const raw = await this.redis.get(this._guestRestrictionKey(robotId, userId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as {
        action?: string;
        expiresAt?: string | null;
        [key: string]: unknown;
      };

      if (parsed.expiresAt) {
        const exp = Date.parse(parsed.expiresAt);
        if (Number.isFinite(exp) && exp <= Date.now()) {
          await this.redis.del(this._guestRestrictionKey(robotId, userId));
          return null;
        }
      }

      return parsed;
    } catch {
      await this.redis.del(this._guestRestrictionKey(robotId, userId));
      return null;
    }
  }

  private _isGuestUserId(userId: string): boolean {
    return userId.startsWith('guest:');
  }

  private _guestRestrictionKey(robotId: string, userId: string): string {
    return `moderation:guest:restriction:${robotId}:${userId}`;
  }

  private moderationCooldownKey(robotId: string, targetUserId: string, action: ModerationActionType) {
    return `moderation:cooldown:${robotId}:${targetUserId}:${action}`;
  }

  private async _assertActionNotCoolingDown(
    robotId: string,
    targetUserId: string,
    action: ModerationActionType,
    moderatorId: string,
  ) {
    if (action === ModerationActionType.WARN) {
      return;
    }

    const key = this.moderationCooldownKey(robotId, targetUserId, action);
    const payload = JSON.stringify({
      moderatorId,
      createdAt: Date.now(),
    });
    const acquired = await this.redis.set(
      key,
      payload,
      'EX',
      ModerationService.ACTION_COOLDOWN_SEC,
      'NX',
    );
    if (acquired !== 'OK') {
      throw new BadRequestException('That moderation action is cooling down');
    }
  }

  private _getTargetLabel(
    targetUserId: string,
    target: { username: string; displayName: string | null } | null,
  ) {
    if (target) {
      return {
        username: target.username,
        displayName: target.displayName,
      };
    }

    const guestLabel = this._isGuestUserId(targetUserId) ? targetUserId.slice('guest:'.length) : targetUserId;
    return {
      username: `Guest-${guestLabel.slice(0, 6)}`,
      displayName: null,
    };
  }

}
