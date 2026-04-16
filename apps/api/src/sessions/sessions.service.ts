import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RobotsService } from '../robots/robots.service';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly robotsService: RobotsService,
  ) {}

  async create(robotId: string, userId: string) {
    const session = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const activeSessions = await tx.session.findMany({
        where: { robotId, status: 'ACTIVE' },
        select: { id: true, startedAt: true },
      });

      for (const activeSession of activeSessions) {
        await tx.session.update({
          where: { id: activeSession.id },
          data: {
            status: 'ENDED',
            endedAt: now,
            durationMs: now.getTime() - activeSession.startedAt.getTime(),
          },
        });
      }

      const createdSession = await tx.session.create({
        data: { robotId, userId },
      });

      await tx.robot.update({
        where: { id: robotId },
        data: { totalSessions: { increment: 1 } },
      });

      return createdSession;
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

  async findByRobotForRequester(
    robotId: string,
    requesterId: string | null,
    limit = 50,
    roomAccessToken?: string,
    guestSessionId?: string,
  ) {
    await this.assertCanViewRobotSessions(robotId, requesterId, roomAccessToken, guestSessionId);
    return this.findByRobotUnsafe(robotId, limit);
  }

  async getActiveSessionForRequester(
    robotId: string,
    requesterId: string | null,
    roomAccessToken?: string,
    guestSessionId?: string,
  ) {
    await this.assertCanViewRobotSessions(robotId, requesterId, roomAccessToken, guestSessionId);
    return this.getActiveSessionUnsafe(robotId);
  }

  async endAllActiveSessions() {
    const now = new Date();
    const active = await this.prisma.session.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, startedAt: true },
    });

    if (active.length === 0) return;

    for (const session of active) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          status: 'ENDED',
          endedAt: now,
          durationMs: now.getTime() - session.startedAt.getTime(),
        },
      });
    }

    this.logger.log(`Reconciled ${active.length} orphaned active session(s) on startup`);
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

  private async assertCanViewRobotSessions(
    robotId: string,
    requesterId: string | null,
    roomAccessToken?: string,
    guestSessionId?: string,
  ) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true },
    });

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const actorId =
      requesterId ??
      this.robotsService.resolveGuestActorId(guestSessionId) ??
      'guest:anonymous';
    const allowed = await this.robotsService.validateRoomAccess({
      robotId,
      actorId,
      roomAccessToken,
    });
    if (allowed) {
      return;
    }

    throw new ForbiddenException('Not allowed to view sessions for this robot');
  }
}
