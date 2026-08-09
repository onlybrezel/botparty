export function readNonNegativeIntegerEnv(
  config: { get(key: string): unknown },
  key: string,
  defaultValue: number,
): number {
  const raw = config.get(key);
  if (typeof raw !== 'string' || !raw.trim()) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }

  return Math.floor(parsed);
}
