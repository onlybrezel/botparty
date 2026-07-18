import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

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
      connectTimeout: 5_000,
      commandTimeout: 2_000,
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
