import { Controller, Get, Param, UseGuards, Query, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

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

  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get session history for a robot' })
  async getByRobot(
    @Param('robotId') robotId: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.sessionsService.findByRobotForRequester(
      robotId,
      this.resolveRequesterId(authorization),
      limit ? Number(limit) : 50,
    );
  }

  @Get('robot/:robotId/active')
  @ApiOperation({ summary: 'Get active session for a robot' })
  async getActiveSession(
    @Param('robotId') robotId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.sessionsService.getActiveSessionForRequester(robotId, this.resolveRequesterId(authorization));
  }

  private resolveRequesterId(authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
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
