'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const COOKIE_CONSENT_KEY = 'botparty.cookie-consent.v1';

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(COOKIE_CONSENT_KEY) !== 'accepted');
    } catch {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
    } catch {
      // ignore storage errors
    }
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-[90] mx-auto max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="text-sm text-[var(--muted-foreground)]">
          <p className="font-semibold text-[var(--foreground)]">Cookie notice</p>
          <p className="mt-1">
            BotParty uses essential cookies and browser storage for sign-in, room access, guest sessions, and UI preferences.
            {' '}
            <Link href="/cookies" className="text-[var(--foreground)] underline underline-offset-2">
              Learn more
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={accept}
          className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
        >
          Accept essential storage
        </button>
      </div>
    </div>
  );
}
