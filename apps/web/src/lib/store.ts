'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  username: string | null;
  userId: string | null;
  displayName: string | null;
  role: 'ADMIN' | 'MOD' | 'USER' | null;
  hasHydrated: boolean;
}

interface AuthActions {
  login: (data: {
    accessToken: string;
    refreshToken: string;
    username: string;
    userId: string;
    displayName?: string | null;
    role?: 'ADMIN' | 'MOD' | 'USER' | null;
  }) => void;
  logout: () => void;
  setAccessToken: (token: string) => void;
  setSession: (data: Partial<AuthState>) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuth = create(
  persist<AuthState & AuthActions>(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      username: null,
      userId: null,
      displayName: null,
      role: null,
      hasHydrated: false,

      login: ({ accessToken, refreshToken, username, userId, displayName, role }) =>
        set({
          accessToken,
          refreshToken,
          username,
          userId,
          displayName: displayName ?? null,
          role: role ?? null,
        }),

      logout: () =>
        set({
          accessToken: null,
          refreshToken: null,
          username: null,
          userId: null,
          displayName: null,
          role: null,
        }),

      setAccessToken: (token) => set({ accessToken: token }),

      setSession: (data) => set((state) => ({ ...state, ...data })),

      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'botparty-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
