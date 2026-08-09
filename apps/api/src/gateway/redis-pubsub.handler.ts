import { Logger } from '@nestjs/common';
import { WS_EVENTS } from '@botparty/shared';
import type { QueueService } from '../queue/queue.service';
import { parseJsonRecord } from '../common/json-value';

type QueueSnapshot = Awaited<ReturnType<QueueService['getQueue']>>;

type RedisModerationPayload = { event: string; data?: unknown };
type RedisRoomPayload = { originId?: string; event: string; data?: unknown };
type RedisSystemPayload = { event: string; data?: unknown };

const CHANNEL_PATTERNS = ['queue:*', 'ws:moderation:*', 'ws:room:*', 'ws:system:*'] as const;

interface PubSubSubscriber {
  connect(): Promise<void>;
  on(event: 'pmessage', listener: (pattern: string, channel: string, message: string) => void): unknown;
  psubscribe(...patterns: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

interface PubSubRedis {
  duplicate(options: { lazyConnect: true }): PubSubSubscriber;
}

export interface RedisPubSubContext {
  readonly instanceId: string;
  hasOpenRobotClient(robotId: string): boolean;
  hasLocalActiveTurn(robotId: string): boolean;
  syncTurnLifecycle(robotId: string, queue: QueueSnapshot): Promise<void>;
  clearTurnState(robotId: string, reason?: 'handoff' | 'timeout' | 'clear'): Promise<void>;
  broadcastToRoomLocally(robotId: string, event: string, data: unknown, excludeClientId?: string): void;
  enforceModerationEvent(robotId: string, payload: RedisModerationPayload): Promise<void>;
  buildModerationSystemMessage(event: string, data: unknown): string | null;
  broadcastSystemLocally(event: string, data: unknown): void;
}

export class RedisPubSubHandler {
  private readonly logger = new Logger(RedisPubSubHandler.name);
  private subscriber: PubSubSubscriber | null = null;

  constructor(
    private readonly redis: PubSubRedis,
    private readonly queueService: Pick<QueueService, 'getQueue'>,
    private readonly ctx: RedisPubSubContext,
  ) {}

  async start(): Promise<void> {
    if (this.subscriber) {
      return;
    }

    const subscriber = this.redis.duplicate({ lazyConnect: true });
    this.subscriber = subscriber;

    subscriber.on('pmessage', (_pattern, channel, message) => {
      void this.handlePublishedMessage(channel, message).catch((error) => {
        this.logger.warn(`Redis pub/sub message failed on ${channel}: ${(error as Error).message}`);
      });
    });

    await subscriber.connect();
    await subscriber.psubscribe(...CHANNEL_PATTERNS);
  }

  async stop(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (!subscriber) {
      return;
    }

    await subscriber.quit();
  }

  async handlePublishedMessage(channel: string, message: string): Promise<void> {
    if (channel.startsWith('queue:')) {
      await this.handleQueueMessage(channel.slice('queue:'.length));
      return;
    }

    if (channel.startsWith('ws:moderation:')) {
      await this.handleModerationMessage(channel.slice('ws:moderation:'.length), message);
      return;
    }

    if (channel.startsWith('ws:room:')) {
      this.handleRoomMessage(channel.slice('ws:room:'.length), message);
      return;
    }

    if (channel.startsWith('ws:system:')) {
      this.handleSystemMessage(message);
    }
  }

  private async handleQueueMessage(robotId: string): Promise<void> {
    if (!robotId) {
      return;
    }

    try {
      const queue = await this.queueService.getQueue(robotId);
      if (this.ctx.hasOpenRobotClient(robotId)) {
        await this.ctx.syncTurnLifecycle(robotId, queue);
      } else if (this.ctx.hasLocalActiveTurn(robotId)) {
        await this.ctx.clearTurnState(robotId, 'clear');
      }
      this.ctx.broadcastToRoomLocally(robotId, WS_EVENTS.QUEUE_UPDATE, { queue });
    } catch (err) {
      this.logger.warn(`Failed to broadcast queue update for ${robotId}: ${(err as Error).message}`);
    }
  }

  private async handleModerationMessage(robotId: string, message: string): Promise<void> {
    if (!robotId) {
      return;
    }

    try {
      const parsed = parseJsonRecord(message);
      if (!parsed || typeof parsed['event'] !== 'string') {
        return;
      }
      const payload: RedisModerationPayload = { event: parsed['event'], data: parsed['data'] };

      await this.ctx.enforceModerationEvent(robotId, payload);
      this.ctx.broadcastToRoomLocally(robotId, payload.event, payload.data ?? {});

      const systemMessage = this.ctx.buildModerationSystemMessage(payload.event, payload.data);
      if (systemMessage) {
        this.ctx.broadcastToRoomLocally(robotId, WS_EVENTS.CHAT_SYSTEM, {
          message: systemMessage,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to process moderation event for ${robotId}: ${(err as Error).message}`);
    }
  }

  private handleRoomMessage(robotId: string, message: string): void {
    if (!robotId) {
      return;
    }

    try {
      const parsed = parseJsonRecord(message);
      if (!parsed || typeof parsed['event'] !== 'string' || parsed['originId'] === this.ctx.instanceId) {
        return;
      }
      const payload: RedisRoomPayload = {
        event: parsed['event'],
        data: parsed['data'],
        ...(typeof parsed['originId'] === 'string' ? { originId: parsed['originId'] } : {}),
      };

      this.ctx.broadcastToRoomLocally(robotId, payload.event, payload.data ?? {});
    } catch (err) {
      this.logger.warn(`Failed to relay room event for ${robotId}: ${(err as Error).message}`);
    }
  }

  private handleSystemMessage(message: string): void {
    try {
      const parsed = parseJsonRecord(message);
      if (!parsed || typeof parsed['event'] !== 'string') {
        return;
      }
      const payload: RedisSystemPayload = { event: parsed['event'], data: parsed['data'] };

      const data =
        payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? payload.data
          : {};
      this.ctx.broadcastSystemLocally(payload.event, data);
    } catch (err) {
      this.logger.warn(`Failed to relay system event: ${(err as Error).message}`);
    }
  }
}
