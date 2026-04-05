import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMeDto } from './users.dto';

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
    input: {
      displayName?: string | null;
      role?: 'ADMIN' | 'MOD' | 'USER';
      isActive?: boolean;
      credits?: number;
      balance?: number;
    },
  ) {
    const updates: {
      displayName?: string | null;
      role?: 'ADMIN' | 'MOD' | 'USER';
      isActive?: boolean;
      credits?: number;
      balance?: number;
    } = {};

    if (input.displayName !== undefined) {
      const next = typeof input.displayName === 'string' ? input.displayName.trim() : '';
      updates.displayName = next.length > 0 ? next : null;
    }

    if (input.role === 'ADMIN' || input.role === 'MOD' || input.role === 'USER') {
      updates.role = input.role;
    }

    if (typeof input.isActive === 'boolean') {
      updates.isActive = input.isActive;
    }

    if (typeof input.credits === 'number' && Number.isFinite(input.credits)) {
      updates.credits = Math.round(input.credits);
    }

    if (typeof input.balance === 'number' && Number.isFinite(input.balance)) {
      updates.balance = Math.round(input.balance);
    }

    return this.prisma.user.update({
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
  }
}
