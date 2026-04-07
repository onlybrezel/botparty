import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(robotId: string, userId: string) {
    const session = await this.prisma.session.create({
      data: { robotId, userId },
    });

    // Increment robot session count
    await this.prisma.robot.update({
      where: { id: robotId },
      data: { totalSessions: { increment: 1 } },
    });

    this.logger.log(`Session started: ${session.id} (robot: ${robotId}, user: ${userId})`);
    return session;
  }

  async end(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status === 'ENDED') return session;

    const now = new Date();
    const durationMs = now.getTime() - session.startedAt.getTime();

    return this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED',
        endedAt: now,
        durationMs,
      },
    });
  }

  async findByRobot(robotId: string, limit = 50) {
    await this.assertCanViewRobotSessions(robotId, null);

    return this.prisma.session.findMany({
      where: { robotId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  async findByUser(userId: string, limit = 50) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        robot: {
          select: { id: true, name: true, slug: true, thumbnailUrl: true },
        },
      },
    });
  }

  async getActiveSession(robotId: string) {
    await this.assertCanViewRobotSessions(robotId, null);

    return this.prisma.session.findFirst({
      where: { robotId, status: 'ACTIVE' },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });
  }

  async findByRobotForRequester(robotId: string, requesterId: string | null, limit = 50) {
    await this.assertCanViewRobotSessions(robotId, requesterId);
    return this.findByRobotUnsafe(robotId, limit);
  }

  async getActiveSessionForRequester(robotId: string, requesterId: string | null) {
    await this.assertCanViewRobotSessions(robotId, requesterId);
    return this.getActiveSessionUnsafe(robotId);
  }

  async endAllActiveSessions() {
    const now = new Date();
    await this.prisma.session.updateMany({
      where: { status: 'ACTIVE' },
      data: {
        status: 'ENDED',
        endedAt: now,
      },
    });
  }

  private async findByRobotUnsafe(robotId: string, limit = 50) {
    return this.prisma.session.findMany({
      where: { robotId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  private async getActiveSessionUnsafe(robotId: string) {
    return this.prisma.session.findFirst({
      where: { robotId, status: 'ACTIVE' },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });
  }

  private async assertCanViewRobotSessions(robotId: string, requesterId: string | null) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { ownerId: true, visibility: true },
    });

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    if (robot.visibility === 'PUBLIC') {
      return;
    }

    if (!requesterId) {
      throw new ForbiddenException('Not allowed to view sessions for this robot');
    }

    if (robot.ownerId === requesterId) {
      return;
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });

    if (requester?.role === 'ADMIN' || requester?.role === 'MOD') {
      return;
    }

    throw new ForbiddenException('Not allowed to view sessions for this robot');
  }
}
