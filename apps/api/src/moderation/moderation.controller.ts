import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
  BadRequestException,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { ModerateUserDto } from './moderation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@botparty/shared';

@ApiTags('moderation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('robot/:robotId')
  @ApiOperation({ summary: 'Apply a moderation action (timeout / kick / ban / unban)' })
  moderate(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Body() dto: ModerateUserDto,
    @CurrentUser('sub') moderatorId: string,
  ) {
    return this.moderationService.moderate(robotId, dto, moderatorId);
  }

  @Get('robot/:robotId/log')
  @ApiOperation({ summary: 'Get moderation log for a robot (owner / staff)' })
  getLog(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') requesterId: string,
  ) {
    return this.moderationService.getLog(robotId, requesterId);
  }

  @Get('admin/overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiOperation({ summary: 'Get moderation overview for admin/mod dashboard' })
  getAdminOverview(
    @CurrentUser('sub') requesterId: string,
    @Query('robotId') robotId?: string,
  ) {
    return this.moderationService.getAdminOverview(requesterId, robotId);
  }

  @Get('admin/runtime-overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiOperation({ summary: 'Get runtime, host, and LiveKit overview for staff dashboard' })
  getAdminRuntimeOverview(@CurrentUser('sub') requesterId: string) {
    return this.moderationService.getAdminRuntimeOverview(requesterId);
  }

  @Post('admin/robot/:robotId/actions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiOperation({ summary: 'Queue a remote robot action from the staff dashboard' })
  enqueueStaffRobotAction(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') requesterId: string,
    @Body()
    body: {
      type?: 'restart_video' | 'restart_control' | 'restart_chat' | 'update_client' | 'set_log_stream';
      durationSec?: number;
    },
  ) {
    if (!body.type) {
      throw new BadRequestException('type is required');
    }
    return this.moderationService.enqueueStaffRobotAction(robotId, requesterId, {
      type: body.type,
      durationSec: body.durationSec,
    });
  }

  @Get('admin/robot/:robotId/recording')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get LiveKit recording status for a robot room (admin only)' })
  getAdminRobotRecordingStatus(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') requesterId: string,
  ) {
    return this.moderationService.getAdminRobotRecordingStatus(robotId, requesterId);
  }

  @Post('admin/robot/:robotId/recording/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Start LiveKit recording for a robot room (admin only)' })
  startAdminRobotRecording(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') requesterId: string,
  ) {
    return this.moderationService.startAdminRobotRecording(robotId, requesterId);
  }

  @Post('admin/robot/:robotId/recording/stop')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Stop LiveKit recording for a robot room (admin only)' })
  stopAdminRobotRecording(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') requesterId: string,
  ) {
    return this.moderationService.stopAdminRobotRecording(robotId, requesterId);
  }

  @Get('admin/recordings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List available recording files (admin only)' })
  listAdminRecordings(@CurrentUser('sub') requesterId: string) {
    return this.moderationService.listAdminRecordings(requesterId);
  }

  @Get('admin/recordings/:fileName')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Stream a recording file (admin only)' })
  async streamAdminRecording(
    @Param('fileName') fileName: string,
    @CurrentUser('sub') requesterId: string,
  ): Promise<StreamableFile> {
    return this.moderationService.streamAdminRecording(fileName, requesterId);
  }

  @Get('admin/recordings/:fileName/signed')
  @ApiOperation({ summary: 'Stream a recording file via short-lived signed URL' })
  async streamSignedAdminRecording(
    @Param('fileName') fileName: string,
    @Query('expires') expires?: string,
    @Query('signature') signature?: string,
  ): Promise<StreamableFile> {
    return this.moderationService.streamSignedAdminRecording(fileName, expires, signature);
  }

  @Get('admin/profanity-overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiOperation({ summary: 'Get profanity counters and events across all robots for staff' })
  getAdminProfanityOverview(@CurrentUser('sub') requesterId: string) {
    return this.moderationService.getGlobalProfanityOverview(requesterId);
  }

  @Get('robot/:robotId/profanity')
  @ApiOperation({ summary: 'Get profanity counters and recent events for a robot' })
  getProfanityOverview(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') requesterId: string,
  ) {
    return this.moderationService.getProfanityOverview(requesterId, robotId);
  }
}
