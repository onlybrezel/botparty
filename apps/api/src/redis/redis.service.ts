import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject('REDIS_OPTIONS') options: { host: string; port: number; password: string }) {
    super({
      host: options.host,
      port: options.port,
      password: options.password || undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });

    this.on('connect', () => this.logger.log('Redis connected'));
    this.on('error', (err) => this.logger.error('Redis error', err.message));
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
