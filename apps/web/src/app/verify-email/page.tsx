'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type VerifyState = 'idle' | 'verifying' | 'success' | 'error';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const initialEmail = searchParams.get('email')?.trim() ?? '';

  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;
    setState('verifying');
    setMessage(null);

    api.auth.verifyEmail(token)
      .then((result) => {
        if (!active) {
          return;
        }
        setState('success');
        setMessage(result.message);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setState('error');
        setMessage(error instanceof Error ? error.message : 'Verification failed.');
      });

    return () => {
      active = false;
    };
  }, [token]);

  const heading = useMemo(() => {
    if (state === 'verifying') return 'Verifying your email';
    if (state === 'success') return 'Email verified';
    if (state === 'error') return 'Verification link expired or invalid';
    return 'Verify your email';
  }, [state]);

  const handleResend = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setMessage(null);

    try {
      const result = await api.auth.resendVerificationEmail(email);
      setState('idle');
      setMessage(result.message);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Failed to resend verification email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-3xl items-center px-4 py-12">
      <Card className="w-full rounded-2xl border-[var(--border)] bg-[var(--card)]/95 shadow-2xl shadow-black/30">
        <CardContent className="p-6 sm:p-8">
          <div className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700 dark:text-sky-300">Account verification</p>
            <h1 className="text-3xl font-black tracking-tight">{heading}</h1>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Confirm your email address to finish setting up your account.
            </p>
          </div>

          {state === 'verifying' ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
              Checking your verification link...
            </div>
          ) : null}

          {message ? (
            <div
              role={state === 'error' ? 'alert' : 'status'}
              className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
                state === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                  : state === 'error'
                    ? 'border-[var(--destructive)]/40 bg-[var(--destructive)]/10 text-[var(--destructive)]'
                    : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]'
              }`}
            >
              {message}
            </div>
          ) : null}

          {state === 'success' ? (
            <div className="flex flex-wrap gap-3">
              <Link href="/login" className={buttonVariants({ variant: 'default' })}>
                Open sign-in
              </Link>
              <Link href="/explore" className={buttonVariants({ variant: 'secondary' })}>
                Browse robots
              </Link>
            </div>
          ) : (
            <form onSubmit={handleResend} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="verify-email-address">Email</Label>
                <Input
                  id="verify-email-address"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={sending}>
                  {sending ? 'Sending verification email...' : 'Resend verification email'}
                </Button>
                <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
                  Back to sign-in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
