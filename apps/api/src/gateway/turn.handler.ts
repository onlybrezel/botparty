import { Logger } from '@nestjs/common';
import { WS_EVENTS } from '@botparty/shared';
import type { SessionsService } from '../sessions/sessions.service';
import type { RobotsService } from '../robots/robots.service';
import type { QueueService } from '../queue/queue.service';
import type { ActiveTurnState, WsClient } from './gateway-types';

export interface TurnHandlerContext {
  readonly robotClients: Map<string, WsClient>;
  getActiveTurn(robotId: string): Promise<ActiveTurnState | null>;
  hasLocalActiveTurn(robotId: string): boolean;
  rememberActiveTurn(robotId: string, state: ActiveTurnState): void;
  setActiveTurn(robotId: string, state: ActiveTurnState): Promise<void>;
  clearActiveTurn(robotId: string): Promise<ActiveTurnState | null>;
  getTurnTimeout(robotId: string): ReturnType<typeof setTimeout> | undefined;
  setTurnTimeout(robotId: string, timer: ReturnType<typeof setTimeout>): void;
  clearTurnTimeout(robotId: string): void;
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
    const current = await this.ctx.getActiveTurn(robotId);
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
      if (!this.ctx.hasLocalActiveTurn(robotId)) {
        this.ctx.rememberActiveTurn(robotId, current);
      }

      const remainingMs = current.expiresAt - Date.now();
      if (remainingMs <= 0) {
        await this.handleTurnTimeout(robotId, nextEntry.userId);
        return;
      }

      if (!this.ctx.getTurnTimeout(robotId)) {
        const timer = setTimeout(() => {
          void this.handleTurnTimeout(robotId, nextEntry.userId);
        }, remainingMs);
        this.ctx.setTurnTimeout(robotId, timer);
      }
      return;
    }

    if (current) {
      await this.clearTurnState(robotId);
    }

    const session = await this.sessionsService.create(robotId, nextEntry.userId);
    const expiresAt = Date.now() + robot.maxTurnTime;
    const startedAt = Date.now();
    const nextTurn: ActiveTurnState = {
      sessionId: session.id,
      userId: nextEntry.userId,
      startedAt,
      expiresAt,
    };
    await this.ctx.setActiveTurn(robotId, nextTurn);

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

    const existingTimer = this.ctx.getTurnTimeout(robotId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.handleTurnTimeout(robotId, nextEntry.userId);
    }, robot.maxTurnTime);
    this.ctx.setTurnTimeout(robotId, timer);
  }

  async handleTurnTimeout(robotId: string, userId: string) {
    await this.clearTurnState(robotId, 'timeout');
    await this.queueService.leave(robotId, userId).catch(() => {});
  }

  async clearTurnState(robotId: string, reason: 'handoff' | 'timeout' | 'clear' = 'handoff') {
    const current = await this.ctx.clearActiveTurn(robotId);
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
    }

    this.ctx.clearTurnTimeout(robotId);
  }
}
