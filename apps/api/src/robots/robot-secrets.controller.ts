import { Controller, Post, UseGuards, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { RobotsService } from './robots.service';

@ApiTags('robots')
@Controller('robots')
export class RobotSecretsController {
  constructor(private readonly robotsService: RobotsService) {}

  @Post(':id/regenerate-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate claim token' })
  async regenerateToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.regenerateClaimToken(id, user.sub);
  }

  @Post(':id/regenerate-invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate invite code for link-only access' })
  async regenerateInviteCode(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.regenerateInviteCode(id, user.sub);
  }

  @Post(':id/ensure-invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ensure a stable invite code exists for a robot (owner only)' })
  async ensureInviteCode(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.ensureInviteCode(id, user.sub);
  }
}
