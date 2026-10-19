'use client';

import Link from 'next/link';
import { useState } from 'react';
import { emailSchema } from '@botparty/shared/schemas/auth';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const emailResult = emailSchema.safeParse(email.trim());
  const emailError = touched && !emailResult.success ? emailResult.error.issues[0]?.message ?? 'Invalid email' : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!emailResult.success) {
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await api.auth.forgotPassword(email.trim());
      setMessage(result.message);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Reset password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          Enter your account email and BotParty will send a reset link if that account exists.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(emailError)}
              className={`mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm outline-none transition ${
                emailError
                  ? 'border-[var(--destructive)] focus:border-[var(--destructive)]'
                  : 'border-[var(--border)] focus:border-[var(--primary)]'
              }`}
              placeholder="you@example.com"
            />
            {emailError ? <p className="mt-1 text-xs text-[var(--destructive)]">{emailError}</p> : null}
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          {message && (
            <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !emailResult.success}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Sending reset link...' : 'Send reset link'}
          </button>
        </form>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            Back to login
          </Link>
          <Link
            href="/docs/getting-started"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            Open docs
          </Link>
        </div>
      </div>
    </div>
  );
}
