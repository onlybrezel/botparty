import type { Metadata } from 'next';
import { getLegalConfig } from '@/lib/legal';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Imprint',
  description: 'Operator and legal contact details for this BotParty deployment.',
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

export default function ImprintPage() {
  const legal = getLegalConfig();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Legal</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Imprint</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
          This page names the operator responsible for this BotParty deployment and the primary legal contact channel.
        </p>
      </div>

      {!legal.isConfigured ? (
        <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-100 text-amber-950 p-4 text-sm dark:bg-amber-500/10 dark:text-amber-100">
          This deployment has not configured final operator details yet. Set the `NEXT_PUBLIC_LEGAL_*` variables before public launch.
        </div>
      ) : null}

      <div className="space-y-5">
        <Section title="Operator">
          <p><strong className="text-[var(--foreground)]">Responsible entity:</strong> {legal.operatorName}</p>
          <p><strong className="text-[var(--foreground)]">Address:</strong> {legal.operatorAddress}</p>
          <p><strong className="text-[var(--foreground)]">Country:</strong> {legal.operatorCountry}</p>
          <p><strong className="text-[var(--foreground)]">Email:</strong> <a className="underline" href={`mailto:${legal.operatorEmail}`}>{legal.operatorEmail}</a></p>
        </Section>

        <Section title="Register information">
          <p><strong className="text-[var(--foreground)]">Commercial register:</strong> {legal.commercialRegister ?? 'Not provided for this deployment.'}</p>
          <p><strong className="text-[var(--foreground)]">VAT ID:</strong> {legal.vatId ?? 'Not provided for this deployment.'}</p>
        </Section>

        <Section title="Support and dispute contact">
          <p>
            General platform, moderation, and privacy inquiries should be sent to{' '}
            <a className="underline" href={`mailto:${legal.operatorEmail}`}>{legal.operatorEmail}</a>.
          </p>
          <p>
            Support portal:{' '}
            {legal.supportUrl ? (
              <a className="underline" href={legal.supportUrl} target="_blank" rel="noopener noreferrer">
                {legal.supportUrl}
              </a>
            ) : (
              'Not configured for this deployment.'
            )}
          </p>
        </Section>
      </div>
    </div>
  );
}
