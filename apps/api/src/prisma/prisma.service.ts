import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@botparty/prisma';
import { PrismaPg } from '@prisma/adapter-pg';

function databaseConnectionString() {
  const value = process.env['DATABASE_WRITE_URL'] ?? process.env['DATABASE_URL'];
  if (!value) {
    throw new Error('DATABASE_URL or DATABASE_WRITE_URL is required to connect to PostgreSQL');
  }
  return value;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: databaseConnectionString() }) });
  }

  async onModuleInit() {
    this.logger.log('Connecting to database...');
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from database...');
    await this.$disconnect();
  }
}
