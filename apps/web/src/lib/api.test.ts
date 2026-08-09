import { createApiClient } from './api';
import { useAuth } from './store';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('API session restore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAuth.setState({
      accessToken: null,
      username: 'persisted-user',
      userId: 'user-1',
      displayName: 'Persisted User',
      role: 'USER',
      hasHydrated: false,
    });
    vi.restoreAllMocks();
  });

  it('recovers from a transient proxy failure during CSRF bootstrap', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'restored-access-token',
          user: {
            id: 'user-1',
            username: 'persisted-user',
            displayName: 'Persisted User',
            avatarUrl: null,
            role: 'USER',
            createdAt: '2026-07-18T00:00:00.000Z',
          },
        }),
      );

    const restored = await createApiClient('http://app.test').restoreSession();

    expect(restored).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAuth.getState()).toMatchObject({
      accessToken: 'restored-access-token',
      hasHydrated: true,
      username: 'persisted-user',
    });
  });

  it('does not send a refresh request without a readable CSRF token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ csrfToken: null }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: null }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: null }));

    const restored = await createApiClient('http://app.test').restoreSession();

    expect(restored).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe('http://app.test/api/v1/auth/csrf');
      expect(request?.method).toBe('GET');
    }
    expect(useAuth.getState()).toMatchObject({
      accessToken: null,
      hasHydrated: true,
      username: 'persisted-user',
    });
  });

  it('does not retry an explicitly rejected refresh session', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Session expired' }, 401));

    const restored = await createApiClient(window.location.origin).restoreSession();

    expect(restored).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      mode: 'same-origin',
    });
    expect(useAuth.getState()).toMatchObject({
      accessToken: null,
      hasHydrated: true,
      username: null,
    });
  });
});

describe('API request errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes browser-specific network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('NetworkError'));

    await expect(createApiClient('http://app.test').health()).rejects.toMatchObject({
      message: 'Cannot reach the service. Check your connection and try again.',
      status: 0,
    });
  });

  it('keeps public viewer-token requests anonymous and does not start a session refresh', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'Guest video unavailable' }, 401));
    const client = createApiClient('http://app.test');
    client.setToken('signed-in-access-token');

    await expect(client.robots.getPublicViewerToken('robot-1')).rejects.toMatchObject({
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.headers).not.toHaveProperty('Authorization');
  });
});
