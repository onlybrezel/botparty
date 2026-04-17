import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

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

function htmlWrapper(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${EMAIL_STYLES}</style></head>
<body><div class="wrapper"><div class="card">
<div class="logo">BotParty</div>
${body}
</div><div class="footer">BotParty &mdash; Real-time robot teleoperation</div></div></body>
</html>`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: ReturnType<typeof nodemailer.createTransport> | null;
  private readonly fromAddress: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = this.config.get<string>('SMTP_FROM', 'BotParty <no-reply@botparty.live>');
    this.appUrl = this.config.get<string>('APP_URL', 'https://botparty.live');
    this.transport = this.createTransport();
  }

  isEnabled() {
    return this.transport !== null;
  }

  async sendEmailVerification(email: string, token: string) {
    const verifyUrl = new URL('/auth/verify-email', this.appUrl);
    verifyUrl.searchParams.set('token', token);

    if (!this.transport) {
      this.logger.warn(`SMTP not configured; email verification link for ${email}: ${verifyUrl.toString()}`);
      return;
    }

    const html = htmlWrapper('Verify your BotParty email', `
      <h1>Verify your email address</h1>
      <p>Thanks for signing up for BotParty. Click the button below to verify your email address and activate your account.</p>
      <a href="${verifyUrl.toString()}" class="btn">Verify email address</a>
      <hr class="divider">
      <p>Or copy this link into your browser:</p>
      <p class="token">${verifyUrl.toString()}</p>
      <p>This link expires in 24 hours. If you did not create a BotParty account, you can safely ignore this email.</p>
    `);

    await this.transport.sendMail({
      from: this.fromAddress,
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

    if (!this.transport) {
      this.logger.warn(`SMTP is not configured; password reset link for ${email}: ${resetUrl.toString()}`);
      return;
    }

    const html = htmlWrapper('Reset your BotParty password', `
      <h1>Reset your password</h1>
      <p>A password reset was requested for your BotParty account. Click the button below to set a new password.</p>
      <a href="${resetUrl.toString()}" class="btn">Set new password</a>
      <hr class="divider">
      <p>Or copy this link into your browser:</p>
      <p class="token">${resetUrl.toString()}</p>
      <p>This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    `);

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
      html,
    });
  }

  async sendAccountLockoutNoticeEmail(email: string, lockoutMinutes: number) {
    if (!this.transport) {
      this.logger.warn(`SMTP is not configured; account lockout notification for ${email} not sent`);
      return;
    }

    const loginUrl = new URL('/login', this.appUrl).toString();
    const html = htmlWrapper('BotParty login temporarily locked', `
      <h1>Login temporarily locked</h1>
      <p>We detected too many failed login attempts for your account.</p>
      <p>Your login is temporarily blocked for about <strong>${lockoutMinutes} minutes</strong>.</p>
      <a href="${loginUrl}" class="btn">Open BotParty login</a>
      <hr class="divider">
      <p>If this was not you, reset your password immediately after the lockout ends.</p>
    `);

    await this.transport.sendMail({
      from: this.fromAddress,
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
