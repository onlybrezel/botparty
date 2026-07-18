import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { LivekitService } from '../livekit/livekit.service';
import { RobotsService } from './robots.service';
import { CreateIngressCameraDto } from './robots.dto';

@ApiTags('robots')
@Controller('robots')
export class RobotCamerasController {
  constructor(
    private readonly robotsService: RobotsService,
    private readonly livekitService: LivekitService,
  ) {}

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
  @HttpCode(204)
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

  private async requireRobotOwner(robotId: string, userId: string) {
    const robot = await this.robotsService.findById(robotId);
    if (robot.ownerId !== userId) {
      throw new NotFoundException('Robot not found');
    }
    return robot;
  }
}
