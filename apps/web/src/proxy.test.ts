import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { createRobotPublic } from './test/robot-fixtures';

describe('proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('redirects a public legacy robot URL before any layout HTML is streamed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(createRobotPublic({
      slug: 'test-robot', owner: { id: 'admin-id', username: 'admin', displayName: 'Administrator', avatarUrl: null },
    }))));
    const response = await proxy(new NextRequest('https://botparty.test/robot/test-robot?view=compact'));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://botparty.test/robot/admin/test-robot?view=compact');
    expect(await response.text()).toBe('');
  });

  it.each(['missing', 'private', 'unavailable'])('preserves page handling for %s legacy rooms', async (kind) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    if (kind === 'unavailable') fetchMock.mockRejectedValueOnce(new TypeError('Network failure'));
    else fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const response = await proxy(new NextRequest('https://botparty.test/robot/test-robot'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('does not look up canonical rooms and safely handles encoded legacy slugs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    await proxy(new NextRequest('https://botparty.test/robot/admin/test-robot'));
    expect(fetchMock).not.toHaveBeenCalled();
    await proxy(new NextRequest('https://botparty.test/robot/test%20robot'));
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/v1\/robots\/test%20robot$/);
    const response = await proxy(new NextRequest('https://botparty.test/robot/%ZZ'));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ rsc: '1' }, { 'next-router-prefetch': '1' }])('keeps router requests in the Next.js redirect protocol: %j', async (headers) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await proxy(new NextRequest('https://botparty.test/robot/test-robot?_rsc=payload', { headers }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the unfiltered Explore route static', async () => {
    const response = await proxy(new NextRequest('https://botparty.test/explore'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('redirects legacy Explore filter URLs to the search route', async () => {
    const response = await proxy(
      new NextRequest('https://botparty.test/explore?tag=warehouse&sort=popular'),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://botparty.test/explore/search?tag=warehouse&sort=popular',
    );
  });

  it('does not redirect unrelated campaign parameters', async () => {
    const response = await proxy(new NextRequest('https://botparty.test/explore?utm_source=release'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
