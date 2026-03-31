import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get credits leaderboard' })
  async getLeaderboard(@Query('limit') limit?: string) {
    return this.usersService.getLeaderboard(limit ? Number(limit) : 20);
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get user by username' })
  async getByUsername(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }
}
