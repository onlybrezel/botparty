'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/store';
import { api } from '@/lib/api';

export default function Nav() {
  const pathname = usePathname();
  const { accessToken, username, refreshToken, logout, role } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  useEffect(() => {
    setMenuOpen(false);
    setDropdownOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const navLinks = [
    { href: '/', label: 'Home', active: pathname === '/' },
    { href: '/explore', label: 'Explore', active: isActive('/explore') },
    { href: '/leaderboard', label: 'Leaderboard', active: isActive('/leaderboard') },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <Image
              src="/brand/icon-64.png"
              alt="BotParty"
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
          </span>
          <span className="bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">
            BotParty
          </span>
          <span className="inline-flex items-center gap-1 pl-0.5">
            <span className="rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300 border border-amber-500/30">
              Alpha
            </span>
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-2 sm:flex">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                item.active
                  ? 'bg-[var(--muted)] text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
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
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition hover:border-[var(--muted-foreground)] sm:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          {!mounted ? (
            <div className="hidden h-8 w-20 rounded-lg bg-[var(--muted)] animate-pulse sm:block" />
          ) : accessToken && username ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen((open) => !open)}
                className="hidden items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--muted-foreground)] sm:flex"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-xs text-white font-bold uppercase">
                  {username[0]}
                </span>
                <span>{username}</span>
                <svg className="h-3 w-3 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {dropdownOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg shadow-black/40 animate-fade-in"
                  onBlur={() => setDropdownOpen(false)}
                >
                  <Link
                    href="/dashboard"
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Robots Dashboard
                  </Link>
                  {(role === 'ADMIN' || role === 'MOD') && (
                    <Link
                      href="/mod"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                    >
                      Mod Dashboard
                    </Link>
                  )}
                  <Link
                    href="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Settings
                  </Link>
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button
                    onClick={() => {
                      logout();
                      setDropdownOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-[var(--muted)] transition"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
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

      {menuOpen && (
        <div className="safe-pb border-t border-[var(--border)] bg-[var(--background)] px-4 py-4 shadow-2xl shadow-black/30 sm:hidden">
          <nav className="flex flex-col gap-2">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                  item.active
                    ? 'bg-[var(--muted)] text-[var(--foreground)]'
                    : 'border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <a
              href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-medium text-[var(--muted-foreground)]"
            >
              Robot Setup
            </a>
          </nav>

          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            {!mounted ? (
              <div className="h-10 w-full rounded-xl bg-[var(--muted)] animate-pulse" />
            ) : accessToken && username ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold uppercase text-white">
                    {username[0]}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{username}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">Signed in</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Link href="/dashboard" className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--foreground)]">
                    Robots Dashboard
                  </Link>
                  {(role === 'ADMIN' || role === 'MOD') && (
                    <Link href="/mod" className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--foreground)]">
                      Mod Dashboard
                    </Link>
                  )}
                  <Link href="/settings" className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--foreground)]">
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      setMenuOpen(false);
                    }}
                    className="rounded-xl border border-red-500/30 px-4 py-3 text-left text-sm font-medium text-red-300"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                  {guestLabel}
                </p>
                <Link
                  href="/login"
                  className="block rounded-xl bg-[var(--primary)] px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Sign in
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
