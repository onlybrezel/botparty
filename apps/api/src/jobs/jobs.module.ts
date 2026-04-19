import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JOBS_QUEUE_WEBHOOK, JOBS_QUEUE_MAIL } from './jobs.constants';
import { WebhookProcessor } from './webhook.processor';
import { MailProcessor } from './mail.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: JOBS_QUEUE_WEBHOOK },
      { name: JOBS_QUEUE_MAIL },
    ),
    PrismaModule,
    MailModule,
  ],
  providers: [WebhookProcessor, MailProcessor],
  exports: [BullModule],
})
export class JobsModule {}
