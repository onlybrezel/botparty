import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ModerateUserDto } from './moderation.dto';
import { ModerationActionType, WS_EVENTS } from '@botparty/shared';

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Apply a moderation action to a user within a robot's room.
   * The caller must be the robot owner OR a site moderator/admin.
   */
  async moderate(robotId: string, dto: ModerateUserDto, moderatorId: string) {
    const [robot, moderator, target] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: moderatorId } }),
      this.prisma.user.findUnique({ where: { id: dto.targetUserId } }),
    ]);

    if (!robot) throw new NotFoundException('Robot not found');
    if (!moderator) throw new NotFoundException('Moderator not found');
    if (!target) throw new NotFoundException('Target user not found');

    const isSiteStaff = this._isStaffRole(moderator.role);
    if (robot.ownerId !== moderatorId && !isSiteStaff) {
      throw new ForbiddenException('Only the robot owner or site staff can moderate');
    }

    // Prevent moderating site admins
    if (target.role === 'ADMIN' && !isSiteStaff) {
      throw new ForbiddenException('Cannot moderate a site admin');
    }

    // Deactivate existing active entries for same robot+user (we replace them)
    if (dto.action !== ModerationActionType.UNBAN) {
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
      await this.prisma.robotModerationEntry.updateMany({
        where: { robotId, userId: dto.targetUserId, isActive: true },
        data: { isActive: false },
      });
      // Publish unban event for the gateway to react to
      await this.redis.publish(
        `ws:room:${robotId}`,
        JSON.stringify({
          event: WS_EVENTS.MOD_UNBAN,
          data: { userId: dto.targetUserId, robotId },
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
        isActive: true,
        moderatorId,
      },
    });

    // Publish to Redis so the gateway can enforce and notify the room
    const wsEvent =
      dto.action === ModerationActionType.BAN
        ? WS_EVENTS.MOD_BAN
        : dto.action === ModerationActionType.KICK
          ? WS_EVENTS.MOD_KICK
          : WS_EVENTS.MOD_TIMEOUT;

    await this.redis.publish(
      `ws:room:${robotId}`,
      JSON.stringify({
        event: wsEvent,
        data: {
          userId: dto.targetUserId,
          moderatorId,
          reason: dto.reason,
          expiresAt,
          robotId,
        },
      }),
    );

    return entry;
  }

  /** Check whether a user is currently banned or timed-out in a robot room. */
  async getActiveRestriction(robotId: string, userId: string) {
    const entry = await this.prisma.robotModerationEntry.findFirst({
      where: {
        robotId,
        userId,
        isActive: true,
        action: { in: ['BAN', 'TIMEOUT', 'KICK'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    // Expire timed-out entries lazily
    if (entry && entry.expiresAt && entry.expiresAt <= new Date()) {
      await this.prisma.robotModerationEntry.update({
        where: { id: entry.id },
        data: { isActive: false },
      });
      return null;
    }

    return entry;
  }

  /** Get moderation log for a robot (owner / site staff only). */
  async getLog(robotId: string, requesterId: string) {
    await this._assertStaffOrOwner(robotId, requesterId);
    return this.prisma.robotModerationEntry.findMany({
      where: { robotId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, username: true, displayName: true } },
        moderator: { select: { id: true, username: true } },
      },
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async _assertStaffOrOwner(robotId: string, userId: string) {
    const [robot, user] = await Promise.all([
      this.prisma.robot.findUnique({ where: { id: robotId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!robot) throw new NotFoundException('Robot not found');
    if (!user) throw new NotFoundException('User not found');
    const isStaff = this._isStaffRole(user.role);
    if (robot.ownerId !== userId && !isStaff) {
      throw new ForbiddenException('Access denied');
    }
  }

  private _isStaffRole(role: string): boolean {
    return role === 'ADMIN' || role === 'MOD' || role === 'MODERATOR';
  }
}
