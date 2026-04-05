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
  UnauthorizedException,
  ForbiddenException,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RobotsService } from './robots.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LivekitService } from '../livekit/livekit.service';
import { Role } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@ApiTags('robots')
@Controller('robots')
export class RobotsController {
  constructor(
    private readonly robotsService: RobotsService,
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
  ) {
    return this.robotsService.findAll({ status, tag, q, sort });
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

  @Get(':slug')
  @ApiOperation({ summary: 'Get robot by slug' })
  async findBySlug(@Param('slug') slug: string) {
    return this.robotsService.findBySlug(slug);
  }

  @Get('private/:slug')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get private robot by slug for owner/staff' })
  async findPrivateBySlug(@Param('slug') slug: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.findPrivateBySlugForUser(slug, user.sub);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new robot' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.robotsService.create(user.sub, body as never);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update robot settings' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.robotsService.update(id, user.sub, body as never);
  }

  @Put('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MOD)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update robot settings as staff' })
  async updateAsStaff(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.robotsService.updateByStaff(id, body as never);
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
    @Body() body: { username?: string },
  ) {
    const username = body.username?.trim();
    if (!username) {
      throw new BadRequestException('username is required');
    }
    return this.robotsService.addAllowedUser(id, user.sub, username);
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
    @Body() body?: { password?: string; guestSessionId?: string },
  ) {
    return this.robotsService.issueRoomAccessGrant({
      robotId: id,
      requesterUserId: this.resolveRequesterId(authorization),
      password: body?.password,
      guestSessionId: body?.guestSessionId,
    });
  }

  @Post('claim')
  @ApiOperation({ summary: 'Claim a robot and get LiveKit token for hardware client' })
  async claim(@Body() body: { claimToken?: string }) {
    const claimToken = body.claimToken?.trim();
    if (!claimToken) {
      throw new BadRequestException('claimToken is required');
    }

    const robot = await this.robotsService.findByClaimToken(claimToken);
    if (!robot) {
      throw new UnauthorizedException('Invalid claim token');
    }

    const token = await this.livekitService.generateRobotToken(robot.id, robot.name);
    const stream = await this.robotsService.getStreamPolicy(robot.id);
    await this.robotsService.updateStatus(robot.id, 'ONLINE');

    return {
      robotId: robot.id,
      token,
      livekitUrl: this.livekitService.getLivekitUrl(),
      stream,
    };
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'Heartbeat from robot hardware client' })
  async heartbeat(@Body() body: { robotId?: string }) {
    const robotId = body.robotId?.trim();
    if (!robotId) {
      throw new BadRequestException('robotId is required');
    }

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
    @Body()
    body: {
      type?: 'restart_video' | 'restart_control' | 'restart_chat' | 'set_log_stream';
      durationSec?: number;
    },
  ) {
    if (!body.type) {
      throw new BadRequestException('type is required');
    }
    if (
      body.type === 'set_log_stream' &&
      body.durationSec !== undefined &&
      (body.durationSec < 10 || body.durationSec > 900)
    ) {
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
  @ApiOperation({ summary: 'Robot polls pending remote actions using claim token' })
  async pollActions(@Body() body: { claimToken?: string }) {
    const claimToken = body.claimToken?.trim();
    if (!claimToken) {
      throw new BadRequestException('claimToken is required');
    }
    return this.robotsService.consumeActionsByClaimToken(claimToken);
  }

  @Post('logs')
  @ApiOperation({ summary: 'Robot uploads temporary diagnostics logs using claim token' })
  async pushLogs(@Body() body: { claimToken?: string; lines?: string[] }) {
    const claimToken = body.claimToken?.trim();
    if (!claimToken) {
      throw new BadRequestException('claimToken is required');
    }
    if (!Array.isArray(body.lines)) {
      throw new BadRequestException('lines must be an array');
    }
    return this.robotsService.ingestRobotLogs(claimToken, body.lines);
  }

  @Post('telemetry')
  @ApiOperation({ summary: 'Robot uploads temporary runtime telemetry using claim token' })
  async pushTelemetry(
    @Body()
    body: {
      claimToken?: string;
      cpuPercent?: number;
      memoryPercent?: number;
      temperatureC?: number;
      uptimeSec?: number;
      controlConnected?: boolean;
      livekitConnected?: boolean;
      commandsReceived?: number;
      cameraFrames?: number;
    },
  ) {
    const claimToken = body.claimToken?.trim();
    if (!claimToken) {
      throw new BadRequestException('claimToken is required');
    }

    return this.robotsService.ingestRobotTelemetry(claimToken, body);
  }

  @Get(':id/logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent temporary robot logs (owner only)' })
  async getLogs(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    try {
      const logs = await this.robotsService.getRobotLogs(id, user.sub);
      return { logs };
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      throw err;
    }
  }

  @Get(':id/telemetry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent temporary robot telemetry (owner only)' })
  async getTelemetry(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.getRobotTelemetry(id, user.sub);
  }

  private resolveRequesterId(authorization?: string): string | null {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
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
}
