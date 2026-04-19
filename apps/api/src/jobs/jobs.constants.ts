export const JOBS_QUEUE_WEBHOOK = 'webhook-delivery';
export const JOBS_QUEUE_MAIL = 'mail-send';

export interface WebhookJobData {
  hookId: string;
  event: string;
  payload: Record<string, unknown>;
}

export interface MailJobData {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}
