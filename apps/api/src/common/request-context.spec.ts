import { normalizeCorrelationId } from './request-context';

describe('normalizeCorrelationId', () => {
  it('accepts compact tracing identifiers', () => {
    expect(normalizeCorrelationId(' request-01:span_2 ')).toBe('request-01:span_2');
  });

  it.each([
    undefined,
    ['one', 'two'],
    '',
    'contains spaces',
    'line\nbreak',
    `x${'a'.repeat(128)}`,
  ])('rejects untrusted or oversized values (%p)', (value) => {
    expect(normalizeCorrelationId(value)).toBeNull();
  });
});
