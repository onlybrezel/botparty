import { Controller, Post, Delete, Get, Param, ParseUUIDPipe, UseGuards, Body, Headers, Query, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { ConfigService } from '@nestjs/config';
import { extractBearerToken, getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import { AuthService } from '../auth/auth.service';

@ApiTags('queue')
@Controller('queue')
export class QueueController {
  constructor(
    @Inject(QueueService) private readonly queueService: Pick<QueueService, 'getQueueForRequester' | 'join' | 'leave' | 'vote'>,
    @Inject(AuthService) private readonly authService: Pick<AuthService, 'resolveValidAccessTokenPayload'>,
    @Inject(ConfigService) private readonly configService: Pick<ConfigService, 'get'>,
  ) {}

  @Get(':robotId')
  @ApiOperation({ summary: 'Get queue for a robot' })
  async getQueue(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    return this.queueService.getQueueForRequester(
      robotId,
      await this.resolveRequesterId(authorization, cookieHeader),
      roomAccessToken,
      guestSessionId,
    );
  }

  @Post(':robotId/join')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Join the control queue' })
  async join(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser() user: Pick<JwtPayload, 'sub'>,
    @Body() body?: { roomAccessToken?: string },
  ) {
    return this.queueService.join(robotId, user.sub, body?.roomAccessToken);
  }

  @Delete(':robotId/leave')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave the control queue' })
  async leave(@Param('robotId', ParseUUIDPipe) robotId: string, @CurrentUser() user: Pick<JwtPayload, 'sub'>) {
    const result = await this.queueService.leave(robotId, user.sub);
    return { message: result.removed ? 'Left queue' : 'Not in queue' };
  }

  @Post(':robotId/vote/:targetUserId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vote for a user in the queue' })
  async vote(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: Pick<JwtPayload, 'sub'>,
    @Body() body?: { roomAccessToken?: string },
  ) {
    return this.queueService.vote(robotId, targetUserId, user.sub, body?.roomAccessToken);
  }

  private async resolveRequesterId(authorization?: string, cookieHeader?: string) {
    const token =
      extractBearerToken(authorization) ??
      parseCookie(cookieHeader, getAccessCookieName(this.configService));
    if (!token) {
      return null;
    }

    return (await this.authService.resolveValidAccessTokenPayload(token))?.sub ?? null;
  }
}
