import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { EarningsService } from './earnings.service';

@ApiTags('earnings')
@Controller('earnings')
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get earnings summary for the current creator' })
  async me(@CurrentUser() user: JwtPayload) {
    return this.earnings.getOwnerSummary(user.sub);
  }
}
