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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ControlsService } from './controls.service';
import { CreateControlButtonDto, UpdateControlButtonDto, ReorderControlButtonsDto } from './controls.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('controls')
@Controller('controls')
export class ControlsController {
  constructor(private readonly controlsService: ControlsService) {}

  /** Public: get active buttons for a robot (used by front-end + robot client). */
  @Get('robot/:robotId')
  @ApiOperation({ summary: 'Get active control buttons for a robot' })
  getPublicButtons(@Param('robotId', ParseUUIDPipe) robotId: string) {
    return this.controlsService.getPublicButtons(robotId);
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
}
