'use client';

import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { AUTH_SYNC_STORAGE_KEY, useAuth } from '@/lib/store';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { defaultLocale, localizePath } from '@/lib/i18n';
import { usePreferences } from '@/lib/preferences';

const NotificationCenter = dynamic(
  () => import('./notification-center').then((module) => module.NotificationCenter),
  { ssr: false },
);
const WebVitalsReporter = dynamic(
  () => import('./web-vitals-reporter').then((module) => module.WebVitalsReporter),
  { ssr: false },
);

export default function Nav() {
  const pathname = usePathname();
  const { accessToken, username, logout, role, syncLogout } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const theme = usePreferences((state) => state.theme);
  const productAnalyticsEnabled = usePreferences((state) => state.productAnalyticsEnabled);
  const updatePreference = usePreferences((state) => state.updatePreference);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [dropdownOpen]);

  useEffect(() => {
    let cancelled = false;
    let bootstrapController = new AbortController();
    const cancelPendingBootstrap = () => {
      cancelled = true;
      bootstrapController.abort();
    };
    window.addEventListener('pagehide', cancelPendingBootstrap);

    const bootstrap = async () => {
      const signal = bootstrapController.signal;
      api.syncTokenFromStore();
      const restored = await api.restoreSession(signal).catch(() => false);
      if (cancelled || signal.aborted) return;
      if (restored) {
        // Analytics is opt-in. If consent cannot be restored, keep tracking
        // disabled until the settings page can load the authoritative value.
        const consent = await api.analytics.consent().catch(() => null);
        if (cancelled || signal.aborted) return;
        updatePreference('productAnalyticsEnabled', Boolean(consent?.productAnalyticsEnabled));
      }
      if (!cancelled && !signal.aborted) {
        setMounted(true);
      }
    };

    const resumeBootstrap = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      cancelled = false;
      bootstrapController = new AbortController();
      void bootstrap();
    };
    window.addEventListener('pageshow', resumeBootstrap);
    void bootstrap();

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', cancelPendingBootstrap);
      window.removeEventListener('pageshow', resumeBootstrap);
    };
  }, [updatePreference]);

  useEffect(() => {
    setMenuOpen(false);
    setDropdownOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_SYNC_STORAGE_KEY || !event.newValue) {
        return;
      }

      try {
        const payload: unknown = JSON.parse(event.newValue);
        if (typeof payload === 'object' && payload !== null && 'type' in payload && payload.type === 'logout') {
          api.setToken(null);
          syncLogout();
        }
      } catch {
        // Ignore malformed cross-tab auth sync payloads.
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncLogout]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen && !dropdownOpen) return;

    const closeOpenMenu = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (dropdownOpen) {
        setDropdownOpen(false);
        userMenuButtonRef.current?.focus();
      }
      if (menuOpen) {
        setMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', closeOpenMenu);
    return () => document.removeEventListener('keydown', closeOpenMenu);
  }, [dropdownOpen, menuOpen]);

  useEffect(() => {
    if (!mounted || !accessToken) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const cancelPendingRequest = () => {
      cancelled = true;
    };
    window.addEventListener('pagehide', cancelPendingRequest);
    const load = () => {
      api.wallet
        .me()
        .then((res) => {
          if (!cancelled) setBalance(res.balance);
        })
        .catch(() => {
          if (!cancelled) {
            setBalance(null);
          }
        });
    };
    load();
    const onFocus = () => load();
    const onWalletUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ balance?: number }>).detail;
      if (detail && typeof detail.balance === 'number') {
        if (!cancelled) setBalance(detail.balance);
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('botparty:wallet-update', onWalletUpdate as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', cancelPendingRequest);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('botparty:wallet-update', onWalletUpdate as EventListener);
    };
  }, [accessToken, mounted, pathname]);

  const localized = (href: string) => localizePath(href, defaultLocale);
  const isActive = (href: string) => {
    const target = localized(href);
    return pathname === target || pathname.startsWith(`${target}/`);
  };
  const navLinks = [
    { href: '/', label: 'Home', active: pathname === '/' || pathname === `/${defaultLocale}` },
    { href: '/explore', label: 'Explore', active: isActive('/explore') },
    { href: '/leaderboard', label: 'Leaderboard', active: isActive('/leaderboard') },
    { href: '/pricing', label: 'Pricing', active: isActive('/pricing') },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur-md">
      {mounted && accessToken && productAnalyticsEnabled ? <WebVitalsReporter /> : null}
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href={localized('/')} prefetch={false} className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-[var(--border)]">
            <Image
              src="/brand/icon-64.png"
              alt="BotParty"
              width={28}
              height={28}
              style={{ width: 28, height: 28 }}
              className="h-7 w-7"
              priority
            />
          </span>
          <span>BotParty</span>
        </Link>

        <nav className="hidden h-full items-center gap-1 lg:flex">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={localized(item.href)}
              prefetch={false}
              className={`flex h-full items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                item.active
                  ? 'border-[var(--primary)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <a
            href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full items-center border-b-2 border-transparent px-3 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Robot Setup
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <button
            ref={mobileMenuButtonRef}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--foreground)] transition hover:bg-[var(--muted)] lg:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          {!mounted ? (
            <div className="hidden h-8 w-20 rounded-lg bg-[var(--muted)] animate-pulse lg:block" />
          ) : accessToken && username ? (
            <div className="relative flex items-center gap-2" ref={dropdownRef}>
              <NotificationCenter enabled={Boolean(accessToken)} />
              <Link
                href={localized('/wallet')}
                prefetch={false}
                className="hidden items-center gap-1 border-r border-[var(--border)] pr-3 text-xs font-semibold text-amber-800 transition hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200 lg:inline-flex"
                title="Wallet"
              >
                <span aria-hidden>◈</span>
                <span className="tabular-nums">
                  {balance === null ? '—' : balance.toLocaleString()}
                </span>
                <span className="text-[10px] uppercase tracking-wide">cr</span>
              </Link>
              <button
                ref={userMenuButtonRef}
                type="button"
                aria-label={`Open user menu for ${username}`}
                aria-expanded={dropdownOpen}
                aria-controls="user-navigation"
                onClick={() => setDropdownOpen((open) => !open)}
                className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition hover:bg-[var(--muted)] lg:flex"
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
                  id="user-navigation"
                  className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl shadow-black/25 animate-fade-in"
                >
                  <Link
                    href={localized('/dashboard')}
                    prefetch={false}
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Robots
                  </Link>
                  <Link
                    href={localized('/wallet')}
                    prefetch={false}
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Wallet
                  </Link>
                  {(role === 'ADMIN' || role === 'MOD') && (
                    <Link
                      href={localized('/mod')}
                      prefetch={false}
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                    >
                      Moderation
                    </Link>
                  )}
                  {role === 'ADMIN' && (
                    <Link
                      href={localized('/mod/analytics')}
                      prefetch={false}
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                    >
                      Product Analytics
                    </Link>
                  )}
                  <Link
                    href={localized('/settings')}
                    prefetch={false}
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Settings
                  </Link>
                  <Link
                    href={localized('/sessions')}
                    prefetch={false}
                    onClick={() => setDropdownOpen(false)}
                    className="block px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition"
                  >
                    Sessions
                  </Link>
                  <div className="px-4 py-2">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Theme
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(['system', 'dark', 'light'] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => updatePreference('theme', option)}
                          className="rounded-full"
                          aria-pressed={theme === option}
                        >
                          <Badge tone={theme === option ? 'success' : 'default'}>
                            {option}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button
                    onClick={() => {
                      void api.auth.logout().catch((error: unknown) => {
                        console.error('Server logout failed; clearing the local session', error);
                      }).finally(() => {
                        api.setToken(null);
                        logout();
                        setDropdownOpen(false);
                      });
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-[var(--muted)] transition"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="hidden items-center lg:flex">
              <Link
                href={localized('/login')}
                prefetch={false}
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
              >
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>

      {menuOpen && (
        <div id="mobile-navigation" className="safe-pb border-t border-[var(--border)] bg-[var(--background)] px-4 py-3 shadow-xl shadow-black/20 lg:hidden">
          <nav className="divide-y divide-[var(--border)]">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={localized(item.href)}
                prefetch={false}
                className={`block px-1 py-3 text-sm font-medium transition-colors ${
                  item.active
                    ? 'text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)]'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <a
              href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-1 py-3 text-sm font-medium text-[var(--muted-foreground)]"
            >
              Robot Setup
            </a>
          </nav>

          <div className="mt-3 border-t border-[var(--border)] pt-4">
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
                <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  <Link href={localized('/dashboard')} prefetch={false} className="block px-1 py-3 text-sm text-[var(--foreground)]">
                    Robots
                  </Link>
                  <Link href={localized('/wallet')} prefetch={false} className="block px-1 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
                    Wallet{balance !== null ? ` · ${balance.toLocaleString()} cr` : ''}
                  </Link>
                  {(role === 'ADMIN' || role === 'MOD') && (
                    <Link href={localized('/mod')} prefetch={false} className="block px-1 py-3 text-sm text-[var(--foreground)]">
                      Moderation
                    </Link>
                  )}
                  <Link href={localized('/settings')} prefetch={false} className="block px-1 py-3 text-sm text-[var(--foreground)]">
                    Settings
                  </Link>
                  <Link href={localized('/sessions')} prefetch={false} className="block px-1 py-3 text-sm text-[var(--foreground)]">
                    Sessions
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      void api.auth.logout().catch((error: unknown) => {
                        console.error('Server logout failed; clearing the local session', error);
                      }).finally(() => {
                        api.setToken(null);
                        logout();
                        setMenuOpen(false);
                      });
                    }}
                    className="block w-full px-1 py-3 text-left text-sm font-medium text-red-300"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Link
                  href={localized('/login')}
                  prefetch={false}
                  className="block rounded-lg bg-[var(--primary)] px-4 py-3 text-center text-sm font-semibold text-white"
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
