import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cookie Notice',
  description: 'How BotParty uses cookies and browser storage.',
};

const cookieRows = [
  {
    name: 'Session storage and auth state',
    purpose: 'Keeps signed-in sessions, refreshed access, and temporary room access grants working across pages.',
    type: 'Essential',
  },
  {
    name: 'Guest session identifier',
    purpose: 'Lets public visitors keep a stable guest identity for presence, room access, and live session behavior.',
    type: 'Essential',
  },
  {
    name: 'UI preferences',
    purpose: 'Stores dashboard and keyboard preferences such as hidden tokens, focus behavior, and related settings.',
    type: 'Functional',
  },
  {
    name: 'Temporary chat and room state',
    purpose: 'May cache recent chat or room convenience state locally to make reconnects and UI continuity smoother.',
    type: 'Functional',
  },
];

export default function CookieNoticePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">Legal</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Cookie Notice</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
          BotParty uses essential browser storage so live rooms, guest access, dashboards, and session continuity work reliably.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="grid grid-cols-1 border-b border-[var(--border)] bg-[var(--muted)]/30 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)] sm:grid-cols-[1.1fr,0.8fr,2fr]">
          <div>Name</div>
          <div>Type</div>
          <div>Purpose</div>
        </div>
        {cookieRows.map((row) => (
          <div
            key={row.name}
            className="grid grid-cols-1 gap-2 border-b border-[var(--border)] px-5 py-4 text-sm last:border-b-0 sm:grid-cols-[1.1fr,0.8fr,2fr]"
          >
            <div className="font-medium text-[var(--foreground)]">{row.name}</div>
            <div className="text-[var(--muted-foreground)]">{row.type}</div>
            <div className="text-[var(--muted-foreground)]">{row.purpose}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm leading-7 text-[var(--muted-foreground)]">
        <p>BotParty currently relies on essential and functional storage to operate live rooms and account features.</p>
        <p className="mt-3">You can accept or decline non-essential categories from the cookie banner and review the current consent state later in Settings.</p>
        <p className="mt-3">If analytics, advertising, or third-party tracking are introduced later, this notice should be expanded and any required consent flow should be added before those technologies are enabled.</p>
      </div>
    </div>
  );
}
