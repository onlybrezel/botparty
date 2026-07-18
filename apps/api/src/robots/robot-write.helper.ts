import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createRobotSchema, updateRobotSchema, LIMITS } from '@botparty/shared';
import type { Prisma } from '@botparty/prisma';
import { createHash, randomBytes } from 'crypto';
import { hash } from 'argon2';
import type { z } from 'zod';
import { isStaffRole } from '../common/robot-access';
import type { PrismaService } from '../prisma/prisma.service';
import type { RobotAccessService } from './robot-access.service';
import type { RobotDeviceService } from './robot-device.service';
import type { RobotInviteService } from './robot-invite.service';
import type { RobotSlugService } from './robot-slug.service';
import {
  DEFAULT_ROBOT_CONTROLS,
  assertRobotTextAllowed,
  mergeRobotMetadataPatch,
  sanitizeManagedRobot,
  stripRobotWriteFields,
  withStreamKeyIssuedAt,
} from './robots.service.helpers';

export class RobotWriteHelper {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RobotAccessService,
    private readonly deviceService: RobotDeviceService,
    private readonly slugService: RobotSlugService,
    private readonly inviteService: RobotInviteService,
  ) {}

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>, maxRobotsPerOwner: number) {
    if (maxRobotsPerOwner > 0) {
      const existingRobots = await this.prisma.robot.count({ where: { ownerId } });
      if (existingRobots >= maxRobotsPerOwner) {
        throw new BadRequestException(
          `Maximum of ${maxRobotsPerOwner} robots allowed per operator account`,
        );
      }
    }

    const data = createRobotSchema.parse(input);
    assertRobotTextAllowed(data);
    const metadata = withStreamKeyIssuedAt(
      this.deviceService.withClaimTokenIssuedAt(mergeRobotMetadataPatch(null, data.acl, data.stream)),
    );
    const baseData = stripRobotWriteFields(data);

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
      data.accessMode === 'PASSWORD' && data.accessPassword
        ? await hash(data.accessPassword, { type: 2 })
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
        streamKeyHash: createHash('sha256').update(streamKey).digest('hex'),
        claimTokenHash: createHash('sha256').update(claimToken).digest('hex'),
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

    return { ...sanitizeManagedRobot(robot), streamKey, claimToken };
  }

  async applyRobotUpdate(
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
    assertRobotTextAllowed(data);
    const metadata = mergeRobotMetadataPatch(robot.metadata, data.acl, data.stream);
    const baseData = stripRobotWriteFields(data);
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
        ? data.accessPassword
          ? await hash(data.accessPassword, { type: 2 })
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

    return sanitizeManagedRobot(updated);
  }

  async regenerateClaimToken(robot: { id: string; metadata: unknown }) {
    const claimToken = randomBytes(32).toString('hex');
    const rotated = await this.prisma.robot.update({
      where: { id: robot.id },
      data: {
        claimTokenHash: createHash('sha256').update(claimToken).digest('hex'),
        deviceTokenVersion: { increment: 1 },
        metadata: this.deviceService.withClaimTokenIssuedAt(
          this.deviceService.clearBoundDeviceMetadata(robot.metadata),
        ) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { ...rotated, claimToken };
  }

  async regenerateInviteCode(robotId: string) {
    const inviteCode = await this.inviteService.generateUniqueInviteCode();
    return this.prisma.robot.update({
      where: { id: robotId },
      data: { inviteCode },
      select: { id: true, inviteCode: true },
    });
  }

  async ensureInviteCode(robotId: string) {
    const inviteCode = await this.inviteService.generateUniqueInviteCode();
    return this.prisma.robot.update({
      where: { id: robotId },
      data: { inviteCode },
      select: { id: true, inviteCode: true },
    });
  }

  async assertPrivateAccessForRequester(
    robot: { visibility: string; ownerId: string },
    requesterId: string,
  ): Promise<void> {
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
  }
}
