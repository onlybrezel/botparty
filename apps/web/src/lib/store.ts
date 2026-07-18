'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const AUTH_SYNC_STORAGE_KEY = 'botparty.auth.sync.v1';
const AUTH_STORE_STORAGE_KEY = 'botparty.auth.session.v1';

interface AuthState {
  accessToken: string | null;
  username: string | null;
  userId: string | null;
  displayName: string | null;
  role: 'ADMIN' | 'MOD' | 'USER' | null;
  hasHydrated: boolean;
}

interface AuthActions {
  login: (data: {
    accessToken: string;
    username: string;
    userId: string;
    displayName?: string | null;
    role?: 'ADMIN' | 'MOD' | 'USER' | null;
  }) => void;
  logout: () => void;
  syncLogout: () => void;
  setAccessToken: (token: string | null) => void;
  setSession: (data: Partial<AuthState>) => void;
  setHasHydrated: (value: boolean) => void;
}

function buildLoggedOutState(state: AuthState) {
  return {
    accessToken: null,
    username: null,
    userId: null,
    displayName: null,
    role: null,
    hasHydrated: state.hasHydrated,
  };
}

function broadcastAuthLogout() {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    AUTH_SYNC_STORAGE_KEY,
    JSON.stringify({ type: 'logout', at: Date.now() }),
  );
}

export const useAuth = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      accessToken: null,
      username: null,
      userId: null,
      displayName: null,
      role: null,
      hasHydrated: false,

      login: ({ accessToken, username, userId, displayName, role }) =>
        set({
          accessToken,
          username,
          userId,
          displayName: displayName ?? null,
          role: role ?? null,
          hasHydrated: true,
        }),

      logout: () =>
        set((state) => {
          broadcastAuthLogout();
          return buildLoggedOutState(state);
        }),

      syncLogout: () =>
        set((state) => buildLoggedOutState(state)),

      setAccessToken: (token) => set({ accessToken: token }),

      setSession: (data) => set((state) => ({ ...state, ...data })),

      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: AUTH_STORE_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        // accessToken intentionally excluded — kept in memory only to reduce XSS exposure.
        // Auth state (profile info) persists across page reloads via sessionStorage;
        // the token is re-acquired via the HttpOnly-cookie refresh flow on hydration.
        username: state.username,
        userId: state.userId,
        displayName: state.displayName,
        role: state.role,
      }),
    },
  ),
);
