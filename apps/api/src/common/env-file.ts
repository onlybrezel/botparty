import { existsSync, readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';

export function loadFileBackedEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Logger, 'warn'> = new Logger('EnvFile'),
) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_FILE')) {
      continue;
    }

    const filePath = value?.trim();
    if (!filePath) {
      continue;
    }

    const baseKey = key.slice(0, -5);
    if (env[baseKey]?.trim()) {
      logger.warn(`Ignoring ${key} because ${baseKey} is already set directly`);
      continue;
    }

    if (!existsSync(filePath)) {
      continue;
    }

    env[baseKey] = readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  }
}
