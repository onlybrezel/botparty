'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import type { PayoutRequestRecord } from '@/lib/api/wallet';

const STATUS_TONE: Record<PayoutRequestRecord['status'], string> = {
  PENDING: 'border-amber-500/40 text-amber-300',
  APPROVED: 'border-blue-500/40 text-blue-300',
  REJECTED: 'border-red-500/40 text-red-300',
  PAID: 'border-green-500/40 text-green-300',
};

export default function ModPayoutsPage() {
  const { accessToken, role } = useAuth();
  const [items, setItems] = useState<PayoutRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.wallet.listPayoutsForReview();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payouts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    void reload();
  }, [accessToken, reload]);

  const act = async (
    id: string,
    fn: () => Promise<PayoutRequestRecord>,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const updated = await fn();
      setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  if (!accessToken || (role !== 'ADMIN' && role !== 'MOD')) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-2xl font-semibold">Payouts</h1>
        <p className="text-[var(--muted-foreground)]">Staff only.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payouts</h1>
        <div className="flex gap-2">
          <Link
            href="/mod/billing"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
          >
            Billing events
          </Link>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-[var(--muted-foreground)]">No payout requests.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold tabular-nums">
                      {p.amount.toLocaleString()} cr
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide ${STATUS_TONE[p.status]}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {p.user ? `${p.user.username} · ${p.user.email}` : '—'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {new Date(p.createdAt).toLocaleString()} · Destination: {p.destination}
                  </p>
                  {p.notes && (
                    <p className="mt-2 rounded-md bg-[var(--muted)] px-2 py-1 text-xs">
                      {p.notes}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.status === 'PENDING' && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => act(p.id, () => api.wallet.approvePayout(p.id))}
                        className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-sm text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => {
                          const reason = window.prompt('Rejection reason (optional)') ?? undefined;
                          void act(p.id, () => api.wallet.rejectPayout(p.id, reason || undefined));
                        }}
                        className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {p.status === 'APPROVED' && (
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => act(p.id, () => api.wallet.markPayoutPaid(p.id))}
                      className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-sm text-green-300 hover:bg-green-500/20 disabled:opacity-50"
                    >
                      Mark as paid
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
