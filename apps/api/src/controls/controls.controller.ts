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
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ControlsService } from './controls.service';
import { CreateControlButtonDto, UpdateControlButtonDto, ReorderControlButtonsDto } from './controls.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RobotsService } from '../robots/robots.service';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@botparty/shared';
import { extractBearerToken, getAccessCookieName, parseCookie } from '../auth/auth.cookies';
import { AuthService } from '../auth/auth.service';

@ApiTags('controls')
@Controller('controls')
export class ControlsController {
  constructor(
    @Inject(ControlsService) private readonly controlsService: Pick<ControlsService, 'getVisibleButtons' | 'getAllButtons' | 'create' | 'update' | 'remove' | 'reorder'>,
    @Inject(RobotsService) private readonly robotsService: Pick<RobotsService, 'resolveGuestActorId' | 'validateRoomAccess' | 'getAccessPolicy'>,
    @Inject(AuthService) private readonly authService: Pick<AuthService, 'resolveValidAccessTokenPayload'>,
    @Inject(ConfigService) private readonly configService: Pick<ConfigService, 'get'>,
  ) {}

  /** Public: get active buttons for a robot (used by front-end + robot client). */
  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get active control buttons for a robot' })
  async getPublicButtons(
    @Param('robotId', ParseUUIDPipe) robotId: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookieHeader?: string,
    @Query('roomAccessToken') roomAccessToken?: string,
    @Query('guestSessionId') guestSessionId?: string,
  ) {
    const requester = await this.resolveRequester(authorization, cookieHeader);
    const actorId = requester?.sub ?? this.robotsService.resolveGuestActorId(guestSessionId);
    const hasRoomAccess = actorId !== null &&
      (await this.robotsService.validateRoomAccess({
        robotId,
        actorId,
        ...(roomAccessToken === undefined ? {} : { roomAccessToken }),
      }));

    if (!hasRoomAccess) {
      return this.controlsService.getVisibleButtons(robotId, {
        userId: requester?.sub ?? null,
        role: requester?.role ?? null,
        hasRoomAccess: false,
      });
    }

    const access = await this.robotsService.getAccessPolicy(robotId);
    if (access.control === 'DISABLED') {
      return [];
    }

    if (!requester && access.control !== 'ALL') {
      return [];
    }

    return this.controlsService.getVisibleButtons(robotId, {
      userId: requester?.sub ?? null,
      role: requester?.role ?? null,
      hasRoomAccess: true,
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

  private async resolveRequester(authorization?: string, cookieHeader?: string): Promise<JwtPayload | null> {
    const token =
      extractBearerToken(authorization) ??
      parseCookie(cookieHeader, getAccessCookieName(this.configService)) ??
      '';
    if (!token) {
      return null;
    }

    return this.authService.resolveValidAccessTokenPayload(token);
  }
}
