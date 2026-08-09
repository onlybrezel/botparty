import { parseRedisCommandTimeout, parseRedisConnectTimeout } from './redis.service';

describe('parseRedisCommandTimeout', () => {
  it.each([undefined, '', '   '])('uses the 2 second default for %p', (rawValue) => {
    expect(parseRedisCommandTimeout(rawValue)).toBe(2_000);
  });

  it.each([
    ['250', 250],
    ['3000', 3_000],
    ['30000', 30_000],
  ])('accepts bounded integer value %s', (rawValue, expected) => {
    expect(parseRedisCommandTimeout(rawValue)).toBe(expected);
  });

  it.each(['not-a-number', '249', '30001', '2000.5'])('rejects invalid value %s', (rawValue) => {
    expect(() => parseRedisCommandTimeout(rawValue)).toThrow(
      'REDIS_COMMAND_TIMEOUT_MS must be an integer from 250 to 30000',
    );
  });
});

describe('parseRedisConnectTimeout', () => {
  it('uses the 5 second default', () => {
    expect(parseRedisConnectTimeout(undefined)).toBe(5_000);
  });

  it('accepts a longer startup timeout for constrained profiles', () => {
    expect(parseRedisConnectTimeout('30000')).toBe(30_000);
  });

  it.each(['999', '60001', '1.5'])('rejects invalid value %s', (rawValue) => {
    expect(() => parseRedisConnectTimeout(rawValue)).toThrow('REDIS_CONNECT_TIMEOUT_MS');
  });
});
