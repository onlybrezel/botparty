import { Logger } from '@nestjs/common';
import { WS_EVENTS } from '@botparty/shared';
import type { QueueService } from '../queue/queue.service';
import type { ActiveTurnState, WsClient } from './gateway-types';

export interface ModerationEnforcerContext {
  readonly clients: Map<string, WsClient>;
  getActiveTurn(robotId: string): Promise<ActiveTurnState | null>;
  clearTurnState(robotId: string, reason?: 'handoff' | 'timeout' | 'clear'): Promise<void>;
  leaveRoom(client: WsClient): Promise<void>;
}

export class ModerationEnforcerHandler {
  private readonly logger = new Logger(ModerationEnforcerHandler.name);

  constructor(
    private readonly ctx: ModerationEnforcerContext,
    private readonly queueService: Pick<QueueService, 'leave'>,
  ) {}

  async enforce(robotId: string, payload: { event?: string; data?: unknown }) {
    const event = payload.event;
    if (
      event !== WS_EVENTS.MOD_TIMEOUT &&
      event !== WS_EVENTS.MOD_KICK &&
      event !== WS_EVENTS.MOD_BAN
    ) {
      return;
    }

    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : null;
    const targetUserId = typeof data?.['userId'] === 'string' ? data['userId'] : null;
    if (!targetUserId) {
      return;
    }

    const activeTurn = await this.ctx.getActiveTurn(robotId);
    if (activeTurn?.userId === targetUserId) {
      await this.ctx.clearTurnState(robotId, 'clear');
    }

    await this.queueService.leave(robotId, targetUserId).catch((error: unknown) => {
      this.logger.warn(
        `Failed to remove moderated user ${targetUserId} from robot ${robotId}: ${(error as Error).message}`,
      );
    });

    if (event === WS_EVENTS.MOD_BAN) {
      this.disconnectUserFromRoom(robotId, targetUserId);
    }
  }

  disconnectUserFromRoom(robotId: string, targetUserId: string) {
    for (const client of this.ctx.clients.values()) {
      if (client.isRobot) {
        continue;
      }
      if (client.watchingRobotId !== robotId || client.userId !== targetUserId) {
        continue;
      }

      void this.ctx.leaveRoom(client);
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
  }

  buildSystemMessage(event: string, data: unknown): string | null {
    const details =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    if (!details) {
      return null;
    }

    const label = this.readTargetLabel(details);
    if (!label) {
      return null;
    }

    if (event === WS_EVENTS.MOD_BAN) {
      return `${label} has been banned from this room.`;
    }
    if (event === WS_EVENTS.MOD_UNBAN) {
      return `${label} has been unbanned.`;
    }
    if (event === WS_EVENTS.MOD_KICK) {
      return `${label} was removed from the control queue.`;
    }
    if (event === WS_EVENTS.MOD_TIMEOUT) {
      const expiresAt =
        typeof details['expiresAt'] === 'string' && details['expiresAt'].trim().length > 0
          ? Date.parse(details['expiresAt'])
          : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        const totalMinutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
        return `${label} was timed out for ${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}.`;
      }
      return `${label} was timed out.`;
    }

    return null;
  }

  private readTargetLabel(details: Record<string, unknown>): string | null {
    const displayName = typeof details['displayName'] === 'string' ? details['displayName'].trim() : '';
    if (displayName) {
      return displayName;
    }

    const username = typeof details['username'] === 'string' ? details['username'].trim() : '';
    if (username) {
      return username;
    }

    const userId = typeof details['userId'] === 'string' ? details['userId'].trim() : '';
    return userId ? userId.slice(0, 8) : null;
  }
}
