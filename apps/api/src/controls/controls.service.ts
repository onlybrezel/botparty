import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateControlButtonDto, UpdateControlButtonDto, ReorderControlButtonsDto } from './controls.dto';
import { LIMITS, ControlButtonAccess, Role } from '@botparty/shared';
import { assertRobotOwner } from '../common/robot-access';
import { RedisService } from '../redis/redis.service';
import type Redis from 'ioredis';
import { FeatureFlagsService } from '../common/feature-flags.service';
import { Prisma } from '@botparty/prisma';

type EnabledControlButtonRecord = {
  id: string;
  label: string;
  command: string;
  hotKey: string | null;
  icon: string | null;
  cooldownMs: number;
  access: ControlButtonAccess;
  position: number;
  color: string | null;
  costCredits: number;
};

type VisibleControlsRequester = {
  userId: string | null;
  role: Role | null;
  hasRoomAccess: boolean;
};

const ENABLED_BUTTON_CACHE_TTL_MS = 5_000;

@Injectable()
export class ControlsService implements OnModuleInit, OnModuleDestroy {
  private readonly enabledButtonsCache = new Map<
    string,
    { expiresAt: number; buttons: EnabledControlButtonRecord[] }
  >();
  private readonly _cacheSweeper: ReturnType<typeof setInterval>;
  private cacheSubscriber: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly features: FeatureFlagsService,
  ) {
    // Sweep expired entries every 60s to prevent unbounded Map growth.
    this._cacheSweeper = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.enabledButtonsCache) {
        if (entry.expiresAt <= now) this.enabledButtonsCache.delete(key);
      }
    }, 60_000);
  }

  async onModuleInit() {
    this.cacheSubscriber = this.redis.duplicate({ lazyConnect: true });
    await this.cacheSubscriber.connect();
    await this.cacheSubscriber.psubscribe('controls:invalidate:*');
    this.cacheSubscriber.on('pmessage', (_pattern, channel) => {
      const robotId = channel.slice('controls:invalidate:'.length);
      if (robotId) this.enabledButtonsCache.delete(robotId);
    });
  }

  async onModuleDestroy() {
    clearInterval(this._cacheSweeper);
    if (this.cacheSubscriber) await this.cacheSubscriber.quit();
  }

  /** Returns all enabled buttons for a robot, sorted by position. */
  async getPublicButtons(robotId: string) {
    return this.getVisibleButtons(robotId, {
      userId: null,
      role: null,
      hasRoomAccess: false,
    });
  }

  async getVisibleButtons(robotId: string, requester: VisibleControlsRequester) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { ownerId: true, visibility: true },
    });

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    if (!requester.hasRoomAccess) {
      if (robot.visibility === 'PRIVATE') {
        throw new NotFoundException('Robot not found');
      }
      return [];
    }

    const buttons = await this.getEnabledButtonsForRobot(robotId);
    const requesterIsOwner = requester.userId === robot.ownerId;
    const requesterCanModerate =
      requesterIsOwner || requester.role === Role.ADMIN || requester.role === Role.MOD;

    if (buttons.length === 0) {
      return this.getDefaultButtons();
    }

    return buttons.filter((button) => {
      if (
        button.access === ControlButtonAccess.EVERYONE ||
        button.access === ControlButtonAccess.QUEUE_TURN
      ) {
        return true;
      }

      if (button.access === ControlButtonAccess.MODERATOR) {
        return requesterCanModerate;
      }

      return requesterIsOwner;
    });
  }

  async getEnabledButtonsForRobot(robotId: string): Promise<EnabledControlButtonRecord[]> {
    const cached = this.enabledButtonsCache.get(robotId);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.buttons;
    }

    const buttons = (
      await this.prisma.controlButton.findMany({
      where: { robotId, isEnabled: true },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        label: true,
        command: true,
        hotKey: true,
        icon: true,
        cooldownMs: true,
        access: true,
        position: true,
        color: true,
        costCredits: true,
      },
      })
    ).map((button) => ({
      ...button,
      access: this.toSharedControlButtonAccess(button.access),
    }));

    this.enabledButtonsCache.set(robotId, {
      buttons,
      expiresAt: now + ENABLED_BUTTON_CACHE_TTL_MS,
    });

    return buttons;
  }

  /** Returns all buttons (including disabled) for the robot owner / admins. */
  async getAllButtons(robotId: string, requesterId: string) {
    await this._assertOwner(robotId, requesterId);

    return this.prisma.controlButton.findMany({
      where: { robotId },
      orderBy: { position: 'asc' },
    });
  }

  async create(robotId: string, dto: CreateControlButtonDto, requesterId: string) {
    await this._assertOwner(robotId, requesterId);
    if ((dto.costCredits ?? 0) > 0) this.features.assertEnabled('PAID_CONTROLS');

    const button = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${robotId}::uuid FOR UPDATE`);
      let count = await tx.controlButton.count({ where: { robotId } });
      if (count === 0) {
        await tx.controlButton.createMany({
          data: [
            {
              robotId,
              label: 'Forward',
              command: 'forward',
              hotKey: 'w',
              icon: '▲',
              cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
              access: 'QUEUE_TURN',
              position: 0,
              isEnabled: true,
            },
            {
              robotId,
              label: 'Left',
              command: 'left',
              hotKey: 'a',
              icon: '◀',
              cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
              access: 'QUEUE_TURN',
              position: 1,
              isEnabled: true,
            },
            {
              robotId,
              label: 'Back',
              command: 'backward',
              hotKey: 's',
              icon: '▼',
              cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
              access: 'QUEUE_TURN',
              position: 2,
              isEnabled: true,
            },
            {
              robotId,
              label: 'Right',
              command: 'right',
              hotKey: 'd',
              icon: '▶',
              cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
              access: 'QUEUE_TURN',
              position: 3,
              isEnabled: true,
            },
          ],
        });
        count = 4;
      }

      if (count >= LIMITS.MAX_CONTROL_BUTTONS) {
        throw new BadRequestException(
          `Maximum of ${LIMITS.MAX_CONTROL_BUTTONS} control buttons allowed per robot`,
        );
      }

      return tx.controlButton.create({
        data: {
          robotId,
          label: dto.label,
          command: dto.command,
          hotKey: dto.hotKey,
          icon: dto.icon,
          cooldownMs: dto.cooldownMs ?? LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
          access: dto.access ?? 'QUEUE_TURN',
          position: dto.position ?? count,
          isEnabled: dto.isEnabled ?? true,
          color: dto.color,
          costCredits: dto.costCredits ?? 0,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.invalidateEnabledButtonsCache(robotId);
    return button;
  }

  async update(buttonId: string, dto: UpdateControlButtonDto, requesterId: string) {
    const button = await this._findButtonOrThrow(buttonId);
    await this._assertOwner(button.robotId, requesterId);
    if ((dto.costCredits ?? 0) > 0) this.features.assertEnabled('PAID_CONTROLS');

    const updated = await this.prisma.controlButton.update({
      where: { id: buttonId },
      data: dto,
    });

    this.invalidateEnabledButtonsCache(button.robotId);
    return updated;
  }

  async remove(buttonId: string, requesterId: string) {
    const button = await this._findButtonOrThrow(buttonId);
    await this._assertOwner(button.robotId, requesterId);

    await this.prisma.controlButton.delete({ where: { id: buttonId } });
    this.invalidateEnabledButtonsCache(button.robotId);
  }

  async reorder(robotId: string, dto: ReorderControlButtonsDto, requesterId: string) {
    await this._assertOwner(robotId, requesterId);

    if (dto.order.length === 0) {
      return;
    }

    const buttonIds = dto.order.map(({ id }) => id);
    if (new Set(buttonIds).size !== buttonIds.length) {
      throw new BadRequestException('Duplicate control button IDs are not allowed');
    }

    const positions = dto.order.map(({ position }) => position);
    if (new Set(positions).size !== positions.length) {
      throw new BadRequestException('Duplicate control button positions are not allowed');
    }

    const ownedButtons = await this.prisma.controlButton.findMany({
      where: { robotId, id: { in: buttonIds } },
      select: { id: true },
    });

    if (ownedButtons.length !== buttonIds.length) {
      throw new BadRequestException('All reordered buttons must belong to the specified robot');
    }

    await this.prisma.$transaction(
      dto.order.map(({ id, position }) =>
        this.prisma.controlButton.updateMany({
          where: { id, robotId },
          data: { position },
        }),
      ),
    );

    this.invalidateEnabledButtonsCache(robotId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async _findButtonOrThrow(buttonId: string) {
    const button = await this.prisma.controlButton.findUnique({ where: { id: buttonId } });
    if (!button) throw new NotFoundException('Control button not found');
    return button;
  }

  private async _assertOwner(robotId: string, userId: string) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    assertRobotOwner(robot, userId);
  }

  private invalidateEnabledButtonsCache(robotId: string) {
    this.enabledButtonsCache.delete(robotId);
    void this.redis.publish(`controls:invalidate:${robotId}`, robotId);
  }

  private toSharedControlButtonAccess(access: string): ControlButtonAccess {
    switch (access) {
      case 'EVERYONE':
        return ControlButtonAccess.EVERYONE;
      case 'QUEUE_TURN':
        return ControlButtonAccess.QUEUE_TURN;
      case 'MODERATOR':
        return ControlButtonAccess.MODERATOR;
      case 'OWNER':
        return ControlButtonAccess.OWNER;
      default:
        throw new BadRequestException(`Unsupported control button access level: ${access}`);
    }
  }

  private getDefaultButtons(): EnabledControlButtonRecord[] {
    return [
      {
        id: 'default-forward',
        label: 'Forward',
        command: 'forward',
        hotKey: 'w',
        icon: '▲',
        cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
        access: ControlButtonAccess.QUEUE_TURN,
        position: 0,
        color: null,
        costCredits: 0,
      },
      {
        id: 'default-left',
        label: 'Left',
        command: 'left',
        hotKey: 'a',
        icon: '◀',
        cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
        access: ControlButtonAccess.QUEUE_TURN,
        position: 1,
        color: null,
        costCredits: 0,
      },
      {
        id: 'default-backward',
        label: 'Back',
        command: 'backward',
        hotKey: 's',
        icon: '▼',
        cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
        access: ControlButtonAccess.QUEUE_TURN,
        position: 2,
        color: null,
        costCredits: 0,
      },
      {
        id: 'default-right',
        label: 'Right',
        command: 'right',
        hotKey: 'd',
        icon: '▶',
        cooldownMs: LIMITS.DEFAULT_CONTROL_COOLDOWN_MS,
        access: ControlButtonAccess.QUEUE_TURN,
        position: 3,
        color: null,
        costCredits: 0,
      },
    ];
  }
}
