import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JOBS_QUEUE_MAIL } from '../jobs/jobs.constants';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: JOBS_QUEUE_MAIL })],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
