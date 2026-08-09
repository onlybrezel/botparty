import { ForbiddenException, Injectable, StreamableFile } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingAdminService } from './recording-admin.service';
import { RuntimeTelemetryService } from './runtime-telemetry.service';
import { RobotsService } from '../robots/robots.service';
import type { RobotActionPayload } from '../robots/robots.types';
import { isStaffRole } from '../common/robot-access';

@Injectable()
export class ModerationOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly robotsService: RobotsService,
    private readonly recordingAdmin: RecordingAdminService,
    private readonly runtimeTelemetry: RuntimeTelemetryService,
  ) {}

  async getAdminOverview(requesterId: string, robotId?: string) {
    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    if (!requester || !isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }

    const activeWhere = {
      isActive: true,
      ...(robotId ? { robotId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    const [recentActions, activeRestrictions, robots] = await Promise.all([
      this.prisma.robotModerationEntry.findMany({
        ...(robotId ? { where: { robotId } } : {}),
        orderBy: { createdAt: 'desc' },
        take: 150,
        include: {
          robot: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, username: true, displayName: true } },
          moderator: { select: { id: true, username: true } },
        },
      }),
      this.prisma.robotModerationEntry.findMany({
        where: activeWhere,
        orderBy: { createdAt: 'desc' },
        take: 150,
        include: {
          robot: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, username: true, displayName: true } },
          moderator: { select: { id: true, username: true } },
        },
      }),
      this.prisma.robot.findMany({
        ...(robotId ? { where: { id: robotId } } : {}),
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          description: true,
          thumbnailUrl: true,
          visibility: true,
          accessMode: true,
          queueMode: true,
          scheduleStart: true,
          scheduleEnd: true,
          timezone: true,
          maxTurnTime: true,
          maxViewers: true,
          maxControllers: true,
          metadata: true,
          tags: true,
          owner: { select: { id: true, username: true, displayName: true } },
        },
      }),
    ]);

    return {
      recentActions,
      activeRestrictions,
      robots,
      counts: {
        bans: activeRestrictions.filter((entry: { action: string }) => entry.action === 'BAN').length,
        timeouts: activeRestrictions.filter((entry: { action: string }) => entry.action === 'TIMEOUT').length,
        kicks: activeRestrictions.filter((entry: { action: string }) => entry.action === 'KICK').length,
      },
    };
  }

  async getAdminRuntimeOverview(requesterId: string) {
    return this.runtimeTelemetry.getAdminRuntimeOverview(requesterId);
  }

  async enqueueStaffRobotAction(
    robotId: string,
    requesterId: string,
    payload: RobotActionPayload,
  ) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });
    if (!requester || !isStaffRole(requester.role)) {
      throw new ForbiddenException('Access denied');
    }
    return this.robotsService.enqueueActionForRobot(robotId, payload);
  }

  async getAdminRobotRecordingStatus(robotId: string, requesterId: string) {
    return this.recordingAdmin.getAdminRobotRecordingStatus(robotId, requesterId);
  }

  async startAdminRobotRecording(robotId: string, requesterId: string) {
    return this.recordingAdmin.startAdminRobotRecording(robotId, requesterId);
  }

  async stopAdminRobotRecording(robotId: string, requesterId: string) {
    return this.recordingAdmin.stopAdminRobotRecording(robotId, requesterId);
  }

  async listAdminRecordings(requesterId: string) {
    return this.recordingAdmin.listAdminRecordings(requesterId);
  }

  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> {
    return this.recordingAdmin.streamAdminRecording(fileName, requesterId);
  }

  async streamSignedAdminRecording(
    fileName: string,
    expires: string | undefined,
    signature: string | undefined,
  ): Promise<StreamableFile> {
    return this.recordingAdmin.streamSignedAdminRecording(fileName, expires, signature);
  }
}
