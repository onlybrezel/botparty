import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JOBS_QUEUE_WEBHOOK, JOBS_QUEUE_MAIL, JOBS_QUEUE_AUDIT_CLEANUP } from './jobs.constants';
import { WebhookProcessor } from './webhook.processor';
import { MailProcessor } from './mail.processor';
import { AuditCleanupProcessor } from './audit-cleanup.processor';
import { JobSchedulerService } from './job-scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: JOBS_QUEUE_WEBHOOK },
      { name: JOBS_QUEUE_MAIL },
      { name: JOBS_QUEUE_AUDIT_CLEANUP },
    ),
    PrismaModule,
    MailModule,
  ],
  providers: [WebhookProcessor, MailProcessor, AuditCleanupProcessor, JobSchedulerService],
  exports: [BullModule],
})
export class JobsModule {}
