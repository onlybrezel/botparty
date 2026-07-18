import { Logger } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';
import type { ActiveTurnState } from './gateway-types';

const TURN_LEASE_MS = 15_000;

const ACQUIRE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return nil end
local fence = redis.call('INCR', KEYS[2])
local state = cjson.decode(ARGV[1])
state.fencingToken = fence
state.leaseExpiresAt = tonumber(ARGV[2])
local encoded = cjson.encode(state)
redis.call('SET', KEYS[1], encoded, 'PX', ARGV[3])
return encoded
`;

const RENEW_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local state = cjson.decode(raw)
if state.ownerId ~= ARGV[1] or tonumber(state.fencingToken) ~= tonumber(ARGV[2]) then return nil end
state.leaseExpiresAt = tonumber(ARGV[3])
local encoded = cjson.encode(state)
redis.call('SET', KEYS[1], encoded, 'PX', ARGV[4])
return encoded
`;

const CLEAR_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local state = cjson.decode(raw)
if state.ownerId ~= ARGV[1] or tonumber(state.fencingToken) ~= tonumber(ARGV[2]) then return nil end
redis.call('DEL', KEYS[1])
return raw
`;

export class ActiveTurnStore {
  private readonly logger = new Logger(ActiveTurnStore.name);
  private readonly localTurns = new Map<string, ActiveTurnState>();
  private redisFallbackActive = false;

  constructor(
    private readonly redis: RedisService,
    readonly instanceId: string,
  ) {}

  key(robotId: string): string {
    return `ws:turn:${robotId}`;
  }

  private fenceKey(robotId: string): string {
    return `ws:turn-fence:${robotId}`;
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
    if (!current || current.expiresAt <= Date.now()) {
      this.localTurns.delete(robotId);
      return null;
    }
    return current;
  }

  async get(robotId: string): Promise<ActiveTurnState | null> {
    try {
      const raw = await this.redis.get(this.key(robotId));
      this.markRedisHealthy();
      const shared = this.parse(raw, robotId);
      if (shared?.ownerId === this.instanceId) this.remember(robotId, shared);
      return shared;
    } catch (error) {
      this.markRedisUnavailable(error as Error);
      return this.getLocal(robotId);
    }
  }

  async acquire(robotId: string, candidate: ActiveTurnState): Promise<ActiveTurnState | null> {
    const now = Date.now();
    const ttlMs = Math.max(1, Math.min(TURN_LEASE_MS, candidate.expiresAt - now));
    const payload = { ...candidate, ownerId: this.instanceId, fencingToken: 0, leaseExpiresAt: now + ttlMs };
    try {
      const raw = await this.redis.eval(
        ACQUIRE_LUA,
        2,
        this.key(robotId),
        this.fenceKey(robotId),
        JSON.stringify(payload),
        String(now + ttlMs),
        String(ttlMs),
      );
      this.markRedisHealthy();
      const acquired = typeof raw === 'string' ? this.parse(raw, robotId) : null;
      if (acquired) this.remember(robotId, acquired);
      return acquired;
    } catch (error) {
      this.markRedisUnavailable(error as Error);
      return null;
    }
  }

  async renewOwned(): Promise<void> {
    const now = Date.now();
    await Promise.all([...this.localTurns.entries()].map(async ([robotId, state]) => {
      if (state.ownerId !== this.instanceId || state.expiresAt <= now) {
        this.localTurns.delete(robotId);
        return;
      }
      const ttlMs = Math.max(1, Math.min(TURN_LEASE_MS, state.expiresAt - now));
      try {
        const raw = await this.redis.eval(
          RENEW_LUA,
          1,
          this.key(robotId),
          state.ownerId,
          String(state.fencingToken),
          String(now + ttlMs),
          String(ttlMs),
        );
        const renewed = typeof raw === 'string' ? this.parse(raw, robotId) : null;
        if (renewed) this.remember(robotId, renewed);
        else this.localTurns.delete(robotId);
      } catch (error) {
        this.markRedisUnavailable(error as Error);
      }
    }));
  }

  async clear(robotId: string, expected: ActiveTurnState): Promise<ActiveTurnState | null> {
    const local = this.getLocal(robotId);
    if (local?.ownerId === expected.ownerId && local.fencingToken === expected.fencingToken) {
      this.localTurns.delete(robotId);
    }
    try {
      const raw = await this.redis.eval(
        CLEAR_LUA,
        1,
        this.key(robotId),
        expected.ownerId,
        String(expected.fencingToken),
      );
      this.markRedisHealthy();
      return typeof raw === 'string' ? this.parse(raw, robotId) : null;
    } catch (error) {
      this.markRedisUnavailable(error as Error);
      return local?.ownerId === expected.ownerId && local.fencingToken === expected.fencingToken ? local : null;
    }
  }

  private parse(raw: string | null, robotId: string): ActiveTurnState | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ActiveTurnState>;
      if (
        typeof parsed.sessionId !== 'string' || typeof parsed.userId !== 'string' ||
        typeof parsed.startedAt !== 'number' || typeof parsed.expiresAt !== 'number' ||
        typeof parsed.ownerId !== 'string' || typeof parsed.fencingToken !== 'number' ||
        typeof parsed.leaseExpiresAt !== 'number' || parsed.expiresAt <= Date.now()
      ) return null;
      return parsed as ActiveTurnState;
    } catch {
      this.logger.warn(`Invalid active turn state for ${robotId}; ignoring cached payload`);
      return null;
    }
  }

  private markRedisUnavailable(error: Error): void {
    if (this.redisFallbackActive) return;
    this.redisFallbackActive = true;
    this.logger.warn(`Redis active turn coordination unavailable: ${error.message}`);
  }

  private markRedisHealthy(): void {
    if (!this.redisFallbackActive) return;
    this.redisFallbackActive = false;
    this.logger.log('Redis active turn coordination recovered');
  }
}
