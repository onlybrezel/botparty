import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('web liveness route', () => {
  it('returns a stable opaque instance marker without caching', async () => {
    const first = GET();
    const second = GET();

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: 'ok' });
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-web-instance-id')).toMatch(/^[a-f0-9]{16}$/);
    expect(second.headers.get('x-web-instance-id')).toBe(first.headers.get('x-web-instance-id'));
  });
});
