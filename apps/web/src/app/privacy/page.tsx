import type { Metadata } from 'next';
import { getLegalConfig } from '@/lib/legal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How BotParty collects, uses, and protects personal data.',
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--muted-foreground)]">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const legal = getLegalConfig();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">Legal</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Privacy Policy</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
          BotParty handles live robot streams, queue state, chat, moderation, and account data. This page explains what we store and why.
        </p>
      </div>

      {!legal.isConfigured ? (
        <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-100 text-amber-950 p-4 text-sm dark:bg-amber-500/10 dark:text-amber-100">
          Final operator details are still missing for this deployment. Configure the `NEXT_PUBLIC_LEGAL_*` variables before public launch.
        </div>
      ) : null}

      <div className="space-y-5">
        <Section title="What we collect">
          <p>We collect account data such as username, email address, password hash, and optional profile fields.</p>
          <p>When you use a robot room, we may process queue participation, chat messages, moderation actions, room access state, and telemetry needed to keep sessions stable and fair.</p>
          <p>For guests, BotParty may create a local guest session identifier in your browser so public rooms can track presence and session continuity without a full account.</p>
        </Section>

        <Section title="How we use data">
          <p>We use data to authenticate users, run live video and control sessions, enforce room access policies, prevent abuse, and operate moderation tools.</p>
          <p>Operational logs and diagnostics may be processed to investigate outages, rate limits, queue issues, or security events.</p>
        </Section>

        <Section title="Realtime and safety data">
          <p>Robot control is a safety-sensitive feature. Queue state, moderation restrictions, emergency-stop access, and related session events may be stored or replayed briefly so the system can behave predictably.</p>
          <p>Chat content and moderation events may also be analyzed for profanity filtering, abuse prevention, and incident review.</p>
        </Section>

        <Section title="Cookies and browser storage">
          <p>BotParty uses essential browser storage for sign-in state, guest session identifiers, room access grants, UI settings, and temporary chat/session convenience features.</p>
          <p>See the Cookie Notice for details on storage categories and purpose.</p>
        </Section>

        <Section title="Sharing and retention">
          <p>We do not need to expose private account data publicly to run the product. Public robot pages may show usernames, display names, queue presence, and chat messages as part of the shared experience.</p>
          <p>We keep data only as long as it is needed for account operation, safety, abuse handling, billing, diagnostics, or legal obligations.</p>
        </Section>

        <Section title="Controller and contact">
          <p><strong className="text-[var(--foreground)]">Operator:</strong> {legal.operatorName}</p>
          <p><strong className="text-[var(--foreground)]">Address:</strong> {legal.operatorAddress}</p>
          <p>
            <strong className="text-[var(--foreground)]">Privacy contact:</strong>{' '}
            <a className="underline" href={`mailto:${legal.operatorEmail}`}>{legal.operatorEmail}</a>
          </p>
          <p>When data practices change materially, this page should be updated together with the related product behavior.</p>
        </Section>
      </div>
    </div>
  );
}
