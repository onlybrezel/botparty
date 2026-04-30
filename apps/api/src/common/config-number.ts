import type { ConfigService } from '@nestjs/config';

export function readNonNegativeIntegerEnv(
  config: ConfigService,
  key: string,
  defaultValue: number,
): number {
  const raw = config.get<string>(key);
  if (!raw?.trim()) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }

  return Math.floor(parsed);
}
