import {
  Controller,
  Get,
  Param,
  UseGuards,
  Query,
  Patch,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { UpdateMeDto } from './users.dto';

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

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Get('admin/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List users for admin/mod dashboard' })
  async getAdminUsers(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.listUsersForStaff({
      q,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile/role as staff' })
  async updateAdminUser(
    @Param('id') id: string,
    @Body()
    body: {
      displayName?: string | null;
      role?: 'ADMIN' | 'MOD' | 'USER';
      isActive?: boolean;
      credits?: number;
      balance?: number;
    },
  ) {
    return this.usersService.updateUserByStaff(id, body);
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
