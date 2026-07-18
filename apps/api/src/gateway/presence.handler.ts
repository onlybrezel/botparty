import { Logger } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';
import type { PresenceRecord, SharedPresenceSnapshot, WsClient } from './gateway-types';

const VIEWER_PRESENCE_TTL_SEC = 45;

export class PresenceHandler {
  private readonly logger = new Logger(PresenceHandler.name);

  constructor(
    private readonly redis: RedisService,
    private readonly instanceId: string,
  ) {}

  viewerSocketKey(clientId: string) {
    return `ws:viewer-socket:${this.instanceId}:${clientId}`;
  }

  viewerRoomIndexKey(robotId: string) {
    return `ws:viewer-room:${robotId}`;
  }

  async refresh(client: WsClient, robotId: string): Promise<SharedPresenceSnapshot> {
    if (!client.userId) {
      return { viewerCount: 0, focusUserConnections: 0, presenceList: [], cleanedStaleEntries: false };
    }

    const socketKey = this.viewerSocketKey(client.id);
    const joinedAt = client.presenceJoinedAt ?? Date.now();
    client.presenceJoinedAt = joinedAt;

    await this.redis
      .multi()
      .set(
        socketKey,
        JSON.stringify({ robotId, userId: client.userId, username: client.username, joinedAt }),
        'EX',
        VIEWER_PRESENCE_TTL_SEC,
      )
      .sadd(this.viewerRoomIndexKey(robotId), socketKey)
      .expire(this.viewerRoomIndexKey(robotId), VIEWER_PRESENCE_TTL_SEC * 2)
      .exec();

    return this.getSnapshot(robotId, client.userId);
  }

  async touch(client: WsClient, robotId: string): Promise<void> {
    if (!client.userId) {
      return;
    }

    const joinedAt = client.presenceJoinedAt ?? Date.now();
    client.presenceJoinedAt = joinedAt;
    await this.redis.set(
      this.viewerSocketKey(client.id),
      JSON.stringify({ robotId, userId: client.userId, username: client.username, joinedAt }),
      'EX',
      VIEWER_PRESENCE_TTL_SEC,
    );
  }

  async remove(client: WsClient, robotId: string): Promise<SharedPresenceSnapshot> {
    await this.redis
      .multi()
      .del(this.viewerSocketKey(client.id))
      .srem(this.viewerRoomIndexKey(robotId), this.viewerSocketKey(client.id))
      .exec();

    return this.getSnapshot(robotId, client.userId);
  }

  async getSnapshot(robotId: string, focusUserId?: string): Promise<SharedPresenceSnapshot> {
    const roomIndexKey = this.viewerRoomIndexKey(robotId);
    const socketKeys = await this.redis.smembers(roomIndexKey);
    if (socketKeys.length === 0) {
      await this.redis.set(`robot:viewer-count:${robotId}`, '0', 'EX', VIEWER_PRESENCE_TTL_SEC * 2);
      return { viewerCount: 0, focusUserConnections: 0, presenceList: [], cleanedStaleEntries: false };
    }

    const pipeline = this.redis.pipeline();
    for (const socketKey of socketKeys) {
      pipeline.get(socketKey);
    }
    const results = await pipeline.exec();
    const staleSocketKeys: string[] = [];
    const presenceByUser = new Map<string, PresenceRecord>();
    let viewerCount = 0;
    let focusUserConnections = 0;

    for (const [index, result] of (results ?? []).entries()) {
      const socketKey = socketKeys[index];
      if (!socketKey) {
        continue;
      }

      const [error, raw] = result ?? [];
      if (error || typeof raw !== 'string') {
        staleSocketKeys.push(socketKey);
        continue;
      }

      try {
        const parsed = JSON.parse(raw) as {
          robotId?: string;
          userId?: string;
          username?: string;
          joinedAt?: number;
        };
        if (
          parsed.robotId !== robotId ||
          typeof parsed.userId !== 'string' ||
          typeof parsed.username !== 'string' ||
          typeof parsed.joinedAt !== 'number'
        ) {
          staleSocketKeys.push(socketKey);
          continue;
        }

        viewerCount += 1;
        if (parsed.userId === focusUserId) {
          focusUserConnections += 1;
        }

        const existing = presenceByUser.get(parsed.userId);
        if (!existing || parsed.joinedAt < existing.joinedAt) {
          presenceByUser.set(parsed.userId, {
            userId: parsed.userId,
            username: parsed.username,
            joinedAt: parsed.joinedAt,
          });
        }
      } catch {
        staleSocketKeys.push(socketKey);
      }
    }

    if (staleSocketKeys.length > 0) {
      await this.redis.srem(roomIndexKey, ...staleSocketKeys);
      if (viewerCount === 0) {
        await this.redis.del(roomIndexKey);
      }
    }

    await this.redis.set(`robot:viewer-count:${robotId}`, String(viewerCount), 'EX', VIEWER_PRESENCE_TTL_SEC * 2);
    return {
      viewerCount,
      focusUserConnections,
      presenceList: Array.from(presenceByUser.values()),
      cleanedStaleEntries: staleSocketKeys.length > 0,
    };
  }
}
