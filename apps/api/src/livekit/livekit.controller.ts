import { Controller, Post, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LivekitService } from './livekit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('livekit')
@Controller('livekit')
export class LivekitController {
  constructor(private readonly livekitService: LivekitService) {}

  @Post('token/viewer/:robotId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get LiveKit viewer/controller token' })
  async getViewerToken(
    @Param('robotId') robotId: string,
    @CurrentUser() user: JwtPayload,
    @Query('control') control?: string,
  ) {
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

  @Post('token/robot/:robotId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get LiveKit robot publisher token' })
  async getRobotToken(
    @Param('robotId') robotId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const token = await this.livekitService.generateRobotToken(robotId, user.username);
    return {
      token,
      livekitUrl: this.livekitService.getLivekitUrl(),
    };
  }
}
