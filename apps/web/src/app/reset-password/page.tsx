'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { passwordSchema } from '@botparty/shared/schemas/auth';
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
  const [touched, setTouched] = useState<{ password?: boolean; confirmPassword?: boolean; token?: boolean }>({});
  const passwordResult = passwordSchema.safeParse(password);
  const passwordError =
    touched.password && !passwordResult.success
      ? passwordResult.error.issues[0]?.message ?? 'Password must be at least 8 characters'
      : null;
  const confirmError =
    touched.confirmPassword && password !== confirmPassword ? 'Passwords do not match' : null;
  const tokenError = !token
    ? 'This password reset link is incomplete. Request a new reset link.'
    : null;
  const canSubmit = Boolean(token) && passwordResult.success && password === confirmPassword && !loading;

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
    setTouched({ token: true, password: true, confirmPassword: true });

    if (!token) {
      setError('Missing password reset token');
      return;
    }

    if (!passwordResult.success) {
      setError(passwordResult.error.issues[0]?.message ?? 'Password must be at least 8 characters');
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
              onBlur={() => setTouched((current) => ({ ...current, password: true }))}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? 'new-password-error' : undefined}
              className={`mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm outline-none transition ${
                passwordError
                  ? 'border-[var(--destructive)] focus:border-[var(--destructive)]'
                  : 'border-[var(--border)] focus:border-[var(--primary)]'
              }`}
              placeholder="At least 8 characters"
            />
            {passwordError ? <p id="new-password-error" className="mt-1 text-xs text-[var(--destructive)]">{passwordError}</p> : null}
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
              onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))}
              aria-invalid={Boolean(confirmError)}
              aria-describedby={confirmError ? 'confirm-password-error' : undefined}
              className={`mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm outline-none transition ${
                confirmError
                  ? 'border-[var(--destructive)] focus:border-[var(--destructive)]'
                  : 'border-[var(--border)] focus:border-[var(--primary)]'
              }`}
              placeholder="Repeat password"
            />
            {confirmError ? <p id="confirm-password-error" className="mt-1 text-xs text-[var(--destructive)]">{confirmError}</p> : null}
          </div>

          {tokenError ? <p className="text-xs text-[var(--destructive)]">{tokenError}</p> : null}

          {error && (
            <div role="alert" className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          {message && (
            <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
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
