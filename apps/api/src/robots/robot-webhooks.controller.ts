import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@botparty/shared';
import { RobotWebhookService } from './robot-webhook.service';
import { CreateRobotWebhookDto } from './robots.dto';

@ApiTags('robots')
@Controller('robots')
export class RobotWebhooksController {
  constructor(private readonly robotWebhookService: RobotWebhookService) {}

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
}
