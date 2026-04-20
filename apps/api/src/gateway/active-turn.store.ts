import { Logger } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';
import type { ActiveTurnState } from './gateway-types';

export class ActiveTurnStore {
  private readonly logger = new Logger(ActiveTurnStore.name);
  private readonly localTurns = new Map<string, ActiveTurnState>();
  private redisFallbackActive = false;

  constructor(private readonly redis: RedisService) {}

  key(robotId: string): string {
    return `ws:turn:${robotId}`;
  }

  hasLocal(robotId: string): boolean {
    return this.getLocal(robotId) !== null;
  }

  localSize(): number {
    return this.localTurns.size;
  }

  remember(robotId: string, state: ActiveTurnState): void {
    if (state.expiresAt <= Date.now()) {
      this.localTurns.delete(robotId);
      return;
    }

    this.localTurns.set(robotId, state);
  }

  getLocal(robotId: string): ActiveTurnState | null {
    const current = this.localTurns.get(robotId) ?? null;
    if (!current) {
      return null;
    }

    if (current.expiresAt <= Date.now()) {
      this.localTurns.delete(robotId);
      return null;
    }

    return current;
  }

  async get(robotId: string): Promise<ActiveTurnState | null> {
    const local = this.getLocal(robotId);
    if (local) {
      return local;
    }

    try {
      const raw = await this.redis.get(this.key(robotId));
      this.markRedisHealthy();
      return this.parse(raw, robotId);
    } catch (err) {
      this.markRedisUnavailable(err as Error);
      return null;
    }
  }

  async set(robotId: string, state: ActiveTurnState): Promise<void> {
    this.remember(robotId, state);

    try {
      const ttlMs = Math.max(1, state.expiresAt - Date.now());
      await this.redis.set(this.key(robotId), JSON.stringify(state), 'PX', ttlMs);
      this.markRedisHealthy();
    } catch (err) {
      this.markRedisUnavailable(err as Error);
    }
  }

  async clear(robotId: string): Promise<ActiveTurnState | null> {
    const local = this.getLocal(robotId);
    this.localTurns.delete(robotId);

    try {
      const raw = await this.redis.eval(
        `
          local current = redis.call("get", KEYS[1])
          if current then
            redis.call("del", KEYS[1])
          end
          return current
        `,
        1,
        this.key(robotId),
      );
      this.markRedisHealthy();

      if (typeof raw === 'string') {
        return this.parse(raw, robotId) ?? local;
      }
      return local;
    } catch (err) {
      this.markRedisUnavailable(err as Error);
      return local;
    }
  }

  private parse(raw: string | null, robotId: string): ActiveTurnState | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<ActiveTurnState>;
      const { sessionId, userId, startedAt, expiresAt } = parsed;

      if (
        typeof sessionId !== 'string' ||
        typeof userId !== 'string' ||
        typeof startedAt !== 'number' ||
        !Number.isFinite(startedAt) ||
        typeof expiresAt !== 'number' ||
        !Number.isFinite(expiresAt)
      ) {
        return null;
      }

      if (expiresAt <= Date.now()) {
        return null;
      }

      return {
        sessionId,
        userId,
        startedAt,
        expiresAt,
      };
    } catch {
      this.logger.warn(`Invalid active turn state for ${robotId}; ignoring cached payload`);
      return null;
    }
  }

  private markRedisUnavailable(error: Error): void {
    if (this.redisFallbackActive) {
      return;
    }

    this.redisFallbackActive = true;
    this.logger.warn(`Redis active turn state unavailable; falling back to local cache: ${error.message}`);
  }

  private markRedisHealthy(): void {
    if (!this.redisFallbackActive) {
      return;
    }

    this.redisFallbackActive = false;
    this.logger.log('Redis active turn state recovered; using shared turn store again');
  }
}