import { useAuth } from './store';

describe('auth store hydration', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAuth.setState({
      accessToken: null,
      username: null,
      userId: null,
      displayName: null,
      role: null,
      hasHydrated: false,
    });
  });

  it('does not mark the session ready before the HttpOnly-cookie refresh finishes', async () => {
    sessionStorage.setItem(
      'botparty.auth.session.v1',
      JSON.stringify({
        state: {
          username: 'persisted-user',
          userId: 'user-1',
          displayName: 'Persisted User',
          role: 'USER',
        },
        version: 0,
      }),
    );

    await useAuth.persist.rehydrate();

    expect(useAuth.getState().username).toBe('persisted-user');
    expect(useAuth.getState().accessToken).toBeNull();
    expect(useAuth.getState().hasHydrated).toBe(false);

    useAuth.getState().setHasHydrated(true);
    expect(useAuth.getState().hasHydrated).toBe(true);
  });
});
