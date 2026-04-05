import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
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
