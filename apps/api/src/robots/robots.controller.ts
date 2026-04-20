import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  Headers,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RobotsService } from './robots.service';
import { RobotWebhookService } from './robot-webhook.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LivekitService } from '../livekit/livekit.service';
import { Role } from '@botparty/shared';
import type { JwtPayload, CreateRobotInput, UpdateRobotInput } from '@botparty/shared';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { extractBearerToken, getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import type { FastifyReply } from 'fastify';
import {
  UploadThumbnailDto,
  AddAllowedUserDto,
  CreateIngressCameraDto,
  VerifyRobotAccessDto,
  GetChatHistoryDto,
  ClaimRobotDto,
  IngestRobotLogsDto,
  CreateRobotWebhookDto,
  EnqueueActionDto,
  PushTelemetryDto,
} from './robots.dto';

@ApiTags('robots')
@Controller('robots')
export class RobotsController {
  constructor(
    private readonly robotsService: RobotsService,
    private readonly robotWebhookService: RobotWebhookService,
    private readonly livekitService: LivekitService,
    private readonly jwtService: JwtService,
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
    return this.robotsService.findAll({ status, tag, q, sort, limit, offset });
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

  @Get(':slug')
  @ApiOperation({ summary: 'Get robot by slug (legacy route)' })
  async findBySlug(@Param('slug') slug: string) {
    return this.robotsService.findBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new robot' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateRobotInput,
  ) {
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
  @Roles(Role.ADMIN, Role.MOD)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update robot settings as staff' })
  async updateAsStaff(
    @Param('id') id: string,
    @Body() body: UpdateRobotInput,
  ) {
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

  @Get(':id/webhooks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List robot webhooks (owner only)' })
  async listWebhooks(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotWebhookService.listForOwner(id, user.sub);
  }

  @Post(':id/webhooks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create robot webhook (owner only)' })
  async createWebhook(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateRobotWebhookDto,
  ) {
    return this.robotWebhookService.createForOwner(id, user.sub, body);
  }

  @Delete(':id/webhooks/:webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete robot webhook (owner only)' })
  async deleteWebhook(
    @Param('id') id: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.robotWebhookService.deleteForOwner(id, user.sub, webhookId);
  }

  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete robot as staff' })
  async deleteAsStaff(@Param('id') id: string) {
    await this.robotsService.deleteByStaff(id);
  }

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
  @ApiOperation({ summary: 'Remove a robot thumbnail (owner only)' })
  async deleteThumbnail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.clearRobotThumbnail(id, user.sub);
  }

  @Get(':id/thumbnail-image')
  @ApiOperation({ summary: 'Get a robot thumbnail image' })
  async getThumbnail(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const file = await this.robotsService.readRobotThumbnail(id);
    reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
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
  async addAllowedUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: AddAllowedUserDto,
  ) {
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

  @Get(':id/ingress-cameras')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List WHIP camera ingresses for a robot (owner only)' })
  async listIngressCameras(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.requireRobotOwner(id, user.sub);
    return this.livekitService.listRobotCameraIngresses(id);
  }

  @Post(':id/ingress-cameras')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update a WHIP camera ingress for OBS/manual streaming (owner only)' })
  async createIngressCamera(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateIngressCameraDto,
  ) {
    const robot = await this.requireRobotOwner(id, user.sub);
    const cameraId = body.cameraId.trim();

    const ingress = await this.livekitService.ensureRobotCameraWhipIngress(
      robot.id,
      robot.name,
      cameraId,
      body.label,
      Boolean(body.compatibilityMode),
    );

    if (!ingress) {
      throw new BadRequestException('Failed to provision camera ingress');
    }

    await this.robotsService.upsertExternalStreamCamera(robot.id, user.sub, {
      id: ingress.cameraId ?? cameraId,
      label: body.label,
      enabled: true,
      publishMode: 'always_on',
    });

    return ingress;
  }

  @Delete(':id/ingress-cameras/:ingressId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an external camera WHIP ingress (owner only)' })
  async deleteIngressCamera(
    @Param('id') id: string,
    @Param('ingressId') ingressId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.requireRobotOwner(id, user.sub);
    const deletedCameraId = await this.livekitService.deleteRobotCameraIngress(id, ingressId);
    if (!deletedCameraId) {
      throw new NotFoundException('Ingress not found or not removable');
    }
    await this.robotsService.removeExternalStreamCamera(id, user.sub, deletedCameraId);
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
      requesterUserId: this.resolveRequesterId(authorization, cookieHeader),
      password: body?.password,
      guestSessionId: body?.guestSessionId,
      inviteCode: body?.inviteCode,
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
    const parsedLimit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const parsedBefore = query.before ? Number.parseInt(query.before, 10) : undefined;

    if (query.limit && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    if (query.before && (!Number.isFinite(parsedBefore) || parsedBefore < 0)) {
      throw new BadRequestException('before must be a unix timestamp in milliseconds');
    }

    return this.robotsService.getChatHistoryPage({
      robotId: id,
      requesterUserId: this.resolveRequesterId(authorization, cookieHeader),
      guestSessionId: query.guestSessionId,
      roomAccessToken: query.roomAccessToken,
      before: parsedBefore,
      limit: parsedLimit,
    });
  }

  @Post('claim')
  @ApiOperation({ summary: 'Claim a robot and get LiveKit token for hardware client' })
  async claim(@Body() body: ClaimRobotDto) {
    const robot = await this.robotsService.findByClaimToken(body.claimToken.trim());
    if (!robot) {
      throw new UnauthorizedException('Invalid claim token');
    }

    const { deviceHash } = await this.robotsService.validateOrBindRobotDevice(robot.id, body.deviceKey);
    const robotJwtOptions: JwtSignOptions = {
      secret: this.getRobotJwtSecret(),
      expiresIn: '30d',
    };
    const configuredRobotExpiry = this.configService.get<string>('ROBOT_JWT_EXPIRES_IN')?.trim();
    if (configuredRobotExpiry) {
      robotJwtOptions.expiresIn = configuredRobotExpiry as JwtSignOptions['expiresIn'];
    }

    const robotAuthToken = this.jwtService.sign(
      {
        sub: robot.id,
        scope: 'robot',
        deviceHash,
      },
      robotJwtOptions,
    );

    const token = await this.livekitService.generateRobotToken(robot.id, robot.name);
    const publishCameraIds = Array.isArray(body.publishCameraIds)
      ? body.publishCameraIds
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
      : [];
    const publishTokens = publishCameraIds.length
      ? await this.livekitService.generateRobotPublisherTokens(robot.id, robot.name, publishCameraIds)
      : {};
    const stream = await this.robotsService.getStreamPolicy(robot.id);
    const ingress = await this.livekitService.ensureRobotWhipIngress(robot.id, robot.name);

    return {
      robotId: robot.id,
      token,
      robotAuthToken,
      publishTokens,
      livekitUrl: this.livekitService.getLivekitUrl(),
      ingress,
      stream,
    };
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'Heartbeat from robot hardware client' })
  async heartbeat(@Headers('authorization') authorization?: string) {
    const robotId = this.requireRobotAuth(authorization);
    await this.robotsService.touchHeartbeat(robotId);
    return { ok: true };
  }

  @Post(':id/actions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enqueue remote robot action (owner only)' })
  async enqueueAction(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: EnqueueActionDto,
  ) {
    if (body.type !== 'set_log_stream' && body.durationSec !== undefined) {
      throw new BadRequestException('durationSec is only supported for set_log_stream');
    }
    if (body.type === 'set_log_stream' && body.durationSec !== undefined && (body.durationSec < 10 || body.durationSec > 900)) {
      throw new BadRequestException('durationSec must be between 10 and 900');
    }

    return this.robotsService.enqueueAction(id, user.sub, {
      type: body.type,
      durationSec: body.durationSec,
    });
  }

  @Get(':id/actions/pending')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List pending remote robot actions (owner only)' })
  async getPendingActions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.getPendingActions(id, user.sub);
  }

  @Post('actions/poll')
  @ApiOperation({ summary: 'Robot polls pending remote actions using robot bearer auth' })
  async pollActions(@Headers('authorization') authorization?: string) {
    return this.robotsService.consumeActionsByRobotId(this.requireRobotAuth(authorization));
  }

  @Post('logs')
  @ApiOperation({ summary: 'Robot uploads temporary diagnostics logs using robot bearer auth' })
  async pushLogs(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: IngestRobotLogsDto,
  ) {
    return this.robotsService.ingestRobotLogsByRobotId(this.requireRobotAuth(authorization), body.lines);
  }

  @Post('telemetry')
  @ApiOperation({ summary: 'Robot uploads temporary runtime telemetry using robot bearer auth' })
  async pushTelemetry(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PushTelemetryDto,
  ) {
    return this.robotsService.ingestRobotTelemetryByRobotId(this.requireRobotAuth(authorization), body);
  }

  @Get(':id/logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent temporary robot logs (owner only)' })
  async getLogs(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const logs = await this.robotsService.getRobotLogs(id, user.sub);
    return { logs };
  }

  @Get(':id/telemetry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent temporary robot telemetry (owner only)' })
  async getTelemetry(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.getRobotTelemetry(id, user.sub);
  }

  @Get(':username/:slug')
  @ApiOperation({ summary: 'Get robot by owner username + slug' })
  async findByUsernameAndSlug(@Param('username') username: string, @Param('slug') slug: string) {
    return this.robotsService.findByUsernameAndSlug(username, slug);
  }

  private resolveRequesterId(authorization?: string, cookieHeader?: string): string | null {
    const token =
      extractBearerToken(authorization) ??
      parseCookie(cookieHeader, getAccessCookieName(this.configService));
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
      return payload.sub;
    } catch {
      return null;
    }
  }

  private requireRobotAuth(authorization?: string): string {
    const token = extractBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException('Robot authorization required');
    }

    try {
      const payload = this.jwtService.verify<{ sub?: string; scope?: string; deviceHash?: string }>(token, {
        secret: this.getRobotJwtSecret(),
      });
      if (payload.scope !== 'robot' || typeof payload.sub !== 'string' || !payload.sub.trim()) {
        throw new UnauthorizedException('Invalid robot authorization');
      }
      if (typeof payload.deviceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.deviceHash)) {
        throw new UnauthorizedException('Invalid robot authorization');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid robot authorization');
    }
  }

  private getRobotJwtSecret() {
    return this.configService.getOrThrow<string>('ROBOT_JWT_SECRET');
  }

  private async requireRobotOwner(robotId: string, userId: string) {
    const robot = await this.robotsService.findById(robotId);
    if (robot.ownerId !== userId) {
      throw new ForbiddenException('Not your robot');
    }
    return robot;
  }

}
