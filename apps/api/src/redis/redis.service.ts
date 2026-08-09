import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

const DEFAULT_REDIS_COMMAND_TIMEOUT_MS = 2_000;
const MIN_REDIS_COMMAND_TIMEOUT_MS = 250;
const MAX_REDIS_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;

export function parseRedisCommandTimeout(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return DEFAULT_REDIS_COMMAND_TIMEOUT_MS;
  }

  const value = Number(rawValue);
  if (
    !Number.isInteger(value) ||
    value < MIN_REDIS_COMMAND_TIMEOUT_MS ||
    value > MAX_REDIS_COMMAND_TIMEOUT_MS
  ) {
    throw new Error(
      `REDIS_COMMAND_TIMEOUT_MS must be an integer from ${MIN_REDIS_COMMAND_TIMEOUT_MS} to ${MAX_REDIS_COMMAND_TIMEOUT_MS}`,
    );
  }
  return value;
}

export function parseRedisConnectTimeout(rawValue: string | undefined): number {
  if (rawValue === undefined || rawValue.trim() === '') return DEFAULT_REDIS_CONNECT_TIMEOUT_MS;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error('REDIS_CONNECT_TIMEOUT_MS must be an integer from 1000 to 60000');
  }
  return value;
}

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastErrorLogAt = 0;
  private connectionWasUnavailable = false;

  constructor(@Inject('REDIS_OPTIONS') options: { host: string; port: number; password: string }) {
    super({
      host: options.host,
      port: options.port,
      password: options.password || undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
      connectTimeout: parseRedisConnectTimeout(process.env['REDIS_CONNECT_TIMEOUT_MS']),
      commandTimeout: parseRedisCommandTimeout(process.env['REDIS_COMMAND_TIMEOUT_MS']),
      enableOfflineQueue: false,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });

    this.on('connect', () => {
      if (this.connectionWasUnavailable) {
        this.logger.log('Redis connection recovered');
      } else {
        this.logger.log('Redis connected');
      }
      this.connectionWasUnavailable = false;
    });
    this.on('error', (err) => {
      this.connectionWasUnavailable = true;
      const now = Date.now();
      if (now - this.lastErrorLogAt >= 60_000) {
        this.lastErrorLogAt = now;
        this.logger.error(`Redis unavailable: ${err.message}`);
      }
    });
  }

  async onModuleDestroy() {
    try {
      await this.quit();
    } catch (error) {
      this.logger.warn(`Redis graceful disconnect failed: ${(error as Error).message}`);
      this.disconnect();
    }
  }
}
