import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@botparty/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaReadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaReadService.name);
  private readonly replica: PrismaClient | null;

  constructor(@Inject(PrismaService) private readonly primary: Pick<PrismaService, '$queryRaw'>) {
    const readUrl = process.env['DATABASE_READ_URL']?.trim();
    const writeUrl = (process.env['DATABASE_WRITE_URL'] ?? process.env['DATABASE_URL'])?.trim();
    this.replica = readUrl && readUrl !== writeUrl
      ? new PrismaClient({ adapter: new PrismaPg({ connectionString: readUrl }) })
      : null;
  }

  get client(): Pick<PrismaClient, '$queryRaw'> {
    return this.replica ?? this.primary;
  }

  get isReplicaConfigured(): boolean {
    return this.replica !== null;
  }

  async onModuleInit() {
    if (!this.replica) return;
    this.logger.log('Connecting to read replica...');
    try {
      await this.replica.$connect();
      this.logger.log('Read replica connected');
    } catch (error) {
      this.logger.warn(`Read replica unavailable at startup; stale-safe reads will use primary: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.replica) await this.replica.$disconnect();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
