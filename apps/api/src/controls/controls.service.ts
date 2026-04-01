import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateControlButtonDto, UpdateControlButtonDto, ReorderControlButtonsDto } from './controls.dto';
import { LIMITS } from '@botparty/shared';

@Injectable()
export class ControlsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns all enabled buttons for a robot, sorted by position. */
  async getPublicButtons(robotId: string) {
    return this.prisma.controlButton.findMany({
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
    });
  }

  /** Returns all buttons (including disabled) for the robot owner / admins. */
  async getAllButtons(robotId: string) {
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

    return this.prisma.controlButton.create({
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
  }

  async update(buttonId: string, dto: UpdateControlButtonDto, requesterId: string) {
    const button = await this._findButtonOrThrow(buttonId);
    await this._assertOwner(button.robotId, requesterId);

    return this.prisma.controlButton.update({
      where: { id: buttonId },
      data: dto,
    });
  }

  async remove(buttonId: string, requesterId: string) {
    const button = await this._findButtonOrThrow(buttonId);
    await this._assertOwner(button.robotId, requesterId);

    await this.prisma.controlButton.delete({ where: { id: buttonId } });
  }

  async reorder(robotId: string, dto: ReorderControlButtonsDto, requesterId: string) {
    await this._assertOwner(robotId, requesterId);

    await this.prisma.$transaction(
      dto.order.map(({ id, position }) =>
        this.prisma.controlButton.update({ where: { id }, data: { position } }),
      ),
    );
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
}
