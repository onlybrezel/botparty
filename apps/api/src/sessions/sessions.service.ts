import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RobotsService } from '../robots/robots.service';
import { RobotWebhookService } from '../robots/robot-webhook.service';
import { RecordingAdminService } from '../moderation/recording-admin.service';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly robotsService: RobotsService,
    private readonly robotWebhookService: RobotWebhookService,
    private readonly recordingAdminService: RecordingAdminService,
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
    this.robotWebhookService.emitSessionStarted(session);
    this.prisma.analyticsEvent
      .create({ data: { robotId, userId, event: 'session_start', payload: { sessionId: session.id } } })
      .catch((err) => this.logger.warn(`analytics ingest failed: ${err?.message}`));
    return session;
  }

  async end(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status === 'ENDED') return session;

    const now = new Date();
    const durationMs = now.getTime() - session.startedAt.getTime();

    const ended = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED',
        endedAt: now,
        durationMs,
      },
    });
    this.prisma.analyticsEvent
      .create({
        data: {
          robotId: ended.robotId,
          userId: ended.userId,
          event: 'session_end',
          payload: { sessionId: ended.id, durationMs: ended.durationMs },
        },
      })
      .catch((err) => this.logger.warn(`analytics ingest failed: ${err?.message}`));
    this.robotWebhookService.emitSessionEnded(ended);
    return ended;
  }

  async findByRobot(robotId: string, limit = 50) {
    throw new ForbiddenException('Use requester-scoped session access');

    return this.findByRobotUnsafe(robotId, limit);
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

  async findDetailForRequester(sessionId: string, requesterId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        robot: {
          select: {
            id: true,
            name: true,
            slug: true,
            thumbnailUrl: true,
            ownerId: true,
            owner: {
              select: {
                id: true,
                username: true,
                displayName: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, role: true },
    });
    if (!requester) {
      throw new ForbiddenException('Authentication is required to view this session');
    }

    const isStaff = requester.role === 'ADMIN' || requester.role === 'MOD';
    const canView = isStaff || session.userId === requesterId || session.robot.ownerId === requesterId;
    if (!canView) {
      throw new ForbiddenException('Not allowed to view this session');
    }

    const replayCandidates = await this.recordingAdminService.findReplayCandidatesForSession({
      robotId: session.robotId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      recordingUrl: session.recordingUrl,
    });

    return {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      recordingUrl: session.recordingUrl,
      peakViewers: session.peakViewers,
      totalCommands: session.totalCommands,
      avgLatencyMs: session.avgLatencyMs,
      metadata: session.metadata,
      robot: {
        id: session.robot.id,
        name: session.robot.name,
        slug: session.robot.slug,
        thumbnailUrl: session.robot.thumbnailUrl,
        owner: session.robot.owner,
      },
      user: session.user,
      replayCandidates,
    };
  }

  async getActiveSession(robotId: string) {
    throw new ForbiddenException('Use requester-scoped session access');

    return this.getActiveSessionUnsafe(robotId);
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
    if (!requesterId) {
      throw new ForbiddenException('Authentication is required to view session history');
    }
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
