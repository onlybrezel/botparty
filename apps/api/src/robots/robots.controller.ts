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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RobotsService } from './robots.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LivekitService } from '../livekit/livekit.service';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('robots')
@Controller('robots')
export class RobotsController {
  constructor(
    private readonly robotsService: RobotsService,
    private readonly livekitService: LivekitService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all public robots' })
  async findAll(
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('q') q?: string,
  ) {
    return this.robotsService.findAll({ status, tag, q });
  }

  @Get('featured')
  @ApiOperation({ summary: 'Get featured robots' })
  async getFeatured() {
    return this.robotsService.getFeatured();
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update robot settings as staff' })
  async updateAsStaff(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    const role = String(user.role);
    if (!['ADMIN', 'MOD', 'MODERATOR', 'CREATOR'].includes(role)) {
      throw new ForbiddenException('Access denied');
    }

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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete robot as staff' })
  async deleteAsStaff(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const role = String(user.role);
    if (!['ADMIN', 'MOD', 'MODERATOR', 'CREATOR'].includes(role)) {
      throw new ForbiddenException('Access denied');
    }

    await this.robotsService.deleteByStaff(id);
  }

  @Post(':id/regenerate-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate claim token' })
  async regenerateToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.robotsService.regenerateClaimToken(id, user.sub);
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
}
