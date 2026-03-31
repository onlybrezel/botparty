import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createRobotSchema, updateRobotSchema } from '@botparty/shared';
import { randomBytes } from 'crypto';
import type { z } from 'zod';

@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, input: z.infer<typeof createRobotSchema>) {
    const data = createRobotSchema.parse(input);

    const slug = this.generateSlug(data.name);
    const streamKey = randomBytes(32).toString('hex');
    const claimToken = randomBytes(32).toString('hex');

    const robot = await this.prisma.robot.create({
      data: {
        ...data,
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

    this.logger.log(`Robot created: ${robot.name} (${robot.slug}) by ${ownerId}`);
    return robot;
  }

  async findAll(filters?: { visibility?: string; status?: string; tag?: string }) {
    return this.prisma.robot.findMany({
      where: {
        visibility: 'PUBLIC',
        ...(filters?.status && { status: filters.status as 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE' }),
        ...(filters?.tag && { tags: { has: filters.tag } }),
      },
      orderBy: [{ isFeatured: 'desc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { slug },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
        },
      },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    return robot;
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
    return this.prisma.robot.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, ownerId: string, input: z.infer<typeof updateRobotSchema>) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const data = updateRobotSchema.parse(input);
    return this.prisma.robot.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    await this.prisma.robot.delete({ where: { id } });
    this.logger.log(`Robot deleted: ${robot.name}`);
  }

  async regenerateClaimToken(id: string, ownerId: string) {
    const robot = await this.findById(id);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const claimToken = randomBytes(32).toString('hex');
    return this.prisma.robot.update({
      where: { id },
      data: { claimToken },
      select: { id: true, claimToken: true },
    });
  }

  async updateStatus(id: string, status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE') {
    return this.prisma.robot.update({
      where: { id },
      data: {
        status,
        lastOnlineAt: status === 'ONLINE' ? new Date() : undefined,
      },
    });
  }

  async getFeatured() {
    return this.prisma.robot.findMany({
      where: { isFeatured: true, visibility: 'PUBLIC' },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const suffix = randomBytes(3).toString('hex');
    return `${base}-${suffix}`;
  }
}
