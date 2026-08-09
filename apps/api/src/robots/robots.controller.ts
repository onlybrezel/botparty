import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, CreateRobotInput, UpdateRobotInput } from '@botparty/shared';
import { Role } from '@botparty/shared';
import type { FastifyReply } from 'fastify';
import { extractBearerToken, getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthService } from '../auth/auth.service';
import { RobotsService } from './robots.service';
import {
  AddAllowedUserDto,
  GetChatHistoryDto,
  UploadThumbnailDto,
  VerifyRobotAccessDto,
} from './robots.dto';

@ApiTags('robots')
@Controller('robots')
export class RobotsController {
  constructor(
    private readonly robotsService: RobotsService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all public robots' })
  async findAll(
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.robotsService.findAll({
      ...(status === undefined ? {} : { status }),
      ...(tag === undefined ? {} : { tag }),
      ...(q === undefined ? {} : { q }),
      ...(sort === undefined ? {} : { sort }),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    });
  }

  @Get('featured')
  @ApiOperation({ summary: 'Get featured robots' })
  async getFeatured() {
    return this.robotsService.getFeatured();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get public robot overview for discovery surfaces' })
  async getOverview() {
    return this.robotsService.getPublicOverview();
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my robots' })
  async getMyRobots(@CurrentUser() user: JwtPayload) {
    return this.robotsService.findByOwner(user.sub);
  }

  @Get('private/:slug')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get private robot by slug for owner/staff' })
  async findPrivateBySlug(@Param('slug') slug: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.findPrivateBySlugForUser(slug, user.sub);
  }

  @Get('private/:username/:slug')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get private robot by owner username + slug for owner/staff' })
  async findPrivateByUsernameAndSlug(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.robotsService.findPrivateByUsernameAndSlugForUser(username, slug, user.sub);
  }

  @Get(':id/onboarding')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the server-verified host go-live checklist' })
  getOnboardingStatus(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.getOnboardingStatus(id, user.sub);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get robot by slug (legacy route)' })
  async findBySlug(@Param('slug') slug: string) {
    return this.robotsService.findBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new robot' })
  async create(@CurrentUser() user: JwtPayload, @Body() body: CreateRobotInput) {
    return this.robotsService.create(user.sub, body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update robot settings' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdateRobotInput,
  ) {
    return this.robotsService.update(id, user.sub, body);
  }

  @Put('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update robot settings as staff' })
  async updateAsStaff(@Param('id') id: string, @Body() body: UpdateRobotInput) {
    return this.robotsService.updateByStaff(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a robot' })
  async delete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.robotsService.delete(id, user.sub);
  }

  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete robot as staff' })
  async deleteAsStaff(@Param('id') id: string) {
    await this.robotsService.deleteByStaff(id);
  }

  @Post(':id/thumbnail')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload or replace a robot thumbnail (owner only)' })
  async uploadThumbnail(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: UploadThumbnailDto,
  ) {
    return this.robotsService.saveRobotThumbnail(id, user.sub, body.dataUrl.trim());
  }

  @Delete(':id/thumbnail')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a robot thumbnail (owner only)' })
  async deleteThumbnail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.clearRobotThumbnail(id, user.sub);
  }

  @Get(':id/thumbnail-image')
  @ApiOperation({ summary: 'Get a robot thumbnail image' })
  async getThumbnail(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const file = await this.robotsService.readRobotThumbnail(
      id,
      await this.resolveRequesterId(authorization, cookieHeader),
    );
    reply.header('Cache-Control', file.cacheControl);
    reply.header('Vary', 'Authorization, Cookie');
    reply.type(file.contentType);
    return file.buffer;
  }

  @Get(':id/allowed-users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List allow-listed users for a robot (owner only)' })
  async getAllowedUsers(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.getAllowedUsers(id, user.sub);
  }

  @Post(':id/allowed-users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a user to the robot allow list (owner only)' })
  async addAllowedUser(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() body: AddAllowedUserDto) {
    return this.robotsService.addAllowedUser(id, user.sub, body.username.trim());
  }

  @Delete(':id/allowed-users/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a user from the robot allow list (owner only)' })
  async removeAllowedUser(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.robotsService.removeAllowedUser(id, user.sub, targetUserId);
  }

  @Post(':id/access/verify')
  @ApiOperation({ summary: 'Verify room access and issue a temporary room access grant' })
  async verifyRoomAccess(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Body() body: VerifyRobotAccessDto = {},
  ) {
    return this.robotsService.issueRoomAccessGrant({
      robotId: id,
      requesterUserId: await this.resolveRequesterId(authorization, cookieHeader),
      ...(body.password === undefined ? {} : { password: body.password }),
      ...(body.guestSessionId === undefined ? {} : { guestSessionId: body.guestSessionId }),
      ...(body.inviteCode === undefined ? {} : { inviteCode: body.inviteCode }),
    });
  }

  @Get(':id/chat-messages')
  @ApiOperation({ summary: 'Get paginated chat history for a robot room' })
  async getChatHistory(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query() query: GetChatHistoryDto = {},
  ) {
    const parsedLimit = query.limit ? Number.parseInt(query.limit, 10) : null;
    const parsedBefore = query.before ? Number.parseInt(query.before, 10) : null;

    if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    if (parsedBefore !== null && (!Number.isFinite(parsedBefore) || parsedBefore < 0)) {
      throw new BadRequestException('before must be a unix timestamp in milliseconds');
    }

    return this.robotsService.getChatHistoryPage({
      robotId: id,
      requesterUserId: await this.resolveRequesterId(authorization, cookieHeader),
      ...(query.guestSessionId === undefined ? {} : { guestSessionId: query.guestSessionId }),
      ...(query.roomAccessToken === undefined ? {} : { roomAccessToken: query.roomAccessToken }),
      ...(parsedBefore === null ? {} : { before: parsedBefore }),
      ...(query.beforeId === undefined ? {} : { beforeId: query.beforeId }),
      ...(parsedLimit === null ? {} : { limit: parsedLimit }),
    });
  }

  @Get(':username/:slug')
  @ApiOperation({ summary: 'Get robot by owner username + slug' })
  async findByUsernameAndSlug(@Param('username') username: string, @Param('slug') slug: string) {
    return this.robotsService.findByUsernameAndSlug(username, slug);
  }

  private async resolveRequesterId(authorization?: string, cookieHeader?: string): Promise<string | null> {
    const token =
      extractBearerToken(authorization) ?? parseCookie(cookieHeader, getAccessCookieName(this.configService));
    if (!token) {
      return null;
    }

    return (await this.authService.resolveValidAccessTokenPayload(token))?.sub ?? null;
  }
}
