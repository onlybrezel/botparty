'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, Coins, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { CreditPackage } from '@/lib/api/wallet';
import { useAuth } from '@/lib/store';

function formatCredits(value: number) {
  return value.toLocaleString();
}

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountCents / 100);
}

export function PricingPage() {
  const { accessToken } = useAuth();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState<any[]>([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api.wallet
      .packages()
      .then((response) => {
        if (!cancelled) {
          setPackages(response.packages);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load credit packages');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/v1/billing/subscription-plans')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setSubscriptionPlans(data.plans || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubscriptionPlans([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSubscriptionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuy = useCallback(async (pkg: CreditPackage, provider: 'stripe' | 'paypal') => {
    if (!accessToken) {
      return;
    }

    setBuyingId(`${pkg.id}:${provider}`);
    setError(null);
    try {
      api.setToken(accessToken);
      const response = await api.wallet.checkout({ provider, packageId: pkg.id });
      if (response.redirectUrl) {
        window.location.href = response.redirectUrl;
      }
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not start checkout');
    } finally {
      setBuyingId(null);
    }
  }, [accessToken]);

  const handleSubscribe = useCallback(async (planId: string) => {
    if (!accessToken) {
      return;
    }

    setBuyingId(`${planId}:stripe`);
    setError(null);
    try {
      api.setToken(accessToken);
      const response = await fetch('/api/v1/billing/subscription-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          provider: 'stripe',
          planId,
          successUrl: `${window.location.origin}/wallet?status=subscription-success`,
          cancelUrl: `${window.location.origin}/wallet?status=cancelled`,
        }),
      });
      const data = await response.json();
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch (subError) {
      setError(subError instanceof Error ? subError.message : 'Could not start subscription');
    } finally {
      setBuyingId(null);
    }
  }, [accessToken]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="grid gap-8 rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-violet-300">Pricing</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">Buy credits when you need them.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)]">
            BotParty uses prepaid credits for button presses, featured placement, and creator payouts. No surprise invoices, no hidden platform bundles.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              'Stripe card checkout and PayPal are supported.',
              'Credits are added only after a verified provider webhook.',
              'Refunds and chargebacks reverse credits automatically.',
              'Payout review stays manual for operator control.',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)]/70 p-4 text-sm">
                <Check className="mt-0.5 h-4 w-4 text-emerald-300" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-violet-500/20 bg-violet-500/8 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-200">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Operator-safe billing</p>
              <p className="text-sm text-[var(--muted-foreground)]">Prepaid credits keep spend predictable across rooms, moderation tools, and payout review.</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-sm text-[var(--muted-foreground)]">
            <div className="flex items-center gap-2 text-[var(--foreground)]">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              Verified webhook settlement only
            </div>
            <p className="mt-2">
              Credits are only granted after the payment provider confirms settlement. Failed, refunded, or disputed payments stay auditable in the billing event log.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight">Credit packages</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Pick a package, then choose card or PayPal at checkout.
            </p>
          </div>
          <Link
            href={accessToken ? '/wallet' : '/login'}
            className="rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-semibold transition hover:border-[var(--primary)]"
          >
            {accessToken ? 'Open wallet' : 'Sign in to buy'}
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading packages...
          </div>
        ) : packages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] px-6 py-10 text-sm text-[var(--muted-foreground)]">
            No credit packages are configured right now.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {packages.map((pkg) => (
              <article
                key={pkg.id}
                className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">{pkg.label}</h3>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {formatCredits(pkg.credits)} credits
                      {pkg.bonus ? ` + ${formatCredits(pkg.bonus)} bonus` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xl font-black">
                    {formatMoney(pkg.amountCents, pkg.currency)}
                  </div>
                </div>

                <div className="mt-5 grid gap-2">
                  {accessToken ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleBuy(pkg, 'stripe')}
                        disabled={buyingId === `${pkg.id}:stripe` || buyingId === `${pkg.id}:paypal`}
                        className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {buyingId === `${pkg.id}:stripe` ? 'Starting Stripe...' : 'Pay with card'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBuy(pkg, 'paypal')}
                        disabled={buyingId === `${pkg.id}:stripe` || buyingId === `${pkg.id}:paypal`}
                        className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-semibold transition hover:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {buyingId === `${pkg.id}:paypal` ? 'Starting PayPal...' : 'Pay with PayPal'}
                      </button>
                    </>
                  ) : (
                    <Link
                      href="/login"
                      className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
                    >
                      Sign in to buy
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {subscriptionPlans.length > 0 && (
        <section className="mt-12">
          <div className="mb-4">
            <h2 className="text-2xl font-black tracking-tight">Monthly subscriptions</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Auto-renew every month. Cancel anytime from your account.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {subscriptionPlans.map((plan: any) => (
              <article
                key={plan.id}
                className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">{plan.label}</h3>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">{plan.description}</p>
                    <p className="mt-2 text-sm font-semibold text-emerald-300">
                      {formatCredits(plan.credits)} credits/month {plan.bonus ? `+ ${formatCredits(plan.bonus)} bonus` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xl font-black">
                    {formatMoney(plan.amountCents, plan.currency)}
                    <p className="text-sm font-normal text-[var(--muted-foreground)]">/{plan.interval}</p>
                  </div>
                </div>

                <div className="mt-5">
                  {accessToken ? (
                    <button
                      type="button"
                      onClick={() => void handleSubscribe(plan.id)}
                      disabled={buyingId === `${plan.id}:stripe`}
                      className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {buyingId === `${plan.id}:stripe` ? 'Starting Stripe...' : 'Subscribe with card'}
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="block rounded-xl bg-emerald-500 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-600"
                    >
                      Sign in to subscribe
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
