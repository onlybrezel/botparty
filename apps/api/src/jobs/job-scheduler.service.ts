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
    const existing = await this.auditCleanupQueue.getRepeatableJobs();
    const alreadyScheduled = existing.some((job) => job.name === jobName);

    if (!alreadyScheduled) {
      await this.auditCleanupQueue.add(jobName, {}, {
        repeat: {
          pattern: '0 2 * * *', // Run daily at 2 AM UTC
        },
        jobId: jobName,
      });
      this.logger.log(`Scheduled audit log cleanup job: runs daily at 02:00 UTC`);
    } else {
      this.logger.debug(`Audit log cleanup job already scheduled`);
    }
  }
}
