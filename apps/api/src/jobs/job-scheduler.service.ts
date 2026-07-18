import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JOBS_QUEUE_AUDIT_CLEANUP } from './jobs.constants';

@Injectable()
export class JobSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(JobSchedulerService.name);

  constructor(@InjectQueue(JOBS_QUEUE_AUDIT_CLEANUP) private readonly auditCleanupQueue: Queue) {}

  async onModuleInit() {
    await this.scheduleAuditCleanup();
  }

  private async scheduleAuditCleanup() {
    const jobName = 'audit-log-cleanup';
    await this.auditCleanupQueue.upsertJobScheduler(
      jobName,
      { pattern: '0 2 * * *' },
      { name: jobName, data: {} },
    );
    this.logger.log('Audit log cleanup scheduler is active: daily at 02:00 UTC');
  }
}
