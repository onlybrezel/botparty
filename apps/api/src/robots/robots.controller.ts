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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RobotsService } from './robots.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@botparty/shared';
import type { JwtPayload } from '@botparty/shared';

@ApiTags('robots')
@Controller('robots')
export class RobotsController {
  constructor(private readonly robotsService: RobotsService) {}

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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CREATOR, Role.ADMIN)
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
}
