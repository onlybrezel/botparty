'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';

const ONBOARDING_DISMISS_KEY = 'botparty.onboarding.dismissed.v1';

export function ExploreOnboardingBanner() {
  const searchParams = useSearchParams();
  const { accessToken, userId } = useAuth();
  const [shouldShow, setShouldShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const welcomeMode = searchParams.get('onboarding') === 'welcome';
  const dismissKey = useMemo(() => (userId ? `${ONBOARDING_DISMISS_KEY}:${userId}` : null), [userId]);

  useEffect(() => {
    if (!accessToken || !userId || !dismissKey) {
      setShouldShow(false);
      setLoading(false);
      return;
    }

    if (typeof window !== 'undefined' && window.localStorage.getItem(dismissKey) === '1') {
      setShouldShow(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    api.setToken(accessToken);
    api.robots
      .getMyRobots()
      .then((robots) => {
        if (!cancelled) {
          setShouldShow(robots.length === 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShouldShow(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, dismissKey, userId]);

  if (loading || !shouldShow) {
    return null;
  }

  return (
    <section className="mb-6 rounded-3xl border border-violet-500/25 bg-violet-500/10 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">
            <Sparkles className="h-3.5 w-3.5" />
            {welcomeMode ? 'Welcome aboard' : 'Host onboarding'}
          </p>
          <h2 className="mt-3 text-xl font-black tracking-tight">Create your first robot room.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
            Start with one robot, add a thumbnail, confirm queue settings, and invite viewers once the Python client is online.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/robots/new"
            className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
          >
            Create first robot
          </Link>
          <Link
            href="/docs/robot-setup"
            className="rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold transition hover:border-[var(--primary)]"
          >
            Read robot setup guide
          </Link>
          <button
            type="button"
            onClick={() => {
              if (dismissKey && typeof window !== 'undefined') {
                window.localStorage.setItem(dismissKey, '1');
              }
              setShouldShow(false);
            }}
            className="rounded-full border border-transparent px-4 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
