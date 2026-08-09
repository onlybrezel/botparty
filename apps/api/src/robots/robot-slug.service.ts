import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SLUG_PROFANITY_TERMS } from './profanity-terms';

@Injectable()
export class RobotSlugService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: {
      $transaction: PrismaService['$transaction'];
      robot: Pick<PrismaService['robot'], 'findFirst' | 'findMany' | 'findUnique' | 'update'>;
    },
  ) {}

  generateSlug(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'robot';
    const compact = base.replace(/-/g, '');
    const safeBase = SLUG_PROFANITY_TERMS.some((term) => compact.includes(term)) ? 'robot' : base;
    const suffix = randomBytes(3).toString('hex');
    return `${safeBase}-${suffix}`;
  }

  validateAndNormalizeSlugInput(rawSlug: string): string {
    const slug = rawSlug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      throw new BadRequestException('Slug must be 3-50 lowercase alphanumeric characters and hyphens');
    }

    const compact = slug.replace(/-/g, '');
    if (SLUG_PROFANITY_TERMS.some((term) => compact.includes(term))) {
      throw new BadRequestException('Slug blocked by moderation policy');
    }

    return slug;
  }

  async buildSlugUpdate(
    robotId: string,
    currentSlug: string,
    currentSlugAliases: string[] | undefined,
    nextSlugInput?: string,
  ): Promise<{ slug: string; slugAliases: { set: string[] } } | undefined> {
    if (!nextSlugInput || nextSlugInput === currentSlug) {
      return undefined;
    }

    const nextSlug = this.validateAndNormalizeSlugInput(nextSlugInput);
    const conflict = await this.prisma.robot.findFirst({
      where: { slug: nextSlug, NOT: { id: robotId } },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('This slug is already taken');
    }

    await this.reclaimSlugAlias(nextSlug, robotId);
    const aliases = Array.isArray(currentSlugAliases) ? currentSlugAliases : [];

    return {
      slug: nextSlug,
      slugAliases: { set: Array.from(new Set([...aliases, currentSlug])) },
    };
  }

  async reclaimSlugAlias(slug: string, excludeRobotId?: string) {
    const holders = await this.prisma.robot.findMany({
      where: {
        slugAliases: { has: slug },
        ...(excludeRobotId ? { NOT: { id: excludeRobotId } } : {}),
      },
      select: { id: true, slugAliases: true },
    });

    if (holders.length === 0) return;

    await this.prisma.$transaction(
      holders.map((row) =>
        this.prisma.robot.update({
          where: { id: row.id },
          data: {
            slugAliases: { set: (row.slugAliases ?? []).filter((entry) => entry !== slug) },
          },
        }),
      ),
    );
  }

  async findRobotBySlugAny(slug: string) {
    const canonical = await this.prisma.robot.findUnique({
      where: { slug },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
        },
      },
    });
    if (canonical) return canonical;

    return this.prisma.robot.findFirst({
      where: { slugAliases: { has: slug } },
      include: {
        owner: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
