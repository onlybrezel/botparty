'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { AnalyticsDashboard } from '@/lib/api/analytics';
import { useAuth } from '@/lib/store';

const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;

export default function AnalyticsPage() {
  const router = useRouter();
  const { accessToken, role, hasHydrated } = useAuth();
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken || role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    let active = true;
    api.setToken(accessToken);
    void api.analytics.dashboard(30).then((dashboard) => {
      if (active) {
        setData(dashboard);
      }
    }).catch((loadError: unknown) => {
      if (active) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load product analytics.');
      }
    });
    return () => {
      active = false;
    };
  }, [accessToken, hasHydrated, role, router]);

  if (error) {
    return <div role="alert" className="mx-auto max-w-6xl px-4 py-10">{error}</div>;
  }
  if (!data) return <div className="mx-auto max-w-6xl px-4 py-10">Loading analytics...</div>;
  const cards = [
    ['Consented robot views', data.discovery.toLocaleString()],
    ['Host publish rate', percent(data.hostActivation.publishRate)],
    ['Successful turns', percent(data.turns.successRate)],
    ['Payment conversion', percent(data.monetization.conversionRate)],
    ['Paid volume', `${(data.monetization.grossAmountCents / 100).toFixed(2)} EUR`],
    ['LCP p75', data.webVitals.lcpP75Ms === null ? '—' : `${Math.round(data.webVitals.lcpP75Ms)} ms`],
    ['INP p75', data.webVitals.inpP75Ms === null ? '—' : `${Math.round(data.webVitals.inpP75Ms)} ms`],
  ];
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-black">Product analytics</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Last {data.window.days} days. User events include consented first-party activity only; funnel totals come from product records.
      </p>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="font-bold">Quality and retention</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Schema v{data.eventQuality.schemaVersion}; event retention {data.eventQuality.retainedDays} days.
          {' '}Web-vital samples: {data.webVitals.sampleCount}.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {data.eventQuality.counts.map((entry) => (
            <li key={`${entry.event}-${entry.schemaVersion}`} className="flex justify-between gap-4">
              <span>{entry.event} · v{entry.schemaVersion}</span>
              <span className="tabular-nums">{entry.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
