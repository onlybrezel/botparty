'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePreference = 'system' | 'dark' | 'light';
export type CookieConsentStatus = 'unknown' | 'accepted' | 'declined';

export type AppPreferences = {
  theme: ThemePreference;
  cookieConsent: CookieConsentStatus;
  dashboardMaskToken: boolean;
  keyboardTabSwitchOnlyWhenEmpty: boolean;
  queuePositionNotifications: boolean;
  queueTurnNotifications: boolean;
  robotRoomOnboardingSeen: boolean;
};

type PreferencesState = AppPreferences & {
  hydrated: boolean;
  setHydrated: (value: boolean) => void;
  updatePreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
  updatePreferences: (values: Partial<AppPreferences>) => void;
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system',
  cookieConsent: 'unknown',
  dashboardMaskToken: true,
  keyboardTabSwitchOnlyWhenEmpty: true,
  queuePositionNotifications: true,
  queueTurnNotifications: true,
  robotRoomOnboardingSeen: false,
};

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      hydrated: false,
      setHydrated: (value) => set({ hydrated: value }),
      updatePreference: (key, value) => set({ [key]: value } as Pick<AppPreferences, typeof key>),
      updatePreferences: (values) => set(values),
    }),
    {
      name: 'botparty.preferences.v2',
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        theme: state.theme,
        cookieConsent: state.cookieConsent,
        dashboardMaskToken: state.dashboardMaskToken,
        keyboardTabSwitchOnlyWhenEmpty: state.keyboardTabSwitchOnlyWhenEmpty,
        queuePositionNotifications: state.queuePositionNotifications,
        queueTurnNotifications: state.queueTurnNotifications,
        robotRoomOnboardingSeen: state.robotRoomOnboardingSeen,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export function resolveThemeClass(theme: ThemePreference) {
  if (theme === 'dark') {
    return 'dark';
  }
  if (theme === 'light') {
    return 'light';
  }

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

export function hasOptionalCookieConsent(status: CookieConsentStatus) {
  return status === 'accepted';
}
