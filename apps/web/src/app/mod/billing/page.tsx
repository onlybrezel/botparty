'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import type { BillingWebhookEventRecord } from '@/lib/api/wallet';
import { useAuth } from '@/lib/store';

function formatMoney(amountCents: number, currency: string | null) {
  if (!currency) {
    return amountCents > 0 ? `${(amountCents / 100).toFixed(2)}` : 'n/a';
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountCents / 100);
}

export default function ModBillingPage() {
  const { accessToken, role } = useAuth();
  const [items, setItems] = useState<BillingWebhookEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.wallet.listBillingWebhookEvents();
      setItems(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load billing webhook events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    void reload();
  }, [accessToken, reload]);

  const replay = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.wallet.replayBillingWebhookEvent(id);
      await reload();
    } catch (replayError) {
      setError(replayError instanceof Error ? replayError.message : 'Replay failed');
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  if (!accessToken || (role !== 'ADMIN' && role !== 'MOD')) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-2xl font-semibold">Billing events</h1>
        <p className="mt-2 text-[var(--muted-foreground)]">Staff only.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing events</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Inspect verified webhook events and replay them after provider-side fixes or intent backfills.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/mod/payouts"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
          >
            Payout review
          </Link>
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : items.length === 0 ? (
        <p className="text-[var(--muted-foreground)]">No webhook events recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs uppercase tracking-wide">
                      {item.provider}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs uppercase tracking-wide">
                      {item.eventType}
                    </span>
                    {item.intentId ? (
                      <span className="text-xs text-[var(--muted-foreground)]">intent {item.intentId}</span>
                    ) : null}
                  </div>

                  <div className="text-sm">
                    <p className="font-medium">{item.eventId}</p>
                    <p className="text-[var(--muted-foreground)]">
                      {new Date(item.processedAt).toLocaleString()} · {formatMoney(item.amountCents, item.currency)}
                    </p>
                    {item.providerRef ? (
                      <p className="text-xs text-[var(--muted-foreground)]">provider ref: {item.providerRef}</p>
                    ) : null}
                  </div>

                  {item.payload ? (
                    <details className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted-foreground)]">
                      <summary className="cursor-pointer font-medium text-[var(--foreground)]">Payload</summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(item.payload, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void replay(item.id)}
                  disabled={busyId === item.id}
                  className="inline-flex items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-sm text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  {busyId === item.id ? 'Replaying...' : 'Replay'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
