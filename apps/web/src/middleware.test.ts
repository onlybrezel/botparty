import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

describe('middleware', () => {
  it('keeps the unfiltered Explore route static', () => {
    const response = middleware(new NextRequest('https://botparty.test/explore'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('redirects legacy Explore filter URLs to the search route', () => {
    const response = middleware(
      new NextRequest('https://botparty.test/explore?tag=warehouse&sort=popular'),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://botparty.test/explore/search?tag=warehouse&sort=popular',
    );
  });

  it('does not redirect unrelated campaign parameters', () => {
    const response = middleware(new NextRequest('https://botparty.test/explore?utm_source=release'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
