import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'argon2';
import type { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAdminUserDto, UpdateMeDto } from './users.dto';
import type { JwtPayload } from '@botparty/shared';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getLeaderboard(limit = 20) {
    return this.prisma.user.findMany({
      take: Math.min(limit, 100),
      orderBy: { credits: 'desc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        credits: true,
      },
    });
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const updates: { displayName?: string | null; avatarUrl?: string | null } = {};

    if (dto.displayName !== undefined) {
      const cleaned = dto.displayName.trim();
      updates.displayName = cleaned.length > 0 ? cleaned : null;
    }

    if (dto.avatarUrl !== undefined) {
      const cleaned = dto.avatarUrl.trim();
      updates.avatarUrl = cleaned.length > 0 ? cleaned : null;
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

    return this.prisma.user.findMany({
      where: query
        ? {
            OR: [
              { username: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
              { displayName: { contains: query, mode: 'insensitive' } },
            ],
          }
        : undefined,
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

  async updateUserByStaff(
    id: string,
    requester: JwtPayload,
    input: UpdateAdminUserDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
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

      if (typeof input.balance === 'number' && Number.isFinite(input.balance)) {
        updates.balance = Math.round(input.balance);
      }

      if (Object.keys(updates).length === 0) {
        throw new BadRequestException('No valid user changes provided');
      }

      return tx.user.update({
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
      });
    });
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

  private async ensureAnotherActiveAdminExists(tx: Prisma.TransactionClient, excludedUserId: string) {    const otherAdminCount = await tx.user.count({
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
