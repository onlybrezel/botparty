import { ModerationService } from './moderation.service';

describe('ModerationService text filtering', () => {
  const service = new ModerationService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('sanitizes control characters and collapses whitespace', () => {
    const result = service.sanitizeChatContent(' hello\u0000\n\tworld  ');
    expect(result.sanitized).toBe('hello world');
    expect(result.hasIllegalChars).toBe(true);
  });

  it('detects obvious profanity patterns', () => {
    expect(service.containsProfanity('this is shit')).toBe(true);
    expect(service.containsProfanity('friendly message')).toBe(false);
  });
});
