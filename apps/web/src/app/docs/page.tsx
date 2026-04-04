import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'BotParty quick documentation and onboarding.',
};

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Documentation</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Short, practical guides for hosts and viewers. No fluff.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/docs/getting-started"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-[var(--primary)]/60"
          >
            <p className="text-sm font-semibold">Getting Started</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Setup from zero to first live robot.
            </p>
          </Link>
          <Link
            href="/dashboard"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-[var(--primary)]/60"
          >
            <p className="text-sm font-semibold">Host Dashboard</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Manage robot settings, access, and remote ops.
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
