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
import { updateMeSchema, updateAdminUserSchema } from './users.schema';

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

  @Get('me/export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export own account data' })
  async exportMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.exportOwnData(user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(updateMeSchema)) dto: any,
  ) {
    return this.usersService.updateMe(user.sub, dto);
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
    @CurrentUser() requester: JwtPayload,
    @Body(new ZodValidationPipe(updateAdminUserSchema)) body: any,
  ) {
    return this.usersService.updateUserByStaff(id, requester, body);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
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
  ) {
    return this.usersService.getLeaderboard({
      limit: limit ? Number(limit) : 20,
      period,
    });
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get user by username' })
  async getByUsername(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }
}
