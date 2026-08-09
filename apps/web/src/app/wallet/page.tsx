'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, ArrowUpRight, ArrowDownRight, Download, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import type {
  CreditPackage,
  PayoutRequestRecord,
  WalletSummary,
  WalletTransactionRecord,
} from '@/lib/api/wallet';
import { LEGAL_POLICY_VERSIONS } from '@botparty/shared';
import { releaseFeatures } from '@/lib/release-features';
import {
  buildWalletExportContent,
  buildWalletHistoryFilters,
  formatCredits,
  formatMoney,
  transactionLabel,
  TRANSACTION_TYPES,
} from './wallet-page.helpers';

export default function WalletPage() {
  const { accessToken } = useAuth();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutDestination, setPayoutDestination] = useState('');
  const [payoutDestinationType, setPayoutDestinationType] = useState<'PAYPAL_EMAIL' | 'IBAN'>(
    'PAYPAL_EMAIL',
  );
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [deliveryConsent, setDeliveryConsent] = useState(false);
  const [history, setHistory] = useState<WalletTransactionRecord[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyType, setHistoryType] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyRobotId, setHistoryRobotId] = useState('');
  const [historyExporting, setHistoryExporting] = useState(false);

  const historyFilters = useCallback(
    () =>
      buildWalletHistoryFilters({
        type: historyType,
        from: historyFrom,
        to: historyTo,
        robotId: historyRobotId,
      }),
    [historyFrom, historyRobotId, historyTo, historyType],
  );

  const loadHistory = useCallback(
    async (cursor?: string) => {
      if (!accessToken) return;
      setHistoryLoading(true);
      try {
        api.setToken(accessToken);
        const page = await api.wallet.transactions({
          ...historyFilters(),
          ...(cursor ? { cursor } : {}),
          limit: 50,
        });
        setHistory((current) =>
          cursor
            ? [
                ...current,
                ...page.items.filter((item) => !current.some((entry) => entry.id === item.id)),
              ]
            : page.items,
        );
        setHistoryCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Wallet history could not be loaded');
      } finally {
        setHistoryLoading(false);
      }
    },
    [accessToken, historyFilters],
  );

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const exportHistory = useCallback(
    async (format: 'csv' | 'json') => {
      if (!accessToken) return;
      setHistoryExporting(true);
      try {
        api.setToken(accessToken);
        const exported = await api.wallet.exportTransactions(historyFilters());
        const content = buildWalletExportContent(exported.items, format, exported.exportedAt);
        const blob = new Blob([content], {
          type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `botparty-wallet-${new Date().toISOString().slice(0, 10)}.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Wallet export failed');
      } finally {
        setHistoryExporting(false);
      }
    },
    [accessToken, historyFilters],
  );

  const reload = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [walletRes, pkgRes, payoutRes] = await Promise.all([
        api.wallet.me(),
        releaseFeatures.billing
          ? api.wallet.packages().catch(() => ({ packages: [] as CreditPackage[] }))
          : Promise.resolve({ packages: [] as CreditPackage[] }),
        releaseFeatures.payouts
          ? api.wallet.myPayouts().catch(() => ({ items: [] as PayoutRequestRecord[] }))
          : Promise.resolve({ items: [] as PayoutRequestRecord[] }),
      ]);
      setSummary(walletRes);
      setPackages(pkgRes.packages);
      setPayouts(payoutRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleBuy = useCallback(
    async (pkg: CreditPackage, provider: 'stripe' | 'paypal') => {
      if (!deliveryConsent) return;
      setBuyingId(`${pkg.id}:${provider}`);
      try {
        const res = await api.wallet.checkout({
          provider,
          packageId: pkg.id,
          termsVersion: LEGAL_POLICY_VERSIONS.TERMS,
          immediateDeliveryConsent: true,
        });
        if (res.redirectUrl) {
          window.location.href = res.redirectUrl;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start checkout');
      } finally {
        setBuyingId(null);
      }
    },
    [deliveryConsent],
  );

  const submitPayout = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const amount = Number(payoutAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Invalid amount');
        return;
      }
      setPayoutSubmitting(true);
      try {
        await api.wallet.requestPayout({
          amount,
          destination: payoutDestination,
          destinationType: payoutDestinationType,
          ...(payoutNotes ? { notes: payoutNotes } : {}),
        });
        setPayoutAmount('');
        setPayoutDestination('');
        setPayoutNotes('');
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not request payout');
      } finally {
        setPayoutSubmitting(false);
      }
    },
    [payoutAmount, payoutDestination, payoutDestinationType, payoutNotes, reload],
  );

  if (!accessToken) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-2xl font-semibold">Wallet</h1>
        <p className="text-[var(--muted-foreground)]">Please sign in to view your wallet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Coins className="h-6 w-6 text-amber-500" />
          Wallet
        </h1>
        {summary && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Balance
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {formatCredits(summary.balance)} cr
            </div>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}

      {loading && !summary ? (
        <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {releaseFeatures.billing ? (
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold">Buy credits</h2>
              <label className="mb-3 flex items-start gap-2 text-sm text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={deliveryConsent}
                  onChange={(event) => setDeliveryConsent(event.target.checked)}
                />
                <span>
                  I request immediate delivery of the digital credits and accept the current Terms
                  of Service.
                </span>
              </label>
              {packages.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  No packages are currently available.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {packages.map((pkg) => (
                    <div
                      key={pkg.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4"
                    >
                      <div className="flex items-baseline justify-between">
                        <div>
                          <div className="font-medium">{pkg.label}</div>
                          <div className="text-sm text-[var(--muted-foreground)]">
                            {formatCredits(pkg.credits)} cr
                            {pkg.bonus ? ` (+${formatCredits(pkg.bonus)} bonus)` : ''}
                          </div>
                        </div>
                        <div className="text-lg font-semibold">
                          {formatMoney(pkg.amountCents, pkg.currency)}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          className="flex-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                          disabled={!deliveryConsent || buyingId !== null}
                          onClick={() => handleBuy(pkg, 'stripe')}
                        >
                          {buyingId === `${pkg.id}:stripe` ? 'Loading…' : 'Card'}
                        </button>
                        <button
                          className="flex-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                          disabled={!deliveryConsent || buyingId !== null}
                          onClick={() => handleBuy(pkg, 'paypal')}
                        >
                          {buyingId === `${pkg.id}:paypal` ? 'Loading…' : 'PayPal'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Activity</h2>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select
                value={historyType}
                onChange={(event) => setHistoryType(event.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                aria-label="Transaction type"
              >
                <option value="">All transaction types</option>
                {TRANSACTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {transactionLabel({ type })}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={historyFrom}
                onChange={(event) => setHistoryFrom(event.target.value)}
                aria-label="Transactions from"
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={historyTo}
                onChange={(event) => setHistoryTo(event.target.value)}
                aria-label="Transactions through"
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <input
                value={historyRobotId}
                onChange={(event) => setHistoryRobotId(event.target.value)}
                placeholder="Robot ID"
                aria-label="Robot ID filter"
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={historyExporting}
                onClick={() => void exportHistory('csv')}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> CSV
              </button>
              <button
                type="button"
                disabled={historyExporting}
                onClick={() => void exportHistory('json')}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> JSON
              </button>
            </div>
            {history.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--background)]">
                {history.map((t) => {
                  const positive = t.amount >= 0;
                  return (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        {positive ? (
                          <ArrowUpRight className="h-4 w-4 text-green-500" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <div>{transactionLabel(t)}</div>
                          {t.description && (
                            <div className="text-xs text-[var(--muted-foreground)]">
                              {t.description}
                            </div>
                          )}
                          <div className="text-xs text-[var(--muted-foreground)]">
                            {t.type === 'REFUND' || t.type === 'CHARGEBACK' ? 'Reversed' : 'Final'}{' '}
                            · Ref {t.reconciliationId ?? t.id}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`tabular-nums ${positive ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {positive ? '+' : ''}
                          {formatCredits(t.amount)} cr
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {new Date(t.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                {historyLoading ? 'Loading activity...' : 'No matching activity.'}
              </p>
            )}
            {historyCursor ? (
              <button
                type="button"
                disabled={historyLoading}
                onClick={() => void loadHistory(historyCursor)}
                className="mt-3 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50"
              >
                {historyLoading ? 'Loading...' : 'Load more'}
              </button>
            ) : null}
          </section>

          {releaseFeatures.payouts ? (
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold">Request payout</h2>
              <p className="mb-3 text-sm text-[var(--muted-foreground)]">
                Payouts are reviewed manually by the team. Once approved, the credits will be
                deducted and paid out.
              </p>
              <form onSubmit={submitPayout} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--muted-foreground)]">Amount (cr)</span>
                    <input
                      type="number"
                      min={1}
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-[var(--muted-foreground)]">Payout method</span>
                    <select
                      value={payoutDestinationType}
                      onChange={(event) =>
                        setPayoutDestinationType(event.target.value as 'PAYPAL_EMAIL' | 'IBAN')
                      }
                      className="mb-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                    >
                      <option value="PAYPAL_EMAIL">PayPal email</option>
                      <option value="IBAN">IBAN</option>
                    </select>
                    <input
                      type={payoutDestinationType === 'PAYPAL_EMAIL' ? 'email' : 'text'}
                      placeholder={
                        payoutDestinationType === 'PAYPAL_EMAIL' ? 'name@example.com' : 'DE…'
                      }
                      value={payoutDestination}
                      onChange={(e) => setPayoutDestination(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--muted-foreground)]">
                    Notes (optional)
                  </span>
                  <textarea
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  disabled={payoutSubmitting || !payoutAmount || !payoutDestination}
                  className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {payoutSubmitting ? 'Sending…' : 'Request'}
                </button>
              </form>

              {payouts.length > 0 && (
                <ul className="mt-5 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm">
                  {payouts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div>
                        <div className="tabular-nums">{formatCredits(p.amount)} cr</div>
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {new Date(p.createdAt).toLocaleString()} · {p.destination}
                        </div>
                      </div>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs uppercase tracking-wide">
                        {p.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
