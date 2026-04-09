import { Controller, Post, Param, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LivekitService } from './livekit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RobotsService, type GuestAccess } from '../robots/robots.service';
import { QueueService } from '../queue/queue.service';
import type { JwtPayload } from '@botparty/shared';
import { randomUUID } from 'crypto';

@ApiTags('livekit')
@Controller('livekit')
export class LivekitController {
  constructor(
    private readonly livekitService: LivekitService,
    private readonly robotsService: RobotsService,
    private readonly queueService: QueueService,
  ) {}

  @Post('token/viewer/:robotId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get LiveKit viewer/controller token' })
  async getViewerToken(
    @Param('robotId') robotId: string,
    @CurrentUser() user: JwtPayload,
    @Query('control') control?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
  ) {
    const robot = await this.robotsService.findById(robotId);
    const access = this.readVideoAccess(robot.metadata);
    if (access.video === 'DISABLED') {
      throw new ForbiddenException('Video is disabled for this robot');
    }
    const allowed = await this.robotsService.validateRoomAccess({
      robotId,
      actorId: user.sub,
      roomAccessToken,
    });
    if (!allowed) {
      throw new ForbiddenException('Room access verification required');
    }

    const canControl = await this.canIssueDataToken(robotId, user, control === 'true');
    const token = await this.livekitService.generateViewerToken(
      robotId,
      user.sub,
      user.username,
      canControl,
    );
    return {
      token,
      livekitUrl: this.livekitService.getLivekitUrl(),
    };
  }

  @Post('token/viewer-public/:robotId')
  @Public()
  @ApiOperation({ summary: 'Get guest LiveKit viewer token (ACL-aware)' })
  async getPublicViewerToken(
    @Param('robotId') robotId: string,
    @Query('guestSessionId') _guestSessionId?: string,
    @Query('roomAccessToken') _roomAccessToken?: string,
  ) {
    const robot = await this.robotsService.findById(robotId);
    if (robot.visibility === 'PRIVATE') {
      throw new ForbiddenException('Guest video access is unavailable for private robots');
    }

    const access = this.readVideoAccess(robot.metadata);
    if (access.video !== 'ALL') {
      throw new ForbiddenException('Guest video access is disabled');
    }

    const guestId = `guest-${randomUUID()}`;
    const token = await this.livekitService.generateViewerToken(
      robotId,
      guestId,
      'Guest',
      false,
    );

    return {
      token,
      livekitUrl: this.livekitService.getLivekitUrl(),
    };
  }

  private async canIssueDataToken(
    robotId: string,
    user: JwtPayload,
    requested: boolean,
  ): Promise<boolean> {
    if (!requested) {
      return false;
    }

    const robot = await this.robotsService.findById(robotId);
    const access = await this.robotsService.getAccessPolicy(robotId);
    if (access.control === 'DISABLED') {
      return false;
    }

    if (robot.ownerId === user.sub || user.role === 'ADMIN' || user.role === 'MOD') {
      return true;
    }

    if (robot.queueMode === 'DISABLED') {
      return true;
    }

    const currentControllerUserId = await this.queueService.getCurrentControllerUserId(robotId);
    return currentControllerUserId === user.sub;
  }

  private readVideoAccess(metadata: unknown): { video: GuestAccess } {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return { video: 'AUTHENTICATED' };
    }

    const accessRaw = (metadata as Record<string, unknown>).access;
    if (!accessRaw || typeof accessRaw !== 'object' || Array.isArray(accessRaw)) {
      return { video: 'AUTHENTICATED' };
    }

    const video = (accessRaw as Record<string, unknown>).video;
    if (video === 'ALL' || video === 'AUTHENTICATED' || video === 'DISABLED') {
      return { video };
    }

    return { video: 'AUTHENTICATED' };
  }

  @Post('token/robot/:robotId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get LiveKit robot publisher token' })
  async getRobotToken(
    @Param('robotId') robotId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const robot = await this.robotsService.findById(robotId);

    if (!robot) {
      throw new ForbiddenException('Robot not found');
    }

    if (robot.ownerId !== user.sub) {
      throw new ForbiddenException('Not your robot');
    }

    const token = await this.livekitService.generateRobotToken(robot.id, robot.name);
    return {
      token,
      livekitUrl: this.livekitService.getLivekitUrl(),
    };
  }
}
