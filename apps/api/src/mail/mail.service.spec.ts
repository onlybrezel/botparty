import nodemailer from 'nodemailer';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { MailService } from './mail.service';

function config(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  };
}

function createMailService(configuration: ReturnType<typeof config>): MailService {
  return new MailService(configuration, { add: jest.fn() });
}

describe('MailService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('fails clearly without SMTP and never logs verification or reset tokens', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = createMailService(config({ APP_URL: 'https://botparty.test' }));

    await expect(
      service.sendEmailVerification('user@example.com', 'verification-secret'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.sendPasswordResetEmail('user@example.com', 'reset-secret'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(log.mock.calls.flat().join(' ')).not.toContain('verification-secret');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('reset-secret');
  });

  it('verifies the configured SMTP transport during production startup', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const verify = jest.spyOn(transport, 'verify').mockResolvedValue(true);
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transport);
    const service = createMailService(config({
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_FROM: 'BotParty <no-reply@example.com>',
      }));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(service.isAvailable()).toBe(true);
  });

  it('keeps the API running when production SMTP is temporarily unreachable', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    jest.spyOn(transport, 'verify').mockRejectedValue(new Error('connection refused'));
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transport);
    const service = createMailService(config({
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
      }));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isEnabled()).toBe(true);
    expect(service.isAvailable()).toBe(false);
  });

  it('tracks SMTP recovery and later delivery failures', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    jest.spyOn(transport, 'verify').mockRejectedValue(new Error('connection refused'));
    jest.spyOn(transport, 'sendMail')
      .mockResolvedValueOnce({
        messageId: 'one',
        envelope: { from: 'sender@example.com', to: ['user@example.com'] },
        accepted: ['user@example.com'],
        rejected: [],
        pending: [],
        response: 'queued',
        message: 'queued',
      })
      .mockRejectedValueOnce(new Error('timeout'));
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transport);
    const service = createMailService(config({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com' }));

    await service.onModuleInit();
    await service.sendRaw('user@example.com', 'Subject', '<p>Body</p>', 'Body');
    expect(service.isAvailable()).toBe(true);
    await expect(service.sendRaw('user@example.com', 'Subject', '<p>Body</p>', 'Body')).rejects.toThrow('timeout');
    expect(service.isAvailable()).toBe(false);
  });
});
