import { Controller, Post, Delete, Get, Param, UseGuards, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('queue')
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get(':robotId')
  @ApiOperation({ summary: 'Get queue for a robot' })
  async getQueue(@Param('robotId') robotId: string) {
    return this.queueService.getQueue(robotId);
  }

  @Post(':robotId/join')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Join the control queue' })
  async join(
    @Param('robotId') robotId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body?: { roomAccessToken?: string },
  ) {
    return this.queueService.join(robotId, user.sub, body?.roomAccessToken);
  }

  @Delete(':robotId/leave')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave the control queue' })
  async leave(@Param('robotId') robotId: string, @CurrentUser() user: JwtPayload) {
    const result = await this.queueService.leave(robotId, user.sub);
    return { message: result.removed ? 'Left queue' : 'Not in queue' };
  }

  @Post(':robotId/vote/:targetUserId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vote for a user in the queue' })
  async vote(
    @Param('robotId') robotId: string,
    @Param('targetUserId') targetUserId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body?: { roomAccessToken?: string },
  ) {
    return this.queueService.vote(robotId, targetUserId, user.sub, body?.roomAccessToken);
  }
}
