import { Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import nodemailer from 'nodemailer';
import { JOBS_QUEUE_MAIL, type MailJobData } from '../jobs/jobs.constants';

const EMAIL_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 0; }
  .wrapper { max-width: 520px; margin: 40px auto; padding: 0 16px; }
  .card { background: #161616; border: 1px solid #262626; border-radius: 12px; padding: 40px 36px; }
  .logo { font-size: 22px; font-weight: 800; color: #7c3aed; margin-bottom: 32px; letter-spacing: -0.5px; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px; color: #f5f5f5; }
  p { font-size: 15px; line-height: 1.6; color: #a3a3a3; margin: 0 0 16px; }
  .btn { display: inline-block; background: #7c3aed; color: #fff !important; text-decoration: none; border-radius: 8px; padding: 12px 28px; font-size: 15px; font-weight: 600; margin: 8px 0 24px; }
  .divider { border: none; border-top: 1px solid #262626; margin: 24px 0; }
  .footer { font-size: 13px; color: #525252; margin-top: 24px; text-align: center; }
  .token { font-family: monospace; font-size: 13px; background: #262626; padding: 8px 12px; border-radius: 6px; word-break: break-all; color: #a3a3a3; }
`;

interface MailConfig {
  get(key: string, fallback?: string): string | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlWrapper(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${EMAIL_STYLES}</style></head>
<body><div class="wrapper"><div class="card">
<div class="logo">BotParty</div>
${body}
</div><div class="footer">BotParty &mdash; Real-time robot teleoperation</div></div></body>
</html>`;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: ReturnType<typeof nodemailer.createTransport> | null;
  private readonly fromAddress: string;
  private readonly appUrl: string;
  private transportAvailable = false;

  constructor(
    @Inject(ConfigService) private readonly config: MailConfig,
    @InjectQueue(JOBS_QUEUE_MAIL) private readonly mailQueue: Pick<Queue<MailJobData>, 'add'>,
  ) {
    this.fromAddress = this.config.get('SMTP_FROM', 'BotParty <no-reply@botparty.live>') ?? 'BotParty <no-reply@botparty.live>';
    this.appUrl = this.config.get('APP_URL', 'https://botparty.live') ?? 'https://botparty.live';
    this.transport = this.createTransport();
  }

  isEnabled() {
    return this.transport !== null;
  }

  isAvailable() {
    return this.transportAvailable;
  }

  async onModuleInit(): Promise<void> {
    if (
      this.config.get('NODE_ENV', process.env['NODE_ENV'] ?? 'development') !== 'production'
    ) {
      return;
    }
    if (!this.transport) {
      throw new Error('SMTP transport is required in production');
    }
    try {
      await this.transport.verify();
      this.transportAvailable = true;
      this.logger.log('SMTP transport verified');
    } catch (error) {
      this.transportAvailable = false;
      this.logger.warn(`SMTP transport unavailable during startup: ${this.errorMessage(error)}`);
    }
  }

  async sendEmailVerification(email: string, token: string) {
    const verifyUrl = new URL('/verify-email', this.appUrl);
    verifyUrl.searchParams.set('token', token);
    const safeVerifyUrl = escapeHtml(verifyUrl.toString());

    if (!this.transport) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }

    const html = htmlWrapper(
      'Verify your BotParty email',
      `
      <h1>Verify your email address</h1>
      <p>Thanks for signing up for BotParty. Click the button below to verify your email address and activate your account.</p>
      <a href="${safeVerifyUrl}" class="btn">Verify email address</a>
      <hr class="divider">
      <p>Or copy this link into your browser:</p>
      <p class="token">${safeVerifyUrl}</p>
      <p>This link expires in 24 hours. If you did not create a BotParty account, you can safely ignore this email.</p>
    `,
    );

    await this.enqueueMailJob({
      to: email,
      subject: 'Verify your BotParty email address',
      text: [
        'Thanks for signing up for BotParty.',
        '',
        `Please verify your email by opening this link: ${verifyUrl.toString()}`,
        '',
        'The link expires in 24 hours. If you did not create this account, you can ignore this email.',
      ].join('\n'),
      html,
    });
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const resetUrl = new URL('/reset-password', this.appUrl);
    // Keep sensitive token out of URL query and Referer logs.
    resetUrl.hash = `token=${encodeURIComponent(token)}`;
    const safeResetUrl = escapeHtml(resetUrl.toString());

    if (!this.transport) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }

    const html = htmlWrapper(
      'Reset your BotParty password',
      `
      <h1>Reset your password</h1>
      <p>A password reset was requested for your BotParty account. Click the button below to set a new password.</p>
      <a href="${safeResetUrl}" class="btn">Set new password</a>
      <hr class="divider">
      <p>Or copy this link into your browser:</p>
      <p class="token">${safeResetUrl}</p>
      <p>This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    `,
    );

    await this.enqueueMailJob({
      to: email,
      subject: 'Reset your BotParty password',
      text: [
        'A password reset was requested for your BotParty account.',
        '',
        `Open this link to set a new password: ${resetUrl.toString()}`,
        '',
        'If you did not request this, you can ignore this email.',
      ].join('\n'),
      html,
    });
  }

  async sendAccountLockoutNoticeEmail(email: string, lockoutMinutes: number) {
    if (!this.transport) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }

    const loginUrl = new URL('/login', this.appUrl).toString();
    const safeLoginUrl = escapeHtml(loginUrl);
    const html = htmlWrapper(
      'BotParty login temporarily locked',
      `
      <h1>Login temporarily locked</h1>
      <p>We detected too many failed login attempts for your account.</p>
      <p>Your login is temporarily blocked for about <strong>${escapeHtml(String(lockoutMinutes))} minutes</strong>.</p>
      <a href="${safeLoginUrl}" class="btn">Open BotParty login</a>
      <hr class="divider">
      <p>If this was not you, reset your password immediately after the lockout ends.</p>
    `,
    );

    await this.enqueueMailJob({
      to: email,
      subject: 'BotParty security notice: temporary login lockout',
      text: [
        'We detected too many failed login attempts for your BotParty account.',
        '',
        `Your login is temporarily blocked for about ${lockoutMinutes} minutes.`,
        '',
        'If this was not you, reset your password when the lockout ends.',
      ].join('\n'),
      html,
    });
  }

  async sendRaw(
    to: string,
    subject: string,
    html: string,
    text: string,
    from?: string,
    messageId?: string,
  ): Promise<void> {
    if (!this.transport) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }

    try {
      await this.transport.sendMail({
        from: from ?? this.fromAddress,
        to,
        subject,
        html,
        text,
        messageId,
      });
      this.transportAvailable = true;
    } catch (error) {
      this.transportAvailable = false;
      throw error;
    }
  }

  private async enqueueMailJob(data: MailJobData): Promise<void> {
    await this.mailQueue.add('send', data, {
      attempts: 4,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  private createTransport() {
    const host = this.config.get('SMTP_HOST');
    if (!host) {
      return null;
    }

    const port = Number(this.config.get('SMTP_PORT', '587'));
    const secure = this.config.get('SMTP_SECURE', 'false') === 'true';
    const user = this.config.get('SMTP_USER', '');
    const pass = this.config.get('SMTP_PASSWORD', '');

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'unknown SMTP error';
  }
}
