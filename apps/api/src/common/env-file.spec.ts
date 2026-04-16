jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { loadFileBackedEnv } from './env-file';

describe('loadFileBackedEnv', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('loads secret values from *_FILE paths when the direct env var is absent', () => {
    const env = {
      SMTP_PASSWORD_FILE: '/run/secrets/smtp_password',
    } as NodeJS.ProcessEnv;
    const logger = { warn: jest.fn() };

    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue('secret-from-file\n');

    loadFileBackedEnv(env, logger as never);

    expect(env.SMTP_PASSWORD).toBe('secret-from-file');
  });

  it('keeps direct values when both the env var and *_FILE variant are set', () => {
    const env = {
      JWT_SECRET: 'direct-secret',
      JWT_SECRET_FILE: '/run/secrets/jwt_secret',
    } as NodeJS.ProcessEnv;
    const logger = { warn: jest.fn() };

    (existsSync as jest.Mock).mockReturnValue(true);

    loadFileBackedEnv(env, logger as never);

    expect(env.JWT_SECRET).toBe('direct-secret');
    expect(logger.warn).toHaveBeenCalled();
  });
});
