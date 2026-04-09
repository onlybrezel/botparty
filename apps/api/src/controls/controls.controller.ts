import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ControlsService } from './controls.service';
import { CreateControlButtonDto, UpdateControlButtonDto, ReorderControlButtonsDto } from './controls.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RobotsService } from '../robots/robots.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('controls')
@Controller('controls')
export class ControlsController {
  constructor(
    private readonly controlsService: ControlsService,
    private readonly robotsService: RobotsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Public: get active buttons for a robot (used by front-end + robot client). */
  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get active control buttons for a robot' })
  async getPublicButtons(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Headers('authorization') authorization?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    const requester = this.resolveRequester(authorization);
    const actorId = requester?.sub ?? this.robotsService.resolveGuestActorId(guestSessionId);
    const access = await this.robotsService.getAccessPolicy(robotId);
    const hasRoomAccess =
      Boolean(actorId) &&
      (await this.robotsService.validateRoomAccess({
        robotId,
        actorId: actorId!,
        roomAccessToken,
      }));

    if (access.control === 'DISABLED') {
      return [];
    }

    if (!requester && access.control !== 'ALL') {
      return [];
    }

    return this.controlsService.getVisibleButtons(robotId, {
      userId: requester?.sub ?? null,
      role: requester?.role ?? null,
      hasRoomAccess,
    });
  }

  /** Owner: get ALL buttons including disabled. */
  @Get('robot/:robotId/all')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all control buttons (owner only)' })
  getAllButtons(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.controlsService.getAllButtons(robotId, userId);
  }

  @Post('robot/:robotId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a control button' })
  create(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Body() dto: CreateControlButtonDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.controlsService.create(robotId, dto, userId);
  }

  @Patch(':buttonId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update a control button' })
  update(
    @Param('buttonId', ParseUUIDPipe) buttonId: string,
    @Body() dto: UpdateControlButtonDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.controlsService.update(buttonId, dto, userId);
  }

  @Delete(':buttonId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a control button' })
  remove(
    @Param('buttonId', ParseUUIDPipe) buttonId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.controlsService.remove(buttonId, userId);
  }

  @Put('robot/:robotId/reorder')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder control buttons' })
  reorder(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Body() dto: ReorderControlButtonsDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.controlsService.reorder(robotId, dto, userId);
  }

  private resolveRequester(authorization?: string): JwtPayload | null {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    if (!token) {
      return null;
    }

    try {
      return this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      return null;
    }
  }
}
