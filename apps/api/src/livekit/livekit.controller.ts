import { Controller, Post, Param, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LivekitService } from './livekit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { type GuestAccess } from '../robots/robots.service';
import type { JwtPayload } from '@botparty/shared';
import { randomUUID } from 'crypto';

@ApiTags('livekit')
@Controller('livekit')
export class LivekitController {
  constructor(
    private readonly livekitService: LivekitService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('token/viewer/:robotId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get LiveKit viewer/controller token' })
  async getViewerToken(
    @Param('robotId') robotId: string,
    @CurrentUser() user: JwtPayload,
    @Query('control') control?: string,
  ) {
    const access = await this.getVideoAccess(robotId);
    if (access.video === 'DISABLED') {
      throw new ForbiddenException('Video is disabled for this robot');
    }

    const canControl = control === 'true';
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
  async getPublicViewerToken(@Param('robotId') robotId: string) {
    const access = await this.getVideoAccess(robotId);
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

  private async getVideoAccess(robotId: string): Promise<{ video: GuestAccess }> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { metadata: true },
    });

    if (!robot?.metadata || typeof robot.metadata !== 'object' || Array.isArray(robot.metadata)) {
      return { video: 'AUTHENTICATED' };
    }

    const accessRaw = (robot.metadata as Record<string, unknown>).access;
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
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, name: true, ownerId: true },
    });

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
