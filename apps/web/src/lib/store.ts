'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  username: string | null;
  userId: string | null;
  displayName: string | null;
}

interface AuthActions {
  login: (data: {
    accessToken: string;
    refreshToken: string;
    username: string;
    userId: string;
    displayName?: string | null;
  }) => void;
  logout: () => void;
  setAccessToken: (token: string) => void;
  setSession: (data: Partial<AuthState>) => void;
}

export const useAuth = create(
  persist<AuthState & AuthActions>(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      username: null,
      userId: null,
      displayName: null,

      login: ({ accessToken, refreshToken, username, userId, displayName }) =>
        set({ accessToken, refreshToken, username, userId, displayName: displayName ?? null }),

      logout: () =>
        set({ accessToken: null, refreshToken: null, username: null, userId: null, displayName: null }),

      setAccessToken: (token) => set({ accessToken: token }),

      setSession: (data) => set((state) => ({ ...state, ...data })),
    }),
    { name: 'botparty-auth' },
  ),
);
