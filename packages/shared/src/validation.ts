export function isValidTimezone(value: string): boolean {
  const timezone = value.trim();
  if (!timezone) {
    return false;
  }

  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
