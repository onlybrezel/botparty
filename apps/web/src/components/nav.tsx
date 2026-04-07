'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { useAuth } from '@/lib/store';
import { api } from '@/lib/api';

export default function Nav() {
  const pathname = usePathname();
  const { accessToken, username, refreshToken, logout } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guestLabel, setGuestLabel] = useState('Guest');

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      api.syncTokenFromStore();
      if (refreshToken) {
        await api.restoreSession().catch(() => undefined);
      }
      if (!cancelled) {
        setMounted(true);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (!mounted || accessToken) return;
    try {
      const key = 'botparty.guestSessionId.v1';
      const stored = (window.localStorage.getItem(key) ?? '').trim().toLowerCase();
      const sessionId = /^[a-z0-9_-]{6,64}$/.test(stored)
        ? stored
        : Math.random().toString(36).slice(2, 14);
      if (sessionId !== stored) {
        window.localStorage.setItem(key, sessionId);
      }
      setGuestLabel(`Guest-${sessionId.slice(0, 6)}`);
    } catch {
      setGuestLabel('Guest');
    }
  }, [accessToken, mounted]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sm"
            style={{ background: 'var(--primary)' }}
          >
            <Zap className="h-4 w-4 text-white" />
          </span>
          <span className="bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">
            BotParty
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-2 sm:flex">
          <Link
            href="/"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              pathname === '/'
                ? 'bg-[var(--muted)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Home
          </Link>
          <Link
            href="/explore"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive('/explore')
                ? 'bg-[var(--muted)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Explore
          </Link>
          <Link
            href="/leaderboard"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive('/leaderboard')
                ? 'bg-[var(--muted)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Leaderboard
          </Link>
          <a
            href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Robot Setup
          </a>
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-3">
          {!mounted ? (
            <div className="h-8 w-20 rounded-lg bg-[var(--muted)] animate-pulse" />
          ) : accessToken && username ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--muted-foreground)]"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-xs text-white font-bold uppercase">
                  {username[0]}
                </span>
                <span>{username}</span>
                <svg className="h-3 w-3 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg shadow-black/40 animate-fade-in"
                  onBlur={() => setMenuOpen(false)}
                >
                  <Link
                    href="/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Robots Dashboard
                  </Link>
                  <Link
                    href="/mod"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Mod Dashboard
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Settings
                  </Link>
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button
                    onClick={() => {
                      logout();
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-[var(--muted)] transition"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="hidden rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--muted-foreground)] sm:inline-flex">
                {guestLabel}
              </span>
              <Link
                href="/login"
                className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
              >
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
