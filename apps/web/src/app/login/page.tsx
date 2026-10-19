'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LEGAL_POLICY_VERSIONS } from '@botparty/shared/constants';
import { loadAuthSchemas, type AuthSchemas } from './auth-schemas';
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

function parseAuthDraft(schemas: AuthSchemas, mode: Mode, draft: AuthDraft, legalAccepted: boolean) {
  return (mode === 'login' ? schemas.loginSchema : schemas.registerSchema).safeParse({
    ...(mode === 'register' ? {
      username: draft.username,
      acceptedTermsVersion: legalAccepted ? LEGAL_POLICY_VERSIONS.TERMS : undefined,
      acceptedPrivacyVersion: legalAccepted ? LEGAL_POLICY_VERSIONS.PRIVACY : undefined,
    } : {}),
    email: draft.email,
    password: draft.password,
  });

}

function collectFieldErrors(schemas: AuthSchemas, mode: Mode, draft: AuthDraft, legalAccepted: boolean) {
  const result = parseAuthDraft(schemas, mode, draft, legalAccepted);
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
  const [schemas, setSchemas] = useState<AuthSchemas | null>(null);
  const [schemaError, setSchemaError] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const schemaLoad = useRef<Promise<AuthSchemas | null> | null>(null);
  const submitPending = useRef(false);
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
  const fieldErrors = useMemo(
    () => schemas ? collectFieldErrors(schemas, mode, draft, legalAccepted) : {},
    [draft, legalAccepted, mode, schemas],
  );
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
    if (loading || !schemas) {
      return false;
    }
    if (!draft.email.trim() || !draft.password) {
      return false;
    }
    if (mode === 'register' && (!draft.username.trim() || !legalAccepted)) {
      return false;
    }
    return Object.keys(fieldErrors).length === 0;
  }, [draft.email, draft.password, draft.username, fieldErrors, legalAccepted, loading, mode, schemas]);

  async function ensureAuthSchemas(): Promise<AuthSchemas | null> {
    if (schemas) return schemas;
    if (!schemaLoad.current) {
      setSchemaError(false);
      setSchemaLoading(true);
      schemaLoad.current = loadAuthSchemas()
        .then((loaded) => {
          setSchemas(loaded);
          return loaded;
        })
        .catch(() => {
          setSchemaError(true);
          return null;
        })
        .finally(() => {
          schemaLoad.current = null;
          setSchemaLoading(false);
        });
    }
    return schemaLoad.current;
  }

  function updateField(field: AuthField, value: string) {
    void ensureAuthSchemas();
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function touchField(field: AuthField) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitPending.current) return;
    submitPending.current = true;
    setTouched({ username: true, email: true, password: true });
    setError(null);
    const readySchemas = await ensureAuthSchemas();
    if (!readySchemas || !parseAuthDraft(readySchemas, mode, draft, legalAccepted).success) {
      submitPending.current = false;
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
          router.push('/dashboard#new-robot');
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
      submitPending.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] border-b border-[var(--border)] px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(420px,1fr)] lg:items-start lg:gap-20">
        <section className="hidden pt-8 lg:block">
          <p className="text-sm font-semibold text-[var(--primary)]">For robot hosts</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-[-0.03em] text-[var(--foreground)]">
            Manage your robots and rooms.
          </h1>
          <p className="mt-4 max-w-md text-base leading-7 text-[var(--muted-foreground)]">
            Set up hardware, control room access and keep every live session under control.
          </p>

          <div className="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            <div className="py-4">
              <p className="text-sm font-semibold">Room operations</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Video, queues, chat and turn-based control</p>
            </div>
            <div className="py-4">
              <p className="text-sm font-semibold">Robot setup</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Claim tokens, access rules and remote actions</p>
            </div>
            <div className="py-4">
              <p className="text-sm font-semibold">Safety</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Permissions, moderation and emergency controls</p>
            </div>
          </div>
        </section>

        <Card className="w-full border-[var(--border)] bg-[var(--card)]">
          <CardContent className="p-6 sm:p-8">
            <div className="mb-7">
              <Link href="/" prefetch={false} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-xs font-bold text-white">
                  BP
                </span>
                BotParty
              </Link>
              <h2 className="mt-6 text-2xl font-bold tracking-tight">
                {mode === 'login' ? 'Sign in' : 'Create your account'}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                {mode === 'login'
                  ? 'Open your rooms, wallet and account settings.'
                  : 'Set up your first robot after registration.'}
              </p>
            </div>

            <div className="mb-6 grid grid-cols-2 border-b border-[var(--border)]">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                  mode === 'login'
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
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
                className={`border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                  mode === 'register'
                    ? 'border-[var(--primary)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                Create account
              </button>
            </div>

            <form onSubmit={handleSubmit} onFocusCapture={() => { void ensureAuthSchemas(); }} className="space-y-4">
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
                    pattern="[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*"
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

              {schemaLoading && <p role="status" className="text-sm text-[var(--muted-foreground)]">Preparing form validation...</p>}
              {schemaError && (
                <div role="alert" className="text-sm text-[var(--destructive)]">
                  Form validation could not be loaded. Your details have not been submitted.
                  <button type="button" className="ml-2 underline" onClick={() => { void ensureAuthSchemas(); }}>
                    Retry validation
                  </button>
                </div>
              )}

              {error && (
                <div role="alert" className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
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

            <p className="mt-6 text-xs text-[var(--muted-foreground)]">
              <Link className="underline" href="/terms">Terms</Link> · <Link className="underline" href="/privacy">Privacy</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
