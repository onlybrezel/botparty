import { Logger } from '@nestjs/common';
import { WS_EVENTS } from '@botparty/shared';
import type { SessionsService } from '../sessions/sessions.service';
import type { RobotsService } from '../robots/robots.service';
import type { QueueService } from '../queue/queue.service';
import type { ActiveTurnState, WsClient } from './gateway-types';

export interface TurnHandlerContext {
  readonly activeTurns: Map<string, ActiveTurnState>;
  readonly turnTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  readonly robotClients: Map<string, WsClient>;
  broadcastToRoom(robotId: string, event: string, data: unknown, excludeClientId?: string): void;
  sendRobotStop(robotId: string, reason: string): void;
}

export class TurnHandler {
  private readonly logger = new Logger(TurnHandler.name);

  constructor(
    private readonly ctx: TurnHandlerContext,
    private readonly robotsService: RobotsService,
    private readonly sessionsService: SessionsService,
    private readonly queueService: QueueService,
  ) {}

  async syncTurnLifecycle(
    robotId: string,
    queue: Array<{ userId: string; user?: { username?: string; displayName?: string | null } }>,
  ) {
    const current = this.ctx.activeTurns.get(robotId) ?? null;
    const nextEntry = queue[0] ?? null;
    const robot = await this.robotsService.findById(robotId);
    const robotRealtimeOnline = this.ctx.robotClients.has(robotId);

    if (robot.queueMode === 'DISABLED') {
      if (current) {
        await this.clearTurnState(robotId, 'clear');
      }
      return;
    }

    if (!robotRealtimeOnline || robot.status === 'MAINTENANCE') {
      if (current) {
        await this.clearTurnState(robotId, 'clear');
      }
      return;
    }

    if (!nextEntry) {
      if (current) {
        await this.clearTurnState(robotId, 'clear');
      }
      await this.robotsService.updateStatus(robotId, 'ONLINE').catch(() => {});
      this.ctx.broadcastToRoom(robotId, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
      return;
    }

    if (current && current.userId === nextEntry.userId) {
      return;
    }

    if (current) {
      await this.clearTurnState(robotId);
    }

    const session = await this.sessionsService.create(robotId, nextEntry.userId);
    const expiresAt = Date.now() + robot.maxTurnTime;
    this.ctx.activeTurns.set(robotId, {
      sessionId: session.id,
      userId: nextEntry.userId,
      startedAt: Date.now(),
      expiresAt,
    });

    await this.robotsService.updateStatus(robotId, 'BUSY').catch(() => {});
    this.ctx.broadcastToRoom(robotId, WS_EVENTS.ROBOT_STATUS, { status: 'BUSY' });
    this.ctx.broadcastToRoom(robotId, WS_EVENTS.SESSION_START, {
      sessionId: session.id,
      userId: nextEntry.userId,
      expiresAt,
    });
    this.ctx.broadcastToRoom(robotId, WS_EVENTS.QUEUE_TURN_START, {
      userId: nextEntry.userId,
      username: nextEntry.user?.displayName ?? nextEntry.user?.username ?? nextEntry.userId,
      expiresAt,
      durationMs: robot.maxTurnTime,
    });

    const existingTimer = this.ctx.turnTimeouts.get(robotId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.handleTurnTimeout(robotId, nextEntry.userId);
    }, robot.maxTurnTime);
    this.ctx.turnTimeouts.set(robotId, timer);
  }

  async handleTurnTimeout(robotId: string, userId: string) {
    await this.clearTurnState(robotId, 'timeout');
    await this.queueService.leave(robotId, userId).catch(() => {});
  }

  async clearTurnState(robotId: string, reason: 'handoff' | 'timeout' | 'clear' = 'handoff') {
    const current = this.ctx.activeTurns.get(robotId);
    if (current) {
      this.ctx.sendRobotStop(robotId, `Turn ended: ${reason}`);
      await this.sessionsService.end(current.sessionId).catch(() => {});
      this.ctx.broadcastToRoom(robotId, WS_EVENTS.SESSION_END, {
        sessionId: current.sessionId,
        userId: current.userId,
      });
      this.ctx.broadcastToRoom(robotId, WS_EVENTS.QUEUE_TURN_END, {
        userId: current.userId,
        reason,
      });
      this.ctx.activeTurns.delete(robotId);
    }

    const timer = this.ctx.turnTimeouts.get(robotId);
    if (timer) {
      clearTimeout(timer);
      this.ctx.turnTimeouts.delete(robotId);
    }
  }
}
