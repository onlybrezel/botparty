import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '@botparty/shared';
import { RobotRuntimeService } from './robot-runtime.service';
import { EnqueueActionDto, IngestRobotLogsDto, PushTelemetryDto, ClaimRobotDto } from './robots.dto';

@ApiTags('robots')
@Controller('robots')
export class RobotRuntimeController {
  constructor(private readonly runtimeService: RobotRuntimeService) {}

  @Post('claim')
  @ApiOperation({ summary: 'Claim a robot and get LiveKit token for hardware client' })
  async claim(@Body() body: ClaimRobotDto) {
    return this.runtimeService.claim(body);
  }

  @Post('heartbeat')
  @ApiOperation({ summary: 'Heartbeat from robot hardware client' })
  async heartbeat(@Headers('authorization') authorization?: string) {
    return this.runtimeService.heartbeat(authorization);
  }

  @Post(':id/actions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enqueue remote robot action (owner only)' })
  async enqueueAction(
    @Param('id') robotId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: EnqueueActionDto,
  ) {
    return this.runtimeService.enqueueAction(robotId, user.sub, body);
  }

  @Get(':id/actions/pending')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List pending remote robot actions (owner only)' })
  async getPendingActions(@Param('id') robotId: string, @CurrentUser() user: JwtPayload) {
    return this.runtimeService.getPendingActions(robotId, user.sub);
  }

  @Post('actions/poll')
  @ApiOperation({ summary: 'Robot polls pending remote actions using robot bearer auth' })
  async pollActions(@Headers('authorization') authorization?: string) {
    return this.runtimeService.pollActions(authorization);
  }

  @Post('logs')
  @ApiOperation({ summary: 'Robot uploads temporary diagnostics logs using robot bearer auth' })
  async pushLogs(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: IngestRobotLogsDto,
  ) {
    return this.runtimeService.pushLogs(authorization, body);
  }

  @Post('telemetry')
  @ApiOperation({ summary: 'Robot uploads temporary runtime telemetry using robot bearer auth' })
  async pushTelemetry(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PushTelemetryDto,
  ) {
    return this.runtimeService.pushTelemetry(authorization, body);
  }

  @Get(':id/logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent temporary robot logs (owner only)' })
  async getLogs(@Param('id') robotId: string, @CurrentUser() user: JwtPayload) {
    return this.runtimeService.getLogs(robotId, user.sub);
  }

  @Get(':id/telemetry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get recent temporary robot telemetry (owner only)' })
  async getTelemetry(@Param('id') robotId: string, @CurrentUser() user: JwtPayload) {
    return this.runtimeService.getTelemetry(robotId, user.sub);
  }
}
