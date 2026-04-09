'use client';

import { create } from 'zustand';

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
  setAccessToken: (token: string | null) => void;
  setSession: (data: Partial<AuthState>) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuth = create<AuthState & AuthActions>((set) => ({
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
    }),

  logout: () =>
    set((state) => ({
      accessToken: null,
      username: null,
      userId: null,
      displayName: null,
      role: null,
      hasHydrated: state.hasHydrated,
    })),

  setAccessToken: (token) => set({ accessToken: token }),

  setSession: (data) => set((state) => ({ ...state, ...data })),

  setHasHydrated: (value) => set({ hasHydrated: value }),
}));
