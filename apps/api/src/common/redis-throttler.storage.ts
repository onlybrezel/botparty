import type { ThrottlerStorage } from '@nestjs/throttler';
import { ServiceUnavailableException } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';

const INCREMENT_SCRIPT = `
local counter_key = KEYS[1]
local blocked_key = KEYS[2]
local ttl = tonumber(ARGV[1])
local request_limit = tonumber(ARGV[2])
local block_duration = tonumber(ARGV[3])

local blocked_ttl = redis.call('PTTL', blocked_key)
if blocked_ttl > 0 then
  local blocked_hits = tonumber(redis.call('GET', counter_key)) or (request_limit + 1)
  local window_ttl = math.max(redis.call('PTTL', counter_key), 0)
  return {blocked_hits, window_ttl, 1, blocked_ttl}
end

local total_hits = redis.call('INCR', counter_key)
if total_hits == 1 then
  redis.call('PEXPIRE', counter_key, ttl)
end
local window_ttl = math.max(redis.call('PTTL', counter_key), 0)

if total_hits > request_limit then
  redis.call('SET', blocked_key, '1', 'PX', block_duration)
  return {total_hits, window_ttl, 1, block_duration}
end

return {total_hits, window_ttl, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Pick<RedisService, 'eval'>) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorage['increment']> {
    const prefix = `throttle:${encodeURIComponent(throttlerName)}:${key}`;
    let result: unknown;
    try {
      result = await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${prefix}:count`,
        `${prefix}:blocked`,
        Math.max(1, Math.trunc(ttl)),
        Math.max(1, Math.trunc(limit)),
        Math.max(1, Math.trunc(blockDuration)),
      );
    } catch {
      throw new ServiceUnavailableException('Request protection is temporarily unavailable');
    }
    if (!Array.isArray(result) || result.length !== 4) {
      throw new Error('Redis returned an invalid rate-limit result');
    }
    const [
      totalHits = Number.NaN,
      timeToExpireMs = Number.NaN,
      isBlocked = Number.NaN,
      timeToBlockExpireMs = Number.NaN,
    ] = result.map(Number);
    if ([totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs].some(Number.isNaN)) {
      throw new Error('Redis returned a non-numeric rate-limit result');
    }
    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpireMs / 1_000),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1_000),
    };
  }
}
