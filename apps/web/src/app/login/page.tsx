'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            {isRegister
              ? 'Join BotParty and start controlling robots'
              : 'Sign in to your BotParty account'}
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // TODO: Wire up auth API
          }}
        >
          {isRegister && (
            <div>
              <label className="mb-1 block text-sm font-medium">Username</label>
              <input
                type="text"
                required
                minLength={3}
                maxLength={32}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 outline-none focus:border-[var(--primary)]"
                placeholder="cool_maker_42"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 outline-none focus:border-[var(--primary)]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              required
              minLength={8}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 outline-none focus:border-[var(--primary)]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--primary)] py-2.5 font-semibold text-white transition hover:opacity-90"
          >
            {isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-purple-400 hover:underline"
          >
            {isRegister ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}
