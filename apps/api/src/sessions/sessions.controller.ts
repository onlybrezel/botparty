import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my session history' })
  async getMySessions(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.sessionsService.findByUser(user.sub, limit ? Number(limit) : 50);
  }

  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get session history for a robot' })
  async getByRobot(@Param('robotId') robotId: string, @Query('limit') limit?: string) {
    return this.sessionsService.findByRobot(robotId, limit ? Number(limit) : 50);
  }

  @Get('robot/:robotId/active')
  @ApiOperation({ summary: 'Get active session for a robot' })
  async getActiveSession(@Param('robotId') robotId: string) {
    return this.sessionsService.getActiveSession(robotId);
  }
}
