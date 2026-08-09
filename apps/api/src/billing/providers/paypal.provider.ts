import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CheckoutBillingIntent, CheckoutSession, PaymentProvider, VerifiedWebhookEvent } from './payment-provider.interface';
import { isRecord } from '../../common/json-value';

interface PaypalConfig {
  get(key: string): string | undefined;
}

/**
 * Minimal PayPal Orders v2 integration using the provider's REST API.
 */
@Injectable()
export class PaypalProvider implements PaymentProvider {
  readonly name = 'paypal' as const;
  readonly capabilities = { recurringCheckout: false, billingPortal: false };
  private readonly logger = new Logger(PaypalProvider.name);
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly webhookId: string | null;
  private readonly apiBase: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private cachedToken: { token: string; expiresAt: number } | null = null;
  private consecutiveTransientFailures = 0;
  private circuitOpenUntil = 0;

  constructor(@Inject(ConfigService) private readonly config: PaypalConfig) {
    this.clientId = this.config.get('PAYPAL_CLIENT_ID') ?? null;
    this.clientSecret = this.config.get('PAYPAL_CLIENT_SECRET') ?? null;
    this.webhookId = this.config.get('PAYPAL_WEBHOOK_ID') ?? null;
    const env = (this.config.get('PAYPAL_ENV') ?? 'sandbox').toLowerCase();
    this.apiBase = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    this.requestTimeoutMs = this.readBoundedInteger('PAYPAL_REQUEST_TIMEOUT_MS', 8_000, 500, 30_000);
    this.maxRetries = this.readBoundedInteger('PAYPAL_MAX_RETRIES', 2, 0, 4);
    this.retryBaseMs = this.readBoundedInteger('PAYPAL_RETRY_BASE_MS', 250, 10, 5_000);
    if (!this.clientId || !this.clientSecret) {
      this.logger.warn('PayPal disabled: PAYPAL_CLIENT_ID/SECRET not set');
    }
  }

