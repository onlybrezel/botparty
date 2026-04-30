import { Controller, Get, Param, UseGuards, Query, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { extractBearerToken, getAccessCookieName, parseCookie } from '../auth/auth.cookies';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my session history' })
  async getMySessions(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.sessionsService.findByUser(user.sub, limit ? Number(limit) : 50);
  }

  @Get('my/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed session replay data for the authenticated requester' })
  async getMySession(@CurrentUser() user: JwtPayload, @Param('sessionId') sessionId: string) {
    return this.sessionsService.findDetailForRequester(sessionId, user.sub);
  }

  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get session history for a robot' })
  async getByRobot(
    @Param('robotId') robotId: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    return this.sessionsService.findByRobotForRequester(
      robotId,
      this.resolveRequesterId(authorization, cookieHeader),
      limit ? Number(limit) : 50,
      roomAccessToken,
      guestSessionId,
    );
  }

  @Get('robot/:robotId/active')
  @ApiOperation({ summary: 'Get active session for a robot' })
  async getActiveSession(
    @Param('robotId') robotId: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    return this.sessionsService.getActiveSessionForRequester(
      robotId,
      this.resolveRequesterId(authorization, cookieHeader),
      roomAccessToken,
      guestSessionId,
    );
  }

  private resolveRequesterId(authorization?: string, cookieHeader?: string) {
    const token =
      extractBearerToken(authorization) ??
      parseCookie(cookieHeader, getAccessCookieName(this.configService));
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<{ sub?: string }>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
