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
      take: limit,
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
}
