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
  ) {
    return this.robotsService.findAll({ status, tag });
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a robot' })
  async delete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.robotsService.delete(id, user.sub);
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
}
