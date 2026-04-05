import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: ReturnType<typeof nodemailer.createTransport> | null;
  private readonly fromAddress: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = this.config.get<string>('SMTP_FROM', 'BotParty <no-reply@botparty.local>');
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
    this.transport = this.createTransport();
  }

  isEnabled() {
    return this.transport !== null;
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const resetUrl = new URL('/reset-password', this.appUrl);
    resetUrl.searchParams.set('token', token);

    if (!this.transport) {
      this.logger.warn(`SMTP is not configured; password reset link for ${email}: ${resetUrl.toString()}`);
      return;
    }

    await this.transport.sendMail({
      from: this.fromAddress,
      to: email,
      subject: 'Reset your BotParty password',
      text: [
        'A password reset was requested for your BotParty account.',
        '',
        `Open this link to set a new password: ${resetUrl.toString()}`,
        '',
        'If you did not request this, you can ignore this email.',
      ].join('\n'),
      html: [
        '<p>A password reset was requested for your BotParty account.</p>',
        `<p><a href="${resetUrl.toString()}">Open this link to set a new password</a></p>`,
        '<p>If you did not request this, you can ignore this email.</p>',
      ].join(''),
    });
  }

  private createTransport() {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      return null;
    }

    const port = Number(this.config.get<string>('SMTP_PORT', '587'));
    const secure = this.config.get<string>('SMTP_SECURE', 'false') === 'true';
    const user = this.config.get<string>('SMTP_USER', '');
    const pass = this.config.get<string>('SMTP_PASSWORD', '');

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
  }
}
