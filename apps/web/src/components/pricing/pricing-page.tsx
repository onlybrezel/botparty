'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Coins, Loader2, ShieldCheck } from 'lucide-react';
import { LEGAL_POLICY_VERSIONS } from '@botparty/shared';
import { api } from '@/lib/api';
import type { CreditPackage } from '@/lib/api/wallet';
import { releaseFeatures } from '@/lib/release-features';
import { useAuth } from '@/lib/store';

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountCents / 100);
}

export function PricingPage() {
  const { accessToken } = useAuth();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(releaseFeatures.billing);
  const [error, setError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [deliveryConsent, setDeliveryConsent] = useState(false);

  useEffect(() => {
    if (!releaseFeatures.billing) return;
    let cancelled = false;
    api.wallet.packages()
      .then((response) => {
        if (!cancelled) setPackages(response.packages);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load credit packages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuy = useCallback(async (creditPackage: CreditPackage, provider: 'stripe' | 'paypal') => {
    if (!accessToken || !deliveryConsent) return;
    setBuyingId(`${creditPackage.id}:${provider}`);
    setError(null);
    try {
      api.setToken(accessToken);
      const response = await api.wallet.checkout({
        provider,
        packageId: creditPackage.id,
        termsVersion: LEGAL_POLICY_VERSIONS.TERMS,
        immediateDeliveryConsent: true,
      });
      window.location.assign(response.redirectUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start checkout');
    } finally {
      setBuyingId(null);
    }
  }, [accessToken, deliveryConsent]);

  if (!releaseFeatures.billing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-3 text-[var(--muted-foreground)]">Credit purchases are not available on this deployment.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Coins className="h-6 w-6 text-[var(--primary)]" />
            Prepaid credits
          </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
              Credits are added after the payment provider confirms settlement. Available methods appear below.
            </p>
        </div>
        <div className="mt-4 flex items-start gap-2 text-sm text-[var(--muted-foreground)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          Purchases, refunds and disputes remain linked to the wallet ledger.
        </div>
      </header>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold tracking-tight">Credit packages</h2>
          <Link href={accessToken ? '/wallet' : '/login'} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold">
            {accessToken ? 'Open wallet' : 'Sign in'}
          </Link>
        </div>
        {error ? <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" />Loading packages…</p>
        ) : packages.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted-foreground)]">No credit packages are available.</p>
        ) : (
          <>
            {accessToken ? (
              <label className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--border)] p-4 text-sm">
                <input type="checkbox" className="mt-1" checked={deliveryConsent} onChange={(event) => setDeliveryConsent(event.target.checked)} />
                <span>I request immediate delivery of the digital credits and acknowledge the <Link className="underline" href="/terms">Terms of Service</Link>.</span>
              </label>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-3">
              {packages.map((creditPackage) => (
                <article key={creditPackage.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div><h3 className="font-bold">{creditPackage.label}</h3><p className="text-sm text-[var(--muted-foreground)]">{creditPackage.credits.toLocaleString('en-US')} credits</p></div>
                    <strong>{formatMoney(creditPackage.amountCents, creditPackage.currency)}</strong>
                  </div>
                  {accessToken ? (
                    <div className="mt-5 grid gap-2">
                      {(['stripe', 'paypal'] as const).map((provider) => (
                        <button key={provider} type="button" disabled={!deliveryConsent || buyingId !== null} onClick={() => void handleBuy(creditPackage, provider)} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
                          {buyingId === `${creditPackage.id}:${provider}` ? 'Opening checkout…' : provider === 'stripe' ? 'Pay by card' : 'Pay with PayPal'}
                        </button>
                      ))}
                    </div>
                  ) : <Link href="/login" className="mt-5 block rounded-lg bg-[var(--primary)] px-4 py-2.5 text-center text-sm font-semibold text-white">Sign in to buy</Link>}
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
