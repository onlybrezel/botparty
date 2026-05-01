import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isStaffRole } from '../common/robot-access';

@Injectable()
export class RuntimeTelemetryDbService {
  constructor(private readonly prisma: PrismaService) {}

  async getStaffRequester(requesterId: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester || !isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    return requester;
  }

  async getRobots() {
    return this.prisma.robot.findMany({
      orderBy: [{ status: 'asc' }, { viewerCount: 'desc' }, { createdAt: 'desc' }],
      take: 120,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        visibility: true,
        queueMode: true,
        viewerCount: true,
        lastOnlineAt: true,
        createdAt: true,
        owner: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  async getQueueEntries(robotIds: string[]) {
    if (!robotIds.length) {
      return [];
    }

    return this.prisma.queueEntry.findMany({
      where: { robotId: { in: robotIds } },
      select: {
        robotId: true,
        userId: true,
        position: true,
        votes: true,
        isPriority: true,
        joinedAt: true,
        user: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  async getActiveSessions(robotIds: string[]) {
    if (!robotIds.length) {
      return [];
    }

    return this.prisma.session.findMany({
      where: { robotId: { in: robotIds }, status: 'ACTIVE' },
      select: {
        id: true,
        robotId: true,
        startedAt: true,
        user: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  sortQueueEntries<
    T extends {
      isPriority: boolean;
      votes: number;
      position: number;
      joinedAt: Date;
    },
  >(queueMode: string, entries: T[]) {
    return [...entries].sort((left, right) => {
      if (left.isPriority !== right.isPriority) {
        return left.isPriority ? -1 : 1;
      }

      if (queueMode === 'VOTING' && left.votes !== right.votes) {
        return right.votes - left.votes;
      }

      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.joinedAt.getTime() - right.joinedAt.getTime();
    });
  }
}
