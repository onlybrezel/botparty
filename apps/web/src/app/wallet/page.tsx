'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import type {
  CreditPackage,
  PayoutRequestRecord,
  WalletSummary,
  WalletTransactionRecord,
} from '@/lib/api/wallet';

function formatCredits(value: number) {
  return value.toLocaleString();
}

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountCents / 100);
}

function txLabel(t: WalletTransactionRecord) {
  switch (t.type) {
    case 'DEPOSIT':
      return 'Credits gekauft';
    case 'BUTTON_SPEND':
      return 'Button-Druck';
    case 'BUTTON_PAYOUT':
      return 'Button-Einnahme';
    case 'DONATION_SENT':
      return 'Spende gesendet';
    case 'DONATION_RECEIVED':
      return 'Spende erhalten';
    case 'PLATFORM_FEE':
      return 'Plattform-Fee';
    case 'WITHDRAWAL':
      return 'Auszahlung';
    case 'REFUND':
      return 'Erstattung';
    case 'CHARGEBACK':
      return 'Chargeback';
    case 'ADMIN_ADJUSTMENT':
      return 'Admin-Anpassung';
    case 'REWARD':
      return 'Belohnung';
    default:
      return t.type;
  }
}

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
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [walletRes, pkgRes, payoutRes] = await Promise.all([
        api.wallet.me(),
        api.wallet.packages().catch(() => ({ packages: [] as CreditPackage[] })),
        api.wallet.myPayouts().catch(() => ({ items: [] as PayoutRequestRecord[] })),
      ]);
      setSummary(walletRes);
      setPackages(pkgRes.packages);
      setPayouts(payoutRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleBuy = useCallback(
    async (pkg: CreditPackage, provider: 'stripe' | 'paypal') => {
      setBuyingId(`${pkg.id}:${provider}`);
      try {
        const res = await api.wallet.checkout({ provider, packageId: pkg.id });
        if (res.redirectUrl) {
          window.location.href = res.redirectUrl;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kauf konnte nicht gestartet werden');
      } finally {
        setBuyingId(null);
      }
    },
    [],
  );

  const submitPayout = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const amount = Number(payoutAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Ungültiger Betrag');
        return;
      }
      setPayoutSubmitting(true);
      try {
        await api.wallet.requestPayout({
          amount,
          destination: payoutDestination,
          notes: payoutNotes || undefined,
        });
        setPayoutAmount('');
        setPayoutDestination('');
        setPayoutNotes('');
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Auszahlung konnte nicht angefordert werden');
      } finally {
        setPayoutSubmitting(false);
      }
    },
    [payoutAmount, payoutDestination, payoutNotes, reload],
  );

  if (!accessToken) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-2xl font-semibold">Wallet</h1>
        <p className="text-[var(--muted-foreground)]">Bitte melde dich an, um deine Wallet zu sehen.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Coins className="h-6 w-6 text-amber-500" />
          Wallet
        </h1>
        {summary && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Guthaben</div>
            <div className="text-3xl font-bold tabular-nums">{formatCredits(summary.balance)} cr</div>
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
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
        </div>
      ) : (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Credits kaufen</h2>
            {packages.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Aktuell sind keine Pakete verfügbar.
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
                          {pkg.bonus ? ` (+${formatCredits(pkg.bonus)} Bonus)` : ''}
                        </div>
                      </div>
                      <div className="text-lg font-semibold">
                        {formatMoney(pkg.amountCents, pkg.currency)}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="flex-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                        disabled={buyingId === `${pkg.id}:stripe`}
                        onClick={() => handleBuy(pkg, 'stripe')}
                      >
                        {buyingId === `${pkg.id}:stripe` ? 'Lädt…' : 'Mit Karte'}
                      </button>
                      <button
                        className="flex-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
                        disabled={buyingId === `${pkg.id}:paypal`}
                        onClick={() => handleBuy(pkg, 'paypal')}
                      >
                        {buyingId === `${pkg.id}:paypal` ? 'Lädt…' : 'PayPal'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Aktivität</h2>
            {summary && summary.recentTransactions.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--background)]">
                {summary.recentTransactions.map((t) => {
                  const positive = t.amount >= 0;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {positive ? (
                          <ArrowUpRight className="h-4 w-4 text-green-500" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <div>{txLabel(t)}</div>
                          {t.description && (
                            <div className="text-xs text-[var(--muted-foreground)]">{t.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`tabular-nums ${positive ? 'text-green-600' : 'text-red-600'}`}>
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
              <p className="text-sm text-[var(--muted-foreground)]">Noch keine Buchungen.</p>
            )}
          </section>

          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Auszahlung anfordern</h2>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              Auszahlungen werden manuell vom Team geprüft. Sobald sie genehmigt sind, wird der Betrag
              abgebucht und ausbezahlt.
            </p>
            <form onSubmit={submitPayout} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--muted-foreground)]">Betrag (cr)</span>
                  <input
                    type="number"
                    min={1}
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--muted-foreground)]">Zahlungsmethode</span>
                  <input
                    type="text"
                    placeholder="z. B. PayPal-E-Mail oder IBAN"
                    value={payoutDestination}
                    onChange={(e) => setPayoutDestination(e.target.value)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Notizen (optional)</span>
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
                {payoutSubmitting ? 'Wird gesendet…' : 'Anfordern'}
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
        </>
      )}
    </main>
  );
}
