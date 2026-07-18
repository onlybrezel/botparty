'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LEGAL_POLICY_VERSIONS, loginSchema, registerSchema } from '@botparty/shared';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'login' | 'register';
type AuthField = 'username' | 'email' | 'password';

type AuthDraft = {
  username: string;
  email: string;
  password: string;
};

function collectFieldErrors(mode: Mode, draft: AuthDraft, legalAccepted: boolean) {
  const result = (mode === 'login' ? loginSchema : registerSchema).safeParse({
    ...(mode === 'register' ? {
      username: draft.username,
      acceptedTermsVersion: legalAccepted ? LEGAL_POLICY_VERSIONS.TERMS : undefined,
      acceptedPrivacyVersion: legalAccepted ? LEGAL_POLICY_VERSIONS.PRIVACY : undefined,
    } : {}),
    email: draft.email,
    password: draft.password,
  });

  if (result.success) {
    return {} as Partial<Record<AuthField, string>>;
  }

  return result.error.issues.reduce<Partial<Record<AuthField, string>>>((acc, issue) => {
    const path = issue.path[0];
    if ((path === 'username' || path === 'email' || path === 'password') && !acc[path]) {
      acc[path] = issue.message;
    }
    return acc;
  }, {});
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSucceeded, setResetSucceeded] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<AuthField, boolean>>>({});
  const [draft, setDraft] = useState<AuthDraft>({
    username: '',
    email: '',
    password: '',
  });
  useEffect(() => {
    setResetSucceeded(new URLSearchParams(window.location.search).get('reset') === 'success');
  }, []);
  const fieldErrors = useMemo(() => collectFieldErrors(mode, draft, legalAccepted), [draft, legalAccepted, mode]);
  const visibleFieldErrors = useMemo(
    () =>
      Object.entries(fieldErrors).reduce<Partial<Record<AuthField, string>>>((acc, [field, message]) => {
        if (touched[field as AuthField] || loading) {
          acc[field as AuthField] = message;
        }
        return acc;
      }, {}),
    [fieldErrors, loading, touched],
  );
  const canSubmit = useMemo(() => {
    if (loading) {
      return false;
    }
    if (!draft.email.trim() || !draft.password) {
      return false;
    }
    if (mode === 'register' && (!draft.username.trim() || !legalAccepted)) {
      return false;
    }
    return Object.keys(fieldErrors).length === 0;
  }, [draft.email, draft.password, draft.username, fieldErrors, legalAccepted, loading, mode]);

  function updateField(field: AuthField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function touchField(field: AuthField) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ username: true, email: true, password: true });
    setError(null);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }
    setLoading(true);

    const email = draft.email.trim();
    const password = draft.password;

    try {
      if (mode === 'login') {
        const { accessToken, user } = await api.auth.login({ email, password });
        if (!accessToken) {
          throw new Error('Login response did not include an access token.');
        }
        api.setToken(accessToken);
        login({
          accessToken,
          username: user.username,
          userId: user.id,
          displayName: user.displayName,
          role: user.role,
        });

        router.push('/explore');
      } else {
        const username = draft.username.trim();
        const result = await api.auth.register({
          username,
          email,
          password,
          acceptedTermsVersion: LEGAL_POLICY_VERSIONS.TERMS,
          acceptedPrivacyVersion: LEGAL_POLICY_VERSIONS.PRIVACY,
        });
        if (result.accessToken) {
          api.setToken(result.accessToken);
          login({
            accessToken: result.accessToken,
            username: result.user.username,
            userId: result.user.id,
            displayName: result.user.displayName,
            role: result.user.role,
          });
          router.push('/dashboard/robots/new');
          return;
        }

        router.push(`/verify-email?email=${encodeURIComponent(email)}&sent=1`);
      }
    } catch (err) {
      if (
        mode === 'login'
        && err instanceof ApiError
        && err.status === 403
        && err.message.toLowerCase().includes('verify')
      ) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-[calc(100vh-8rem)] overflow-hidden px-4 py-12 sm:px-6 lg:px-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(48rem 32rem at 12% 12%, rgba(124,58,237,0.18), transparent 60%), radial-gradient(32rem 24rem at 88% 78%, rgba(14,165,233,0.16), transparent 60%)',
        }}
      />

      <div className="relative mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-2">
        <section className="hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/70 p-8 backdrop-blur-sm lg:block">
          <p className="mb-4 inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-300">
            HOST CONTROL
          </p>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-[var(--foreground)]">
            Run a room people enjoy joining.
            <br />
            Keep access sane.
            <br />
            Keep the robot safe.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
            Sign in to manage robots, claim clients, tune room access, and keep shared-control sessions under control.
          </p>

          <div className="mt-8 grid gap-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]/70 p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Room flow</p>
              <p className="mt-1 text-sm font-semibold">Video, queue state, chat, and turn-based control</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]/70 p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Robot setup</p>
              <p className="mt-1 text-sm font-semibold">Claim tokens, access rules, and remote ops in one place</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]/70 p-4">
              <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">Safety defaults</p>
              <p className="mt-1 text-sm font-semibold">Decide who can watch, chat, control, and hit E-STOP</p>
            </div>
          </div>
        </section>

        <Card className="w-full rounded-2xl border-[var(--border)] bg-[var(--card)]/95 shadow-2xl shadow-black/30">
          <CardContent className="p-6 sm:p-8">
            <div className="mb-6 text-center">
              <Link href="/" prefetch={false} className="inline-flex items-center gap-2 text-lg font-bold">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-black text-white">
                  BP
                </span>
                <span className="bg-gradient-to-r from-violet-300 via-violet-400 to-cyan-300 bg-clip-text text-transparent">
                  BotParty
                </span>
              </Link>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight">
                {mode === 'login' ? 'Jump back in' : 'Create your host account'}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {mode === 'login'
                  ? 'Sign in to open your rooms and settings.'
                  : 'Create an account to host robots and manage live rooms.'}
              </p>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  mode === 'login'
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  mode === 'register'
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                Create account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {resetSucceeded && mode === 'login' && !error && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  Password updated. Sign in with your new password.
                </div>
              )}

              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9_-]+"
                    autoComplete="username"
                    placeholder="cool_maker_42"
                    value={draft.username}
                    onChange={(event) => updateField('username', event.target.value)}
                    onBlur={() => touchField('username')}
                    aria-invalid={Boolean(visibleFieldErrors.username)}
                    className={visibleFieldErrors.username ? 'border-[var(--destructive)] focus-visible:ring-[var(--destructive)]' : undefined}
                  />
                  {visibleFieldErrors.username ? (
                    <p className="text-xs text-[var(--destructive)]">{visibleFieldErrors.username}</p>
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)]">3-32 chars, letters, numbers, `_` or `-`.</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete={mode === 'login' ? 'email' : 'new-email'}
                  placeholder="you@example.com"
                  value={draft.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  onBlur={() => touchField('email')}
                  aria-invalid={Boolean(visibleFieldErrors.email)}
                  className={visibleFieldErrors.email ? 'border-[var(--destructive)] focus-visible:ring-[var(--destructive)]' : undefined}
                />
                {visibleFieldErrors.email ? (
                  <p className="text-xs text-[var(--destructive)]">{visibleFieldErrors.email}</p>
                ) : null}
              </div>

              {mode === 'register' ? (
                <label className="flex items-start gap-3 text-sm text-[var(--muted-foreground)]">
                  <input type="checkbox" className="mt-1" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} required />
                  <span>I accept the <Link className="underline" href="/terms" prefetch={false}>Terms of Service</Link> and acknowledge the <Link className="underline" href="/privacy" prefetch={false}>Privacy Policy</Link>.</span>
                </label>
              ) : null}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === 'login' && (
                    <Link
                      href="/forgot-password"
                      prefetch={false}
                      className="text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="********"
                  value={draft.password}
                  onChange={(event) => updateField('password', event.target.value)}
                  onBlur={() => touchField('password')}
                  aria-invalid={Boolean(visibleFieldErrors.password)}
                  className={visibleFieldErrors.password ? 'border-[var(--destructive)] focus-visible:ring-[var(--destructive)]' : undefined}
                />
                {visibleFieldErrors.password ? (
                  <p className="text-xs text-[var(--destructive)]">{visibleFieldErrors.password}</p>
                ) : mode === 'register' ? (
                  <p className="text-xs text-[var(--muted-foreground)]">Use at least 8 characters.</p>
                ) : null}
              </div>

              {error && (
                <div className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={!canSubmit} className="mt-2 h-11 w-full text-sm">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                  </span>
                ) : mode === 'login' ? (
                  'Continue'
                ) : (
                  'Create account'
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-[var(--muted-foreground)]">
              <Link className="underline" href="/terms">Terms</Link> · <Link className="underline" href="/privacy">Privacy</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
