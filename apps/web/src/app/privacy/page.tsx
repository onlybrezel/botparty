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

const dataFlowRows = [
  {
    data: 'Account profile (username, email, password hash, display name)',
    purpose: 'Sign-in, account recovery, operator identity, abuse handling',
    storage: 'PostgreSQL users table, password reset + verification mail queue',
    retention: 'Until account deletion; the login profile is then anonymized',
  },
  {
    data: 'Refresh/session state, CSRF token, guest session id',
    purpose: 'Session continuity, fraud prevention, queue continuity for guests',
    storage: 'HTTP-only cookies, browser storage, Redis session state',
    retention: 'Access cookie: 15 minutes; refresh cookie: 7 days; room grants: browser session',
  },
  {
    data: 'Robot metadata, access settings, schedule, webhooks, thumbnails',
    purpose: 'Host setup, room access control, media presentation, operator tooling',
    storage: 'PostgreSQL robots tables, object storage for thumbnails',
    retention: 'Until robot deletion or account deletion, then cleanup jobs remove dependent objects',
  },
  {
    data: 'Queue events, chat messages, moderation actions, room presence',
    purpose: 'Realtime coordination, moderation, abuse review, safety enforcement',
    storage: 'Redis realtime state plus PostgreSQL queue, chat, session, audit and moderation tables',
    retention: 'Presence expires with the room; queue entries expire by session policy; chat: 30 days; inactive moderation records: 180 days',
  },
  {
    data: 'Session telemetry, runtime diagnostics, rate-limit signals',
    purpose: 'Reliability, debugging, incident response, anti-abuse controls',
    storage: 'PostgreSQL, Redis, application logs, optional observability stack',
    retention: 'Runtime telemetry: 90 days; application logs: 30 days',
  },
  {
    data: 'Billing intents, webhook events, wallet ledger, payouts',
    purpose: 'Credit purchases, refunds, disputes, manual payout review, accounting',
    storage: 'PostgreSQL billing and wallet tables',
    retention: '10 years after the financial event',
  },
  {
    data: 'Room recordings and recording metadata',
    purpose: 'Moderation evidence, incident review, operator safety audits',
    storage: 'LiveKit egress object storage and session metadata',
    retention: '30 days by default; incident evidence may be held for 180 days',
  },
  {
    data: 'Product analytics events',
    purpose: 'Measure discovery, queue, control and host-onboarding funnels',
    storage: 'First-party PostgreSQL analytics table; no advertising profile',
    retention: 'Only after opt-in; 90 days, or deleted immediately when consent is withdrawn',
  },
  {
    data: 'In-app and email notifications',
    purpose: 'Queue-turn, robot-state and financial updates requested in account settings',
    storage: 'PostgreSQL notification feed and email outbox',
    retention: 'Up to 180 days; delivery preferences remain until changed or the account is deleted',
  },
];

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

        <Section title="Data flow overview">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--foreground)]">
                  <th className="px-3 py-2 font-semibold">Data</th>
                  <th className="px-3 py-2 font-semibold">Purpose</th>
                  <th className="px-3 py-2 font-semibold">Storage location</th>
                  <th className="px-3 py-2 font-semibold">Retention</th>
                </tr>
              </thead>
              <tbody>
                {dataFlowRows.map((row) => (
                  <tr key={row.data} className="border-b border-[var(--border)] align-top">
                    <td className="px-3 py-3 text-[var(--foreground)]">{row.data}</td>
                    <td className="px-3 py-3">{row.purpose}</td>
                    <td className="px-3 py-3">{row.storage}</td>
                    <td className="px-3 py-3">{row.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Realtime and safety data">
          <p>Robot control is a safety-sensitive feature. Queue state, moderation restrictions, emergency-stop access, and related session events may be stored or replayed briefly so the system can behave predictably.</p>
          <p>Chat content and moderation events may also be analyzed for profanity filtering, abuse prevention, and incident review.</p>
        </Section>

        <Section title="Cookies and browser storage">
          <p>BotParty uses essential browser storage for sign-in state, guest session identifiers, room access grants, UI settings, and temporary chat/session convenience features.</p>
          <p>Product analytics does not set an analytics cookie. Signed-in users can opt in from Settings and withdraw consent at any time.</p>
          <p>See the Cookie Notice for the exact names, purposes, and lifetimes.</p>
        </Section>

        <Section title="Sharing and retention">
          <p>We do not need to expose private account data publicly to run the product. Public robot pages may show usernames, display names, queue presence, and chat messages as part of the shared experience.</p>
          <p>We keep data only as long as it is needed for account operation, safety, abuse handling, billing, diagnostics, or legal obligations.</p>
        </Section>

        <Section title="Your rights">
          <p>Depending on the applicable law, you may have rights to access, rectify, erase, export, restrict, or object to processing of your personal data.</p>
          <p>BotParty exposes account export and account deletion flows in the product. Operators remain responsible for answering identity-verified privacy requests that cannot be handled self-service.</p>
        </Section>

        <Section title="Controller and contact">
          <p><strong className="text-[var(--foreground)]">Operator:</strong> {legal.operatorName}</p>
          <p><strong className="text-[var(--foreground)]">Address:</strong> {legal.operatorAddress}</p>
          <p>
            <strong className="text-[var(--foreground)]">Privacy contact:</strong>{' '}
            <a className="underline" href={`mailto:${legal.operatorEmail}`}>{legal.operatorEmail}</a>
          </p>
          <p>Policy version: 2026-07-17</p>
        </Section>
      </div>
    </div>
  );
}
