import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, UseGuards, Query, Headers, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { extractBearerToken, getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(SessionsService) private readonly sessionsService: Pick<SessionsService, 'findByUser' | 'findDetailForRequester' | 'findByRobotForRequester' | 'getActiveSessionForRequester'>,
    @Inject(AuthService) private readonly authService: Pick<AuthService, 'resolveValidAccessTokenPayload'>,
    @Inject(ConfigService) private readonly configService: Pick<ConfigService, 'get'>,
  ) {}

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my session history' })
  async getMySessions(@CurrentUser() user: Pick<JwtPayload, 'sub'>, @Query('limit') limit?: string) {
    return this.sessionsService.findByUser(user.sub, this.parseLimit(limit));
  }

  @Get('my/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed session replay data for the authenticated requester' })
  async getMySession(@CurrentUser() user: Pick<JwtPayload, 'sub'>, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sessionsService.findDetailForRequester(sessionId, user.sub);
  }

  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get session history for a robot' })
  async getByRobot(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    return this.sessionsService.findByRobotForRequester(
      robotId,
      await this.resolveRequesterId(authorization, cookieHeader),
      this.parseLimit(limit),
      roomAccessToken,
      guestSessionId,
    );
  }

  @Get('robot/:robotId/active')
  @ApiOperation({ summary: 'Get active session for a robot' })
  async getActiveSession(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    return this.sessionsService.getActiveSessionForRequester(
      robotId,
      await this.resolveRequesterId(authorization, cookieHeader),
      roomAccessToken,
      guestSessionId,
    );
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

  private parseLimit(limit?: string) {
    if (limit === undefined) return 50;
    if (!/^\d+$/.test(limit)) {
      throw new BadRequestException('limit must be an integer between 1 and 200');
    }
    const parsed = Number(limit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new BadRequestException('limit must be an integer between 1 and 200');
    }
    return parsed;
  }
}
