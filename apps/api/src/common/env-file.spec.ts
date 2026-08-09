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
    const env: NodeJS.ProcessEnv = {
      SMTP_PASSWORD_FILE: '/run/secrets/smtp_password',
    };
    const logger = { warn: jest.fn() };

    jest.mocked(existsSync).mockReturnValue(true);
    jest.mocked(readFileSync).mockReturnValue('secret-from-file\n');

    loadFileBackedEnv(env, logger);

    expect(env['SMTP_PASSWORD']).toBe('secret-from-file');
  });

  it('keeps direct values when both the env var and *_FILE variant are set', () => {
    const env: NodeJS.ProcessEnv = {
      JWT_SECRET: 'direct-secret',
      JWT_SECRET_FILE: '/run/secrets/jwt_secret',
    };
    const logger = { warn: jest.fn() };

    jest.mocked(existsSync).mockReturnValue(true);

    loadFileBackedEnv(env, logger);

    expect(env['JWT_SECRET']).toBe('direct-secret');
    expect(logger.warn).toHaveBeenCalled();
  });
});
