export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJson(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export function parseJsonRecord(input: string): Record<string, unknown> | null {
  const parsed = parseJson(input);
  return isRecord(parsed) ? parsed : null;
}
