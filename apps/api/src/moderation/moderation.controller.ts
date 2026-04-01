import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { ModerateUserDto } from './moderation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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
}
