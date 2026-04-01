'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const email = emailRef.current!.value.trim();
    const password = passwordRef.current!.value;

    try {
      if (mode === 'login') {
        const { accessToken, refreshToken } = await api.login({ email, password });
        api.setToken(accessToken);

        // Fetch user info
        const me = await api.getMe();
        login({
          accessToken,
          refreshToken,
          username: me.username,
          userId: me.id,
          displayName: me.displayName,
        });

        router.push('/explore');
      } else {
        const username = usernameRef.current!.value.trim();
        const { accessToken, refreshToken } = await api.register({ username, email, password });
        api.setToken(accessToken);

        const me = await api.getMe();
        login({
          accessToken,
          refreshToken,
          username: me.username,
          userId: me.id,
          displayName: me.displayName,
        });

        router.push('/explore');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-7 text-center">
          <Link href="/" className="mb-4 inline-flex items-center gap-2 text-lg font-bold">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm"
              style={{ background: 'var(--primary)' }}
            >
              ⚡
            </span>
            <span className="bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">
              BotParty
            </span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
            {mode === 'login'
              ? 'Sign in to start driving robots'
              : 'Join BotParty — it only takes a minute'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="username">
                Username
              </label>
              <input
                ref={usernameRef}
                id="username"
                type="text"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_-]+"
                autoComplete="username"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--primary)]"
                placeholder="cool_maker_42"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              required
              autoComplete={mode === 'login' ? 'email' : 'new-email'}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--primary)]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              {mode === 'login' && (
                <Link href="/forgot-password" className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                  Forgot password?
                </Link>
              )}
            </div>
            <input
              ref={passwordRef}
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--primary)]"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-2.5 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-lg bg-[var(--primary)] py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {mode === 'login' ? 'Signing in...' : 'Creating account...'}
              </span>
            ) : mode === 'login' ? (
              'Sign in'
            ) : (
              'Create account'
            )}
          </button>
        </form>

        {/* Toggle */}
        <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            className="font-medium text-violet-400 hover:text-violet-300 transition-colors"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}

