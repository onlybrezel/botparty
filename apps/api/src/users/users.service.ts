import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { hash } from 'argon2';
import type { Prisma } from '@botparty/prisma';
import { basename } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { UpdateAdminUserDto, UpdateMeDto } from './users.dto';
import type { JwtPayload } from '@botparty/shared';
import { createS3CompatibleStorageClient, resolveS3CompatibleStorageConfig } from '../common/s3-compatible-storage';
import { PlatformUserService } from '../wallet/platform-user.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly platformUser: PlatformUserService,
    private readonly config: ConfigService,
  ) {}

  private resolveLeaderboardSince(period?: string) {
    switch (period) {
      case '7d':
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  }

  private countSessionStreak(sessions: Array<{ startedAt: Date }>) {
    const uniqueDays = [...new Set(
      sessions.map((session) => {
        const date = new Date(session.startedAt);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
      }),
    )].sort().reverse();

    if (uniqueDays.length === 0) {
      return 0;
    }

    let streak = 1;
    let previous = new Date(`${uniqueDays[0]}T00:00:00.000Z`);
    for (const day of uniqueDays.slice(1)) {
      const current = new Date(`${day}T00:00:00.000Z`);
      const deltaDays = Math.round((previous.getTime() - current.getTime()) / (24 * 60 * 60 * 1000));
      if (deltaDays !== 1) {
        break;
      }
      streak += 1;
      previous = current;
    }

    return streak;
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        balance: true,
        credits: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async exportOwnData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        balance: true,
        credits: true,
        createdAt: true,
        emailVerified: true,
        robots: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            visibility: true,
            accessMode: true,
            queueMode: true,
            status: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 100,
          select: {
            id: true,
            robotId: true,
            startedAt: true,
            endedAt: true,
            durationMs: true,
            status: true,
            createdAt: true,
          },
        },
        queueEntries: {
          orderBy: { joinedAt: 'desc' },
          take: 100,
          select: {
            id: true,
            robotId: true,
            position: true,
            votes: true,
            joinedAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      exportedAt: new Date().toISOString(),
      profile: user,
    };
  }

  async findByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user || this.platformUser.isPlatformUser(user.id)) throw new NotFoundException('User not found');
    return user;
  }

  async getLeaderboard(input?: { limit?: number; period?: string }) {
    const limit = Math.min(input?.limit ?? 20, 100);
    const since = this.resolveLeaderboardSince(input?.period);
    const newOperatorThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const users = await this.prisma.user.findMany({
      where: { id: { not: this.platformUser.getPlatformUserId() } },
      take: limit,
      orderBy: { balance: 'desc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        balance: true,
        createdAt: true,
        sessions: {
          where: since ? { startedAt: { gte: since } } : undefined,
          orderBy: { startedAt: 'desc' },
          take: 180,
          select: {
            startedAt: true,
          },
        },
        robots: {
          select: {
            id: true,
            createdAt: true,
          },
        },
      },
    });

    return users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      credits: user.balance,
      createdAt: user.createdAt,
      recentSessions: user.sessions.length,
      streakDays: this.countSessionStreak(user.sessions),
      robotCount: user.robots.length,
      isNewOperator: user.robots.some((robot) => robot.createdAt >= newOperatorThreshold),
    }));
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const updates: { displayName?: string | null; avatarUrl?: string | null } = {};

    if (dto.displayName !== undefined) {
      const cleaned = dto.displayName.trim();
      updates.displayName = cleaned.length > 0 ? cleaned : null;
    }

    if (dto.avatarUrl !== undefined) {
      const cleaned = dto.avatarUrl.trim();
      updates.avatarUrl = cleaned.length > 0 ? this.normalizeAvatarUrl(cleaned) : null;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updates,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        balance: true,
        credits: true,
        createdAt: true,
      },
    });
  }

  async listUsersForStaff(input?: { q?: string; limit?: number }) {
    const limit = Math.max(1, Math.min(input?.limit ?? 100, 250));
    const query = input?.q?.trim();
    const platformId = this.platformUser.getPlatformUserId();

    return this.prisma.user.findMany({
      where: {
        id: { not: platformId },
        ...(query
          ? {
              OR: [
                { username: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
                { displayName: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: limit,
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        email: true,
        role: true,
        isActive: true,
        credits: true,
        balance: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  private normalizeAvatarUrl(value: string): string {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('Invalid avatar URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Avatar URL must use https');
    }

    return parsed.toString();
  }

  async updateUserByStaff(
    id: string,
    requester: JwtPayload,
    input: UpdateAdminUserDto,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [actor, target] = await Promise.all([
        tx.user.findUnique({
          where: { id: requester.sub },
          select: { id: true, role: true, isActive: true },
        }),
        tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            isActive: true,
          },
        }),
      ]);

      if (!actor || !actor.isActive) {
        throw new ForbiddenException('Staff account is inactive');
      }

      if (!target) {
        throw new NotFoundException('User not found');
      }

      if (this.platformUser.isPlatformUser(target.id)) {
        throw new ForbiddenException('Cannot modify the platform user');
      }

      const actorIsAdmin = actor.role === 'ADMIN';
      const targetIsStaff = target.role === 'ADMIN' || target.role === 'MOD';
      const wantsSensitiveChange =
        input.username !== undefined ||
        input.email !== undefined ||
        input.password !== undefined ||
        input.role !== undefined;

      if (!actorIsAdmin) {
        if (targetIsStaff) {
          throw new ForbiddenException('Mods can only manage regular user accounts');
        }

        if (wantsSensitiveChange) {
          throw new ForbiddenException('Only admins can change username, email, password, or role');
        }
      }

      const updates: {
        username?: string;
        email?: string;
        displayName?: string | null;
        passwordHash?: string;
        role?: 'ADMIN' | 'MOD' | 'USER';
        isActive?: boolean;
        credits?: number;
        balance?: number;
        tokenVersion?: { increment: number };
      } = {};

      if (input.username !== undefined) {
        const username = this.parseUsername(input.username.trim());
        if (username !== target.username) {
          const existing = await tx.user.findUnique({
            where: { username },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException('Username already taken');
          }
        }
        updates.username = username;
      }

      if (input.email !== undefined) {
        const email = this.parseEmail(input.email.trim().toLowerCase());
        if (email !== target.email) {
          const existing = await tx.user.findUnique({
            where: { email },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException('Email already registered');
          }
        }
        updates.email = email;
      }

      if (input.displayName !== undefined) {
        const next = typeof input.displayName === 'string' ? input.displayName.trim() : '';
        updates.displayName = next.length > 0 ? next : null;
      }

      if (input.password !== undefined) {
        const password = this.parsePassword(input.password);
        updates.passwordHash = await hash(password, { type: 2 });
        updates.tokenVersion = { increment: 1 };
      }

      if (input.role === 'ADMIN' || input.role === 'MOD' || input.role === 'USER') {
        if (target.role === 'ADMIN' && input.role !== 'ADMIN') {
          await this.ensureAnotherActiveAdminExists(tx, target.id);
        }
        updates.role = input.role;
      }

      if (typeof input.isActive === 'boolean') {
        if (target.role === 'ADMIN' && input.isActive === false) {
          await this.ensureAnotherActiveAdminExists(tx, target.id);
        }
        updates.isActive = input.isActive;
      }

      if (typeof input.credits === 'number' && Number.isFinite(input.credits)) {
        updates.credits = Math.round(input.credits);
      }

      // Balance changes are routed through walletService.adminAdjust below so
      // every mutation produces an audit-tagged ledger row.
      const balanceTarget =
        typeof input.balance === 'number' && Number.isFinite(input.balance)
          ? Math.round(input.balance)
          : null;

      if (Object.keys(updates).length === 0 && balanceTarget === null) {
        throw new BadRequestException('No valid user changes provided');
      }

      const updated = Object.keys(updates).length > 0
        ? await tx.user.update({
            where: { id },
            data: updates,
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              email: true,
              role: true,
              isActive: true,
              credits: true,
              balance: true,
              lastLoginAt: true,
              createdAt: true,
            },
          })
        : await tx.user.findUniqueOrThrow({
            where: { id },
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              email: true,
              role: true,
              isActive: true,
              credits: true,
              balance: true,
              lastLoginAt: true,
              createdAt: true,
            },
          });

      return { updated, balanceTarget };
    });

    if (result.balanceTarget !== null && result.balanceTarget !== result.updated.balance) {
      const delta = result.balanceTarget - result.updated.balance;
      if (delta !== 0) {
        await this.walletService.adminAdjust({
          userId: id,
          delta,
          reason: `staff balance set to ${result.balanceTarget}`,
          requesterId: requester.sub,
        });
        const refreshed = await this.prisma.user.findUnique({
          where: { id },
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            email: true,
            role: true,
            isActive: true,
            credits: true,
            balance: true,
            lastLoginAt: true,
            createdAt: true,
          },
        });
        if (refreshed) return refreshed;
      }
    }

    return result.updated;
  }

  async deleteUserByStaff(id: string, requester: JwtPayload) {
    await this.prisma.$transaction(async (tx) => {
      const [actor, target] = await Promise.all([
        tx.user.findUnique({
          where: { id: requester.sub },
          select: { id: true, role: true, isActive: true },
        }),
        tx.user.findUnique({
          where: { id },
          select: { id: true, role: true, isActive: true },
        }),
      ]);

      if (!actor || !actor.isActive) {
        throw new ForbiddenException('Staff account is inactive');
      }

      if (!target) {
        throw new NotFoundException('User not found');
      }

      if (this.platformUser.isPlatformUser(target.id)) {
        throw new ForbiddenException('Cannot delete the platform user');
      }

      if (target.id === actor.id) {
        throw new ForbiddenException('You cannot delete your own account from the staff dashboard');
      }

      const actorIsAdmin = actor.role === 'ADMIN';
      const targetIsStaff = target.role === 'ADMIN' || target.role === 'MOD';

      if (!actorIsAdmin) {
        if (targetIsStaff) {
          throw new ForbiddenException('Mods can only delete regular user accounts');
        }
      }

      if (target.role === 'ADMIN') {
        await this.ensureAnotherActiveAdminExists(tx, target.id);
      }

      await tx.user.delete({
        where: { id: target.id },
      });
    });
  }

  async deleteOwnAccount(userId: string) {
    const ownedRobots = await this.prisma.robot.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    await this.deleteOwnedRecordings(ownedRobots.map((robot) => robot.id));

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      });
      if (!user || !user.isActive) {
        return;
      }
      if (user.role === 'ADMIN') {
        await this.ensureAnotherActiveAdminExists(tx, userId);
      }
      await tx.user.delete({ where: { id: userId } });
    });
  }

  private async deleteOwnedRecordings(robotIds: string[]) {
    if (robotIds.length === 0) {
      return;
    }

    const storage = resolveS3CompatibleStorageConfig(this.config, 'LIVEKIT_RECORDINGS_S3_');
    if (!storage) {
      return;
    }

    const client = createS3CompatibleStorageClient(storage);
    const robotPrefixes = new Set(robotIds.map((robotId) => `robot-${robotId}`));
    const keysToDelete: string[] = [];
    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: storage.bucket,
          ContinuationToken: continuationToken,
        }),
      );

      for (const entry of listed.Contents ?? []) {
        const key = entry.Key?.trim();
        if (!key) {
          continue;
        }
        const fileName = basename(key);
        if ([...robotPrefixes].some((prefix) => fileName.startsWith(prefix))) {
          keysToDelete.push(key);
        }
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken ?? undefined : undefined;
    } while (continuationToken);

    for (let index = 0; index < keysToDelete.length; index += 1000) {
      const chunk = keysToDelete.slice(index, index + 1000).map((key) => ({ Key: key }));
      await client.send(
        new DeleteObjectsCommand({
          Bucket: storage.bucket,
          Delete: {
            Objects: chunk,
            Quiet: true,
          },
        }),
      );
    }
  }

  private async ensureAnotherActiveAdminExists(tx: Prisma.TransactionClient, excludedUserId: string) {
    const otherAdminCount = await tx.user.count({
      where: {
        role: 'ADMIN',
        isActive: true,
        id: { not: excludedUserId },
      },
    });

    if (otherAdminCount === 0) {
      throw new BadRequestException('At least one active admin account must remain');
    }
  }

  private parseUsername(value: string) {
    if (value.length < 3 || value.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(value)) {
      throw new BadRequestException('Only alphanumeric, hyphens, and underscores are allowed');
    }
    return value;
  }

  private parseEmail(value: string) {
    if (value.length === 0 || value.length > 255) {
      throw new BadRequestException('Invalid email');
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(value)) {
      throw new BadRequestException('Invalid email');
    }

    return value;
  }

  private parsePassword(value: string) {
    if (value.length < 8 || value.length > 128) {
      throw new BadRequestException('Password must be between 8 and 128 characters');
    }
    return value;
  }
}
