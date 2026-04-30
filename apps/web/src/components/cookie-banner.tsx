'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/lib/preferences';

export function CookieBanner() {
  const hydrated = usePreferences((state) => state.hydrated);
  const cookieConsent = usePreferences((state) => state.cookieConsent);
  const updatePreference = usePreferences((state) => state.updatePreference);

  if (!hydrated || cookieConsent !== 'unknown') {
    return null;
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-[90] mx-auto max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="text-sm text-[var(--muted-foreground)]">
          <p className="font-semibold text-[var(--foreground)]">Cookie notice</p>
          <p className="mt-1">
            BotParty uses essential cookies and browser storage for sign-in, room access, guest sessions, and UI preferences.
            {' '}
            <Link href="/cookies" className="text-[var(--foreground)] underline underline-offset-2">
              Learn more
            </Link>
          </p>
          <p className="mt-1 text-xs">
            You can accept the notice now or decline non-essential storage acknowledgement and keep using essential storage only.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            onClick={() => updatePreference('cookieConsent', 'declined')}
          >
            Decline optional acknowledgement
          </Button>
          <Button
            type="button"
            onClick={() => updatePreference('cookieConsent', 'accepted')}
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
