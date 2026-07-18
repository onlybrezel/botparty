import nodemailer from 'nodemailer';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

const createTransport = nodemailer.createTransport as jest.MockedFunction<
  typeof nodemailer.createTransport
>;

function config(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  };
}

describe('MailService', () => {
  beforeEach(() => {
    createTransport.mockReset();
    jest.restoreAllMocks();
  });

  it('fails clearly without SMTP and never logs verification or reset tokens', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new MailService(
      config({ APP_URL: 'https://botparty.test' }) as never,
      { add: jest.fn() } as never,
    );

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
    const transport = { verify: jest.fn().mockResolvedValue(true), sendMail: jest.fn() };
    createTransport.mockReturnValue(transport as never);
    const service = new MailService(
      config({
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_FROM: 'BotParty <no-reply@example.com>',
      }) as never,
      { add: jest.fn() } as never,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(transport.verify).toHaveBeenCalledTimes(1);
    expect(service.isAvailable()).toBe(true);
  });

  it('keeps the API running when production SMTP is temporarily unreachable', async () => {
    const transport = {
      verify: jest.fn().mockRejectedValue(new Error('connection refused')),
      sendMail: jest.fn(),
    };
    createTransport.mockReturnValue(transport as never);
    const service = new MailService(
      config({
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
      }) as never,
      { add: jest.fn() } as never,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isEnabled()).toBe(true);
    expect(service.isAvailable()).toBe(false);
  });

  it('tracks SMTP recovery and later delivery failures', async () => {
    const transport = {
      verify: jest.fn().mockRejectedValue(new Error('connection refused')),
      sendMail: jest.fn().mockResolvedValueOnce({ messageId: 'one' }).mockRejectedValueOnce(new Error('timeout')),
    };
    createTransport.mockReturnValue(transport as never);
    const service = new MailService(
      config({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com' }) as never,
      { add: jest.fn() } as never,
    );

    await service.onModuleInit();
    await service.sendRaw('user@example.com', 'Subject', '<p>Body</p>', 'Body');
    expect(service.isAvailable()).toBe(true);
    await expect(service.sendRaw('user@example.com', 'Subject', '<p>Body</p>', 'Body')).rejects.toThrow('timeout');
    expect(service.isAvailable()).toBe(false);
  });
});
