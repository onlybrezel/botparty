import type {
  CheckoutResponse,
  CreditPackage,
  WalletSummary,
  WalletTransactionRecord,
} from '@botparty/shared';
import type { RequestFn } from './types';

export type { CheckoutResponse, CreditPackage, WalletSummary, WalletTransactionRecord } from '@botparty/shared';

export interface PayoutRequestRecord {
  id: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  destination: string;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  user?: { id: string; username: string };
}

export interface BillingWebhookEventRecord {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  intentId: string | null;
  providerRef: string | null;
  amountCents: number;
  currency: string | null;
  processedAt: string;
  payload: Record<string, unknown> | null;
}

export interface EarningsSummary {
  lifetimeCredits: number;
  eventCount: number;
  recent: WalletTransactionRecord[];
  perRobot: Array<{ robotId: string; pressEarned: number; donationEarned: number }>;
}

export class WalletApi {
  constructor(private readonly req: RequestFn) {}

  me() {
    return this.req<WalletSummary>('/wallet/me');
  }

  transactions(opts: { cursor?: string; limit?: number; type?: string; from?: string; to?: string; robotId?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set('cursor', opts.cursor);
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.type) qs.set('type', opts.type);
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.robotId) qs.set('robotId', opts.robotId);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.req<{ items: WalletTransactionRecord[]; nextCursor: string | null }>(
      `/wallet/transactions${suffix}`,
    );
  }

  exportTransactions(opts: { type?: string; from?: string; to?: string; robotId?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.type) qs.set('type', opts.type);
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.robotId) qs.set('robotId', opts.robotId);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.req<{ exportedAt: string; items: WalletTransactionRecord[] }>(
      `/wallet/transactions/export${suffix}`,
    );
  }

  donate(input: { robotId: string; amount: number; message?: string }, idempotencyKey?: string) {
    return this.req<{ ledgerGroupId: string; balance: number }>('/wallet/donations', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    });
  }

  packages() {
    return this.req<{ packages: CreditPackage[] }>('/billing/packages');
  }

  checkout(input: { provider: 'stripe' | 'paypal'; packageId: string; termsVersion: '2026-07-17'; immediateDeliveryConsent: true }) {
    return this.req<CheckoutResponse>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  earnings() {
    return this.req<EarningsSummary>('/earnings/me');
  }

  myPayouts() {
    return this.req<{ items: PayoutRequestRecord[] }>('/payouts');
  }

  requestPayout(input: { amount: number; destination: string; destinationType: 'PAYPAL_EMAIL' | 'IBAN'; notes?: string }) {
    return this.req<PayoutRequestRecord>('/payouts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  listPayoutsForReview() {
    return this.req<{ items: PayoutRequestRecord[] }>('/payouts/review');
  }

  approvePayout(id: string) {
    return this.req<PayoutRequestRecord>(`/payouts/${id}/approve`, { method: 'POST' });
  }

  rejectPayout(id: string, reason?: string) {
    return this.req<PayoutRequestRecord>(`/payouts/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  markPayoutPaid(id: string, providerRef: string) {
    return this.req<PayoutRequestRecord>(`/payouts/${id}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ providerRef }),
    });
  }

  revealPayoutDestination(id: string) {
    return this.req<{ destinationType: 'PAYPAL_EMAIL' | 'IBAN'; destination: string }>(
      `/payouts/${id}/destination`,
    );
  }

  listBillingWebhookEvents() {
    return this.req<{ items: BillingWebhookEventRecord[] }>('/billing/admin/webhook-events');
  }

  replayBillingWebhookEvent(id: string) {
    return this.req<{ status: string }>(`/billing/admin/webhook-events/${id}/replay`, {
      method: 'POST',
      body: '{}',
    });
  }
}
