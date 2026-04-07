import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Practical BotParty docs for hosts, room setup, and safer first launches.',
};

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Documentation</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Short, practical docs for getting a robot online without guessing your way through the first session.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/docs/getting-started"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-[var(--primary)]/60"
          >
            <p className="text-sm font-semibold">Getting Started</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              The quickest safe path from empty dashboard to first live room.
            </p>
          </Link>
          <Link
            href="/docs/multi-camera"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-[var(--primary)]/60"
          >
            <p className="text-sm font-semibold">Multi-Camera</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              The recommended BotParty architecture for front, rear, and other secondary camera views.
            </p>
          </Link>
          <Link
            href="/dashboard"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-[var(--primary)]/60"
          >
            <p className="text-sm font-semibold">Host Dashboard</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Manage robot settings, access rules, control buttons, telemetry, and remote ops.
            </p>
          </Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Before sharing</p>
            <p className="mt-2 text-sm font-semibold">Test E-STOP, turn timer, and camera angle</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">For public rooms</p>
            <p className="mt-2 text-sm font-semibold">Start with authenticated control and short queue turns</p>
          </div>
          <a
            href="https://github.com/onlybrezel/botparty-client/blob/main/docs/index.md"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 transition hover:border-[var(--primary)]/60"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Robot client</p>
            <p className="mt-2 text-sm font-semibold">Open the hardware setup docs on GitHub</p>
          </a>
        </div>
      </section>
    </div>
  );
}
