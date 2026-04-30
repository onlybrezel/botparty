import type { Metadata } from 'next';
import { getLegalConfig } from '@/lib/legal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing the use of BotParty.',
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

export default function TermsPage() {
  const legal = getLegalConfig();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">Legal</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Terms of Service</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
          These terms describe the basic rules for using BotParty, hosting robots, and participating in live shared-control sessions.
        </p>
      </div>

      {!legal.isConfigured ? (
        <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-100 text-amber-950 p-4 text-sm dark:bg-amber-500/10 dark:text-amber-100">
          Final operator details are still missing for this deployment. Configure the `NEXT_PUBLIC_LEGAL_*` variables before public launch.
        </div>
      ) : null}

      <div className="space-y-5">
        <Section title="Use of the service">
          <p>BotParty provides live robot video, queueing, chat, moderation, and remote control features. You may only use the service in ways that are lawful, safe, and consistent with the platform rules.</p>
          <p>You are responsible for activity performed through your account and for any robot you host on the platform.</p>
        </Section>

        <Section title="Safety and robot control">
          <p>Robot control is safety-sensitive. Operators must configure robots responsibly and ensure emergency stop behavior, safe physical surroundings, and hardware safeguards are in place.</p>
          <p>BotParty may restrict, suspend, or terminate access to control features if behavior appears unsafe, abusive, malicious, or technically disruptive.</p>
        </Section>

        <Section title="Accounts and hosted content">
          <p>You must provide accurate account information and keep your credentials secure. You must not impersonate others or use the service to evade moderation or access controls.</p>
          <p>If you host a robot, you are responsible for the robot metadata, stream, commands, and any chat or interactive experiences you enable.</p>
        </Section>

        <Section title="Acceptable use">
          <p>You may not use BotParty to harm people, damage property, abuse hardware, bypass queue fairness, interfere with live sessions, scrape private data, or disrupt the platform.</p>
          <p>Harassment, hate speech, spam, malicious automation, and attempts to defeat moderation or safety systems are not allowed.</p>
        </Section>

        <Section title="Availability and changes">
          <p>BotParty is a realtime platform and may change over time. Features, limits, and access rules may be updated, suspended, or removed to maintain stability, fairness, or safety.</p>
          <p>We do not guarantee uninterrupted availability, low latency, or compatibility with every robot setup or network environment.</p>
        </Section>

        <Section title="Liability and governing law">
          <p><strong className="text-[var(--foreground)]">Operator:</strong> {legal.operatorName}</p>
          <p><strong className="text-[var(--foreground)]">Governing law:</strong> {legal.governingLaw}</p>
          <p>
            Service and legal notices should be sent to{' '}
            <a className="underline" href={`mailto:${legal.operatorEmail}`}>{legal.operatorEmail}</a>.
          </p>
        </Section>
      </div>
    </div>
  );
}
