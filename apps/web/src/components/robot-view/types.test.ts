import { getOrCreateGuestSessionId } from './types';

describe('robot-view types', () => {
  it('persists and reuses the guest session id', () => {
    window.localStorage.removeItem('botparty.guestSessionId.v1');

    const first = getOrCreateGuestSessionId();
    const second = getOrCreateGuestSessionId();

    expect(first).toBe(second);
    expect(window.localStorage.getItem('botparty.guestSessionId.v1')).toBe(first);
  });
});
