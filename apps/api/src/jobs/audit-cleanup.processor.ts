import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JOBS_QUEUE_AUDIT_CLEANUP } from './jobs.constants';

@Processor(JOBS_QUEUE_AUDIT_CLEANUP, { concurrency: 1 })
export class AuditCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditCleanupProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    const deleted = await this.prisma.adminAuditLog.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });

    this.logger.log(`Pruned ${deleted.count} expired audit log entries older than ${now.toISOString()}`);
  }
}