  private isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) throw new BadRequestException('PayPal is not configured');
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.token;
    }
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.request('/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new BadRequestException('PayPal auth failed');
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      token: json.access_token,
      expiresAt: now + json.expires_in * 1000,
    };
    return json.access_token;
  }

  async createCheckout(input: {
    intent: CheckoutBillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const token = await this.getAccessToken();
    const { intent, successUrl, cancelUrl } = input;
    const amountValue = (intent.amountCents / 100).toFixed(2);
    const res = await this.request('/v2/checkout/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': intent.id,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: intent.id,
            description: `${intent.creditsAmount} BotParty credits`,
            amount: { currency_code: intent.currency, value: amountValue },
          },
        ],
        application_context: {
          return_url: successUrl,
          cancel_url: cancelUrl,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      }),
    });
    if (!res.ok) {
      this.logger.error(`PayPal create order failed with HTTP ${res.status}`);
      throw new BadRequestException('PayPal order creation failed');
    }
    const json = (await res.json()) as {
      id: string;
      links: Array<{ rel: string; href: string }>;
    };
    const approve = json.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!json.id || !approve?.href) {
      throw new BadRequestException('PayPal returned an incomplete checkout response');
    }
    return {
      intentId: intent.id,
      providerRef: json.id,
      redirectUrl: approve?.href ?? '',
    };
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<VerifiedWebhookEvent> {
    if (!this.isConfigured() || !this.webhookId) {
      throw new BadRequestException('PayPal webhook is not configured');
    }
    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('PayPal webhook payload is invalid JSON');
    }
    if (
      !isRecord(webhookEvent) ||
      typeof webhookEvent['id'] !== 'string' ||
      typeof webhookEvent['event_type'] !== 'string' ||
      !isRecord(webhookEvent['resource'])
    ) {
      throw new BadRequestException('PayPal webhook payload is invalid');
    }
    const token = await this.getAccessToken();
    const verifyRes = await this.request('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: this.webhookId,
        webhook_event: webhookEvent,
      }),
    });
    if (!verifyRes.ok) {
      throw new BadRequestException('PayPal webhook verification unavailable');
    }
    const verifyJson = (await verifyRes.json()) as { verification_status: string };
    if (verifyJson.verification_status !== 'SUCCESS') {
      throw new BadRequestException('PayPal webhook signature verification failed');
    }

    const event = {
      id: webhookEvent['id'],
      event_type: webhookEvent['event_type'],
      resource: webhookEvent['resource'],
    };
    return this.parseEvent(event);
  }

  parseStoredWebhookEvent(record: { eventId: string; eventType: string; payload: unknown }): VerifiedWebhookEvent | null {
    if (!record.payload || typeof record.payload !== 'object') {
      return null;
    }
    const payload = record.payload as {
      id?: string;
      event_type?: string;
      resource?: Record<string, unknown>;
    };
    if (!payload.id || !payload.event_type || !payload.resource) {
      return null;
    }
    return this.parseEvent(payload as { id: string; event_type: string; resource: Record<string, unknown> });
  }

  private parseEvent(event: {
    id: string;
    event_type: string;
    resource: Record<string, unknown>;
  }): VerifiedWebhookEvent {
    let type: VerifiedWebhookEvent['type'];
    let providerRef = (event.resource as { id?: string }).id ?? event.id;
    let paymentRef: string | null = null;
    let relatedProviderRef: string | null = null;
    let amountCents = 0;
    let currency = 'EUR';

    const resource = event.resource ?? {};
    const customId =
      (resource as { custom_id?: string }).custom_id ??
      (((resource as { purchase_units?: Array<{ custom_id?: string }> }).purchase_units ?? [])[0]?.custom_id ?? null);
    const intentId = customId ?? null;

    const amountObj =
      (resource as { amount?: { value?: string; currency_code?: string } }).amount ??
      (resource as { gross_amount?: { value?: string; currency_code?: string } }).gross_amount;
    if (amountObj?.value) amountCents = Math.round(Number(amountObj.value) * 100);
    if (amountObj?.currency_code) currency = amountObj.currency_code.toUpperCase();

    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED':
        type = 'approved';
        break;
      case 'PAYMENT.CAPTURE.COMPLETED':
        type = 'completed';
        paymentRef = (resource as { id?: string }).id ?? null;
        relatedProviderRef =
          (resource as { supplementary_data?: { related_ids?: { order_id?: string } } })
            .supplementary_data?.related_ids?.order_id ?? null;
        providerRef = relatedProviderRef ?? providerRef;
        break;
      case 'PAYMENT.CAPTURE.DENIED':
      case 'CHECKOUT.ORDER.VOIDED':
        type = 'failed';
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
        type = 'refunded';
        relatedProviderRef =
          (resource as { supplementary_data?: { related_ids?: { capture_id?: string } } })
            .supplementary_data?.related_ids?.capture_id ?? null;
        break;
      case 'CUSTOMER.DISPUTE.CREATED':
      case 'CUSTOMER.DISPUTE.RESOLVED':
        type = 'chargeback';
        break;
      default:
        type = 'unknown';
    }

    return {
      eventId: event.id,
      type,
      intentId,
      providerRef,
      paymentRef,
      subscriptionRef: null,
      relatedProviderRef,
      customerRef: null,
      amountCents,
      currency,
      rawPayload: event,
    };
  }

  async createSubscriptionCheckout(): Promise<never> {
    throw new BadRequestException('PayPal recurring subscriptions are not yet supported');
  }

  async createBillingPortalSession(): Promise<never> {
    throw new BadRequestException('PayPal billing portal is not yet supported');
  }

  async captureApprovedOrder(orderId: string, intentId: string): Promise<VerifiedWebhookEvent> {
    const token = await this.getAccessToken();
    const response = await this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${intentId}:capture`,
      },
      body: '{}',
    });
    if (!response.ok) {
      throw new BadRequestException('PayPal capture failed');
    }
    const payload = (await response.json()) as {
      id: string;
      purchase_units?: Array<{
        custom_id?: string;
        payments?: { captures?: Array<{ id: string; status?: string; amount?: { value?: string; currency_code?: string } }> };
      }>;
    };
    const unit = payload.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    if (!capture?.id || capture.status !== 'COMPLETED') {
      throw new BadRequestException('PayPal capture was not completed');
    }
    const amountCents = Math.round(Number(capture.amount?.value ?? Number.NaN) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !capture.amount?.currency_code) {
      throw new BadRequestException('PayPal capture returned an invalid amount');
    }
    return {
      eventId: `capture:${capture.id}`,
      type: 'completed',
      intentId: unit?.custom_id ?? intentId,
      providerRef: payload.id,
      paymentRef: capture.id,
      subscriptionRef: null,
      relatedProviderRef: payload.id,
      customerRef: null,
      amountCents,
      currency: capture.amount.currency_code.toUpperCase(),
      rawPayload: payload,
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new ServiceUnavailableException('PayPal is temporarily unavailable');
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(`${this.apiBase}${path}`, {
          ...init,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        const transient = response.status === 429 || response.status >= 500;
        if (!transient) {
          this.consecutiveTransientFailures = 0;
          return response;
        }
        lastError = new Error(`PayPal HTTP ${response.status}`);
        if (attempt === this.maxRetries) break;
        await this.waitBeforeRetry(response, attempt);
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries) break;
        await this.delay(this.retryBaseMs * (2 ** attempt));
      }
    }

    this.consecutiveTransientFailures += 1;
    if (this.consecutiveTransientFailures >= 5) {
      this.circuitOpenUntil = Date.now() + 30_000;
      this.logger.error('PayPal circuit opened for 30 seconds after repeated transient failures');
    }
    this.logger.warn(`PayPal request failed after bounded retries: ${String(lastError)}`);
    throw new ServiceUnavailableException('PayPal is temporarily unavailable');
  }

  private async waitBeforeRetry(response: Response, attempt: number) {
    const retryAfterRaw = response.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : Number.NaN;
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds * 1_000, 0), 5_000)
      : this.retryBaseMs * (2 ** attempt);
    await this.delay(retryAfterMs);
  }

  private delay(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  private readBoundedInteger(key: string, fallback: number, minimum: number, maximum: number) {
    const parsed = Number(this.config.get(key) ?? fallback);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
  }
}
