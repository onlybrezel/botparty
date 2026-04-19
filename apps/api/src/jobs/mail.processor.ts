import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { JOBS_QUEUE_MAIL, type MailJobData } from './jobs.constants';

@Processor(JOBS_QUEUE_MAIL, { concurrency: 2 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    const { to, subject, html, text, from } = job.data;
    this.logger.debug(`Sending email to ${to}: ${subject}`);
    await this.mail.sendRaw(to, subject, html, text, from);
  }
}
