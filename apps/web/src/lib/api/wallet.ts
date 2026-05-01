import type { RequestFn } from './types';

export interface WalletTransactionRecord {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface WalletSummary {
  balance: number;
  recentTransactions: WalletTransactionRecord[];
}

export interface CreditPackage {
  id: string;
  label: string;
  credits: number;
  amountCents: number;
  currency: string;
  bonus?: number;
}

export interface CheckoutResponse {
  intentId: string;
  provider: 'stripe' | 'paypal';
  redirectUrl: string;
}

export interface PayoutRequestRecord {
  id: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  destination: string;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  user?: { id: string; username: string; email: string };
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

  transactions(opts: { cursor?: string; limit?: number; type?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set('cursor', opts.cursor);
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.type) qs.set('type', opts.type);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.req<{ items: WalletTransactionRecord[]; nextCursor: string | null }>(
      `/wallet/transactions${suffix}`,
    );
  }

  donate(input: { robotId: string; amount: number; message?: string }, idempotencyKey?: string) {
    return this.req<{ ledgerGroupId: string; balance: number }>('/wallet/donations', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  packages() {
    return this.req<{ packages: CreditPackage[] }>('/billing/packages');
  }

  checkout(input: { provider: 'stripe' | 'paypal'; packageId: string }) {
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

  requestPayout(input: { amount: number; destination: string; notes?: string }) {
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

  markPayoutPaid(id: string) {
    return this.req<PayoutRequestRecord>(`/payouts/${id}/mark-paid`, { method: 'POST' });
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
