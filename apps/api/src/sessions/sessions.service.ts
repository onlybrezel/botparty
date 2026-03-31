import { Injectable, Logger } from '@nestjs/common';
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
    return this.prisma.session.findMany({
      where: { robotId },
      orderBy: { startedAt: 'desc' },
      take: limit,
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
      take: limit,
      include: {
        robot: {
          select: { id: true, name: true, slug: true, thumbnailUrl: true },
        },
      },
    });
  }

  async getActiveSession(robotId: string) {
    return this.prisma.session.findFirst({
      where: { robotId, status: 'ACTIVE' },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });
  }
}
