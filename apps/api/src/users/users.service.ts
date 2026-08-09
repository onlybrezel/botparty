import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash, verify } from 'argon2';
import { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { UpdateMeInput, UpdateAdminUserInput } from './users.schema';
import type { JwtPayload } from '@botparty/shared';
import { PlatformUserService } from '../wallet/platform-user.service';
import { StorageDeletionService } from '../storage/storage-deletion.service';

type UsersTransaction = {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  user: Pick<Prisma.TransactionClient['user'], 'count' | 'findUnique' | 'findUniqueOrThrow' | 'update'>;
  robot: Pick<Prisma.TransactionClient['robot'], 'deleteMany' | 'findMany'>;
  recording: Pick<Prisma.TransactionClient['recording'], 'findMany'>;
  storageDeletionTask: Pick<Prisma.TransactionClient['storageDeletionTask'], 'createMany'>;
};

type UsersDatabase = {
  $transaction<T>(callback: (tx: UsersTransaction) => Promise<T>): Promise<T>;
  adminAuditLog: Pick<PrismaService['adminAuditLog'], 'findMany'>;
  analyticsEvent: Pick<PrismaService['analyticsEvent'], 'findMany'>;
  billingIntent: Pick<PrismaService['billingIntent'], 'findMany'>;
  chatMessage: Pick<PrismaService['chatMessage'], 'findMany'>;
  payoutRequest: Pick<PrismaService['payoutRequest'], 'findMany'>;
  queueEntry: Pick<PrismaService['queueEntry'], 'findMany'>;
  recording: Pick<PrismaService['recording'], 'findMany'>;
  robot: Pick<PrismaService['robot'], 'findMany'>;
  robotModerationEntry: Pick<PrismaService['robotModerationEntry'], 'findMany'>;
  session: Pick<PrismaService['session'], 'findMany' | 'groupBy'>;
  transaction: Pick<PrismaService['transaction'], 'findMany' | 'groupBy'>;
  user: Pick<PrismaService['user'], 'findMany' | 'findUnique' | 'update'>;
};

type StaffWallet = {
  adminAdjustInTransaction(
    tx: UsersTransaction,
    input: { userId: string; delta: number; reason: string; requesterId: string },
  ): Promise<unknown>;
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: UsersDatabase,
    @Inject(WalletService) private readonly walletService: StaffWallet,
    @Inject(PlatformUserService)
    private readonly platformUser: Pick<PlatformUserService, 'getPlatformUserId' | 'isPlatformUser'>,
    @Inject(StorageDeletionService)
    private readonly storageDeletion: Pick<StorageDeletionService, 'enqueue' | 'recordingBucket' | 'thumbnailBucket'>,
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

  async exportOwnData(userId: string, password: string) {
    const account = await this.prisma.user.findUnique({
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
        legalAcceptedAt: true,
        acceptedTermsVersion: true,
        acceptedPrivacyVersion: true,
        emailVerified: true,
        passwordHash: true,
      },
    });

    if (!account) {
      throw new NotFoundException('User not found');
    }
    if (!(await verify(account.passwordHash, password))) {
      throw new ForbiddenException('Password confirmation failed');
    }

    const [robots, sessions, queueEntries, chatMessages, transactions, billingIntents, payouts, moderation, analytics, auditHistory, recordings] = await Promise.all([
      this.prisma.robot.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, slug: true, description: true, thumbnailUrl: true, visibility: true, accessMode: true, queueMode: true, status: true, tags: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.session.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        select: { id: true, robotId: true, startedAt: true, endedAt: true, durationMs: true, status: true, peakViewers: true, totalCommands: true, avgLatencyMs: true, createdAt: true },
      }),
      this.prisma.queueEntry.findMany({
        where: { userId },
        orderBy: { joinedAt: 'desc' },
        select: { id: true, robotId: true, position: true, votes: true, joinedAt: true, expiresAt: true },
      }),
      this.prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, robotId: true, content: true, isSystem: true, deletedAt: true, createdAt: true },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, amount: true, balanceAfter: true, ledgerGroupId: true, billingIntentId: true, payoutRequestId: true, description: true, createdAt: true },
      }),
      this.prisma.billingIntent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, providerRef: true, purchaseType: true, packageId: true, amountCents: true, currency: true, creditsAmount: true, reversedCredits: true, status: true, paidAt: true, refundedAt: true, termsVersion: true, immediateDeliveryConsentAt: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.payoutRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, status: true, destinationType: true, destinationLast4: true, notes: true, reviewedAt: true, providerRef: true, paidAt: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.robotModerationEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, robotId: true, action: true, reason: true, expiresAt: true, isActive: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.analyticsEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, robotId: true, event: true, createdAt: true },
      }),
      this.prisma.adminAuditLog.findMany({
        where: { OR: [{ actorId: userId }, { targetType: 'user', targetId: userId }] },
        orderBy: { createdAt: 'desc' },
        select: { id: true, action: true, targetType: true, targetId: true, createdAt: true },
      }),
      this.prisma.recording.findMany({
        where: { session: { userId } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, sessionId: true, robotId: true, cameraId: true, startedAt: true, endedAt: true, createdAt: true },
      }),
    ]);

    const { passwordHash: _passwordHash, ...profile } = account;
    void _passwordHash;

    return {
      exportedAt: new Date().toISOString(),
      profile,
      robots,
      sessions,
      queueEntries,
      chatMessages,
      transactions,
      billingIntents,
      payouts: payouts.map((payout) => ({
        ...payout,
        destination: `${payout.destinationType === 'IBAN' ? 'IBAN' : 'PayPal'} ••••${payout.destinationLast4}`,
      })),
      moderation,
      analytics,
      auditHistory,
      recordings,
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

  async getLeaderboard(input?: { limit?: number; period?: string; metric?: 'engagement' | 'creator_revenue' }) {
    const limit = Math.max(1, Math.min(input?.limit ?? 20, 100));
    const since = this.resolveLeaderboardSince(input?.period);
    const metric = input?.metric ?? 'engagement';
    const newOperatorThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const scoreByUser = new Map<string, number>();
    if (metric === 'creator_revenue') {
      const ranked = await this.prisma.transaction.groupBy({
          by: ['userId'],
          where: {
            type: { in: ['BUTTON_PAYOUT', 'DONATION_RECEIVED'] },
            ...(since ? { createdAt: { gte: since } } : {}),
          },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
          take: limit,
        });
      for (const row of ranked) {
        scoreByUser.set(row.userId, row._sum.amount ?? 0);
      }
    } else {
      const ranked = await this.prisma.session.groupBy({
          by: ['userId'],
          ...(since ? { where: { startedAt: { gte: since } } } : {}),
          _count: { _all: true },
          orderBy: { _count: { userId: 'desc' } },
          take: limit,
        });
      for (const row of ranked) {
        scoreByUser.set(row.userId, row._count._all);
      }
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...scoreByUser.keys()], not: this.platformUser.getPlatformUserId() } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        balance: true,
        createdAt: true,
        sessions: {
          ...(since ? { where: { startedAt: { gte: since } } } : {}),
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
      credits: scoreByUser.get(user.id) ?? 0,
      metric,
      createdAt: user.createdAt,
      recentSessions: user.sessions.length,
      streakDays: this.countSessionStreak(user.sessions),
      robotCount: user.robots.length,
      isNewOperator: user.robots.some((robot) => robot.createdAt >= newOperatorThreshold),
    })).sort((left, right) => right.credits - left.credits);
  }

  async updateMe(userId: string, dto: UpdateMeInput) {
    const updates: { displayName?: string | null } = {};

    if (dto.displayName !== undefined) {
      const cleaned = dto.displayName.trim();
      updates.displayName = cleaned.length > 0 ? cleaned : null;
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

  async listUsersForStaff(input?: { q?: string; limit?: number; requesterRole?: string }) {
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
                ...(input?.requesterRole === 'ADMIN' ? [{ email: { contains: query, mode: 'insensitive' } as const }] : []),
                { displayName: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      take: limit,
      orderBy: [{ createdAt: 'desc' }],
      select: input?.requesterRole === 'ADMIN' ? {
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
      } : {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async updateUserByStaff(
    id: string,
    requester: JwtPayload,
    input: UpdateAdminUserInput,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "users"
        WHERE id IN (${id}::uuid, ${requester.sub}::uuid)
        ORDER BY id
        FOR UPDATE
      `);
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
            deletedAt: true,
            balance: true,
          },
        }),
      ]);

      if (!actor?.isActive || actor.role !== 'ADMIN') {
        throw new ForbiddenException('Admin role required');
      }

      if (!target) {
        throw new NotFoundException('User not found');
      }

      if (target.deletedAt) {
        throw new ConflictException('Deleted accounts cannot be modified');
      }

      if (this.platformUser.isPlatformUser(target.id)) {
        throw new ForbiddenException('Cannot modify the platform user');
      }

      const updates: {
        username?: string;
        email?: string;
        displayName?: string | null;
        passwordHash?: string;
        role?: 'ADMIN' | 'MOD' | 'USER';
        isActive?: boolean;
        credits?: number;
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

      // Balance changes remain in this transaction so the profile mutation,
      // authority check, balance and audit ledger commit atomically.
      const balanceTarget =
        typeof input.balance === 'number' && Number.isFinite(input.balance)
          ? Math.round(input.balance)
          : null;

      if (Object.keys(updates).length === 0 && balanceTarget === null) {
        throw new BadRequestException('No valid user changes provided');
      }

      if (balanceTarget !== null && balanceTarget !== target.balance) {
        await this.walletService.adminAdjustInTransaction(tx, {
          userId: id,
          delta: balanceTarget - target.balance,
          reason: `staff balance set to ${balanceTarget}`,
          requesterId: requester.sub,
        });
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

      return updated;
    });
    return result;
  }

  async deleteUserByStaff(id: string, requester: JwtPayload) {
    if (this.platformUser.isPlatformUser(id)) {
      throw new ForbiddenException('Cannot delete the platform user');
    }

    if (id === requester.sub) {
      throw new ForbiddenException('You cannot delete your own account from the staff dashboard');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "users"
        WHERE id IN (${id}::uuid, ${requester.sub}::uuid)
        ORDER BY id
        FOR UPDATE
      `);
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
      if (!actor?.isActive || actor.role !== 'ADMIN') {
        throw new ForbiddenException('Admin role required');
      }
      if (!target) {
        throw new NotFoundException('User not found');
      }
      if (target.role === 'ADMIN') {
        await this.ensureAnotherActiveAdminExists(tx, target.id);
      }
      await this.enqueueOwnedObjectDeletions(tx, target.id);
      await tx.robot.deleteMany({ where: { ownerId: target.id } });
      await this.anonymizeUser(tx, target.id);
    });
  }

  async deleteOwnAccount(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR UPDATE`);
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
      await this.enqueueOwnedObjectDeletions(tx, userId);
      await tx.robot.deleteMany({ where: { ownerId: userId } });
      await this.anonymizeUser(tx, userId);
    });
  }

  private anonymizeUser(tx: UsersTransaction, userId: string) {
    const suffix = userId.replace(/-/g, '').slice(0, 20);
    return tx.user.update({
      where: { id: userId },
      data: {
        username: `deleted_${suffix}`,
        email: `deleted+${userId}@botparty.invalid`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$disabled-disabled-disabled-disabled$disabled-disabled-disabled-disabled-disabled-disabled-disabled',
        displayName: null,
        avatarUrl: null,
        role: 'USER',
        isActive: false,
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
        tokenVersion: { increment: 1 },
        deletedAt: new Date(),
      },
    });
  }

  private async enqueueOwnedObjectDeletions(tx: UsersTransaction, ownerId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "robots" WHERE "ownerId" = ${ownerId}::uuid FOR UPDATE
    `);
    const [recordings, robots] = await Promise.all([
      tx.recording.findMany({
        where: { robot: { ownerId } },
        select: { objectKey: true },
      }),
      tx.robot.findMany({ where: { ownerId }, select: { id: true } }),
    ]);
    await this.storageDeletion.enqueue(
      tx,
      this.storageDeletion.recordingBucket,
      recordings.map((recording) => recording.objectKey),
    );
    await this.storageDeletion.enqueue(
      tx,
      this.storageDeletion.thumbnailBucket,
      [
        `avatars/${ownerId}/`,
        ...robots.map((robot) => `robot-thumbnails/${robot.id}/`),
      ],
    );
  }

  private async ensureAnotherActiveAdminExists(tx: UsersTransaction, excludedUserId: string) {
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
