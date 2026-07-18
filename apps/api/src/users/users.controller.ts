import {
  Controller,
  Get,
  Param,
  UseGuards,
  Query,
  Patch,
  Body,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  exportOwnDataSchema,
  updateMeSchema,
  updateAdminUserSchema,
  uploadAvatarSchema,
  type UpdateAdminUserInput,
  type UpdateMeInput,
} from './users.schema';
import { Throttle } from '@nestjs/throttler';
import { UserAvatarService } from './user-avatar.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatars: UserAvatarService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  @Post('me/export')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export own account data' })
  async exportMe(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(exportOwnDataSchema)) body: { password: string },
  ) {
    return this.usersService.exportOwnData(user.sub, body.password);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(updateMeSchema)) dto: UpdateMeInput,
  ) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload own avatar to platform storage' })
  uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(uploadAvatarSchema)) body: { dataUrl: string },
  ) {
    return this.avatars.save(user.sub, body.dataUrl);
  }

  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove own avatar' })
  deleteAvatar(@CurrentUser() user: JwtPayload) {
    return this.avatars.clear(user.sub);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete own account (GDPR self-service)' })
  async deleteMe(@CurrentUser() user: JwtPayload) {
    await this.usersService.deleteOwnAccount(user.sub);
  }

  @Get('admin/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List users for admin/mod dashboard' })
  async getAdminUsers(
    @CurrentUser() requester: JwtPayload,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.listUsersForStaff({
      q,
      limit: limit ? Number(limit) : undefined,
      requesterRole: requester.role,
    });
  }

  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile/role as staff' })
  async updateAdminUser(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
    @Body(new ZodValidationPipe(updateAdminUserSchema)) body: UpdateAdminUserInput,
  ) {
    return this.usersService.updateUserByStaff(id, requester, body);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete user account as staff' })
  async deleteAdminUser(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
  ) {
    await this.usersService.deleteUserByStaff(id, requester);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get credits leaderboard' })
  async getLeaderboard(
    @Query('limit') limit?: string,
    @Query('period') period?: string,
    @Query('metric') metric?: string,
  ) {
    return this.usersService.getLeaderboard({
      limit: limit ? Number(limit) : 20,
      period,
      metric: metric === 'creator_revenue' ? 'creator_revenue' : 'engagement',
    });
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get user by username' })
  async getByUsername(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }
}
