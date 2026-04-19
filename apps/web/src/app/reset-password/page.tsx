'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryToken = searchParams.get('token') ?? '';
  const [fragmentToken, setFragmentToken] = useState('');
  const token = useMemo(() => (fragmentToken || queryToken).trim(), [fragmentToken, queryToken]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const tokenFromHash = params.get('token')?.trim() ?? '';
    if (tokenFromHash) {
      setFragmentToken(tokenFromHash);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      setError('Missing password reset token');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await api.auth.resetPassword(token, password);
      setMessage(result.message);
      window.setTimeout(() => router.push('/login?reset=success'), 1200);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Choose a new password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          Set a new password for your account. Reset links expire automatically.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="password" className="text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary)]"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary)]"
              placeholder="Repeat password"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Saving...' : 'Update password'}
          </button>
        </form>

        <div className="mt-6">
          <Link
            href="/login"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
