import { Logger } from '@nestjs/common';
import { WS_EVENTS } from '@botparty/shared';
import type { SessionsService } from '../sessions/sessions.service';
import type { RobotsService } from '../robots/robots.service';
import type { QueueService } from '../queue/queue.service';
import type { ActiveTurnState } from './gateway-types';
import { randomUUID } from 'crypto';
import type { NotificationsService } from '../notifications/notifications.service';

export interface TurnHandlerContext {
  readonly robotClients: Pick<ReadonlySet<string>, 'has'>;
  getActiveTurn(robotId: string): Promise<ActiveTurnState | null>;
  hasLocalActiveTurn(robotId: string): boolean;
  isTurnOwner(state: ActiveTurnState): boolean;
  acquireActiveTurn(robotId: string, state: ActiveTurnState): Promise<ActiveTurnState | null>;
  clearActiveTurn(robotId: string, expected: ActiveTurnState): Promise<ActiveTurnState | null>;
  getTurnTimeout(robotId: string): ReturnType<typeof setTimeout> | undefined;
  setTurnTimeout(robotId: string, timer: ReturnType<typeof setTimeout>): void;
  clearTurnTimeout(robotId: string): void;
  broadcastToRoom(robotId: string, event: string, data: unknown, excludeClientId?: string): void;
  sendRobotStop(robotId: string, reason: string): void;
  revokeController(robotId: string, userId: string): Promise<void>;
}

type TurnRobots = Pick<RobotsService, 'findById' | 'updateStatus'>;
type TurnSessions = Pick<SessionsService, 'create' | 'end' | 'findActiveForTurnRecovery'>;
type TurnQueue = Pick<QueueService, 'leave'>;
type TurnNotifications = Pick<NotificationsService, 'publishSafely'>;

export class TurnHandler {
  private readonly logger = new Logger(TurnHandler.name);

  constructor(
    private readonly ctx: TurnHandlerContext,
    private readonly robotsService: TurnRobots,
    private readonly sessionsService: TurnSessions,
    private readonly queueService: TurnQueue,
    private readonly notifications: TurnNotifications,
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
      await this.updateRobotStatus(robotId, 'ONLINE');
      this.ctx.broadcastToRoom(robotId, WS_EVENTS.ROBOT_STATUS, { status: 'ONLINE' });
      return;
    }

    if (current && current.userId === nextEntry.userId) {
      if (!this.ctx.isTurnOwner(current)) return;

      const remainingMs = current.expiresAt - Date.now();
      if (remainingMs <= 0) {
        await this.handleTurnTimeout(robotId, nextEntry.userId);
        return;
      }

      if (!this.ctx.getTurnTimeout(robotId)) {
        const timer = setTimeout(() => {
          void this.handleTurnTimeout(robotId, nextEntry.userId).catch((error) => {
            this.logger.warn(`Turn timeout failed for robot ${robotId}: ${(error as Error).message}`);
          });
        }, remainingMs);
        this.ctx.setTurnTimeout(robotId, timer);
      }
      return;
    }

    if (current) {
      if (!this.ctx.isTurnOwner(current)) return;
      await this.clearTurnState(robotId);
    }

    const recoverable = await this.sessionsService.findActiveForTurnRecovery(robotId);
    const canRecover =
      recoverable?.userId === nextEntry.userId &&
      recoverable.startedAt.getTime() + robot.maxTurnTime > Date.now();
    const sessionId = canRecover ? recoverable.id : randomUUID();
    const startedAt = canRecover ? recoverable.startedAt.getTime() : Date.now();
    const expiresAt = startedAt + robot.maxTurnTime;
    const candidate: ActiveTurnState = {
      sessionId,
      userId: nextEntry.userId,
      startedAt,
      expiresAt,
      ownerId: '',
      fencingToken: 0,
      leaseExpiresAt: 0,
    };
    const nextTurn = await this.ctx.acquireActiveTurn(robotId, candidate);
    if (!nextTurn) return;

    let session = recoverable;
    try {
      if (!canRecover) {
        if (recoverable) await this.sessionsService.end(recoverable.id);
        session = await this.sessionsService.create(robotId, nextEntry.userId, sessionId);
      }
    } catch (error) {
      await this.ctx.clearActiveTurn(robotId, nextTurn);
      throw error;
    }
    if (!session) {
      await this.ctx.clearActiveTurn(robotId, nextTurn);
      return;
    }

    void this.notifications.publishSafely({
      userId: nextEntry.userId,
      kind: 'TURN_NOW',
      category: 'TURN',
      title: `Your turn on ${robot.name} starts now`,
      body: 'Open the room to use your control time.',
      actionUrl: `/robots/${robot.slug}`,
      dedupeKey: `turn-now:${session.id}`,
    });
    const nextWaiting = queue[1];
    if (nextWaiting?.userId) {
      void this.notifications.publishSafely({
        userId: nextWaiting.userId,
        kind: 'TURN_SOON',
        category: 'TURN',
        title: `You are next on ${robot.name}`,
        body: 'Keep the room open. Your turn starts after the current session.',
        actionUrl: `/robots/${robot.slug}`,
        dedupeKey: `turn-soon:${robotId}:${nextWaiting.userId}:${session.id}`,
      });
    }

    await this.updateRobotStatus(robotId, 'BUSY');
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
      void this.handleTurnTimeout(robotId, nextEntry.userId).catch((error) => {
        this.logger.warn(`Turn timeout failed for robot ${robotId}: ${(error as Error).message}`);
      });
    }, robot.maxTurnTime);
    this.ctx.setTurnTimeout(robotId, timer);
  }

  async handleTurnTimeout(robotId: string, userId: string) {
    await this.clearTurnState(robotId, 'timeout');
    await this.queueService.leave(robotId, userId).catch((error: unknown) => {
      this.logger.warn(`Failed to remove timed-out user ${userId} from robot ${robotId}: ${(error as Error).message}`);
    });
  }

  async clearTurnState(robotId: string, reason: 'handoff' | 'timeout' | 'clear' = 'handoff') {
    const expected = await this.ctx.getActiveTurn(robotId);
    if (!expected || !this.ctx.isTurnOwner(expected)) {
      this.ctx.clearTurnTimeout(robotId);
      return;
    }
    const current = await this.ctx.clearActiveTurn(robotId, expected);
    if (current) {
      this.ctx.sendRobotStop(robotId, `Turn ended: ${reason}`);
      await this.ctx.revokeController(robotId, current.userId).catch((error: unknown) => {
        this.logger.warn(`Failed to revoke controller ${current.userId} on ${robotId}: ${(error as Error).message}`);
      });
      await this.sessionsService.end(current.sessionId).catch((error: unknown) => {
        this.logger.warn(`Failed to end session ${current.sessionId}: ${(error as Error).message}`);
      });
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

  private async updateRobotStatus(robotId: string, status: 'ONLINE' | 'BUSY') {
    await this.robotsService.updateStatus(robotId, status).catch((error: unknown) => {
      this.logger.warn(`Failed to persist robot ${robotId} status ${status}: ${(error as Error).message}`);
    });
  }
}
