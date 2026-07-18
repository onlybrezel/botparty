'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type ThemePreference = 'system' | 'dark' | 'light';

type AppPreferences = {
  theme: ThemePreference;
  dashboardMaskToken: boolean;
  queuePositionNotifications: boolean;
  queueTurnNotifications: boolean;
  robotRoomOnboardingSeen: boolean;
  productAnalyticsEnabled: boolean;
};

type PreferencesState = AppPreferences & {
  hydrated: boolean;
  setHydrated: (value: boolean) => void;
  updatePreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
  updatePreferences: (values: Partial<AppPreferences>) => void;
};

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system',
  dashboardMaskToken: true,
  queuePositionNotifications: true,
  queueTurnNotifications: true,
  robotRoomOnboardingSeen: false,
  productAnalyticsEnabled: false,
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
        dashboardMaskToken: state.dashboardMaskToken,
        queuePositionNotifications: state.queuePositionNotifications,
        queueTurnNotifications: state.queueTurnNotifications,
        robotRoomOnboardingSeen: state.robotRoomOnboardingSeen,
        productAnalyticsEnabled: state.productAnalyticsEnabled,
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
