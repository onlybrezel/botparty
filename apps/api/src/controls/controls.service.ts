import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateControlButtonDto, UpdateControlButtonDto, ReorderControlButtonsDto } from './controls.dto';
import { LIMITS, ControlButtonAccess, Role } from '@botparty/shared';

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
};

type VisibleControlsRequester = {
  userId: string | null;
  role: Role | null;
  hasRoomAccess: boolean;
};

const ENABLED_BUTTON_CACHE_TTL_MS = 5_000;

@Injectable()
export class ControlsService {
  private readonly enabledButtonsCache = new Map<
    string,
    { expiresAt: number; buttons: EnabledControlButtonRecord[] }
  >();

  constructor(private readonly prisma: PrismaService) {}

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
      select: { ownerId: true },
    });

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    if (!requester.hasRoomAccess) {
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

    const count = await this.prisma.controlButton.count({ where: { robotId } });
    if (count >= LIMITS.MAX_CONTROL_BUTTONS) {
      throw new BadRequestException(
        `Maximum of ${LIMITS.MAX_CONTROL_BUTTONS} control buttons allowed per robot`,
      );
    }

    const button = await this.prisma.controlButton.create({
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
      },
    });

    this.invalidateEnabledButtonsCache(robotId);
    return button;
  }

  async update(buttonId: string, dto: UpdateControlButtonDto, requesterId: string) {
    const button = await this._findButtonOrThrow(buttonId);
    await this._assertOwner(button.robotId, requesterId);

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
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== userId) throw new ForbiddenException('Not the robot owner');
  }

  private invalidateEnabledButtonsCache(robotId: string) {
    this.enabledButtonsCache.delete(robotId);
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
      },
    ];
  }
}
