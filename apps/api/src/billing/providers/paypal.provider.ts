import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { BillingIntent } from '@botparty/prisma';
import type { CheckoutSession, PaymentProvider, VerifiedWebhookEvent } from './payment-provider.interface';

/**
 * Minimal PayPal Orders v2 integration. Uses the REST API directly to keep the
 * surface area small. SDK is installed in case we need richer features later.
 */
@Injectable()
export class PaypalProvider implements PaymentProvider {
  readonly name = 'paypal' as const;
  private readonly logger = new Logger(PaypalProvider.name);
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly webhookId: string | null;
  private readonly apiBase: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('PAYPAL_CLIENT_ID') ?? null;
    this.clientSecret = this.config.get<string>('PAYPAL_CLIENT_SECRET') ?? null;
    this.webhookId = this.config.get<string>('PAYPAL_WEBHOOK_ID') ?? null;
    const env = (this.config.get<string>('PAYPAL_ENV') ?? 'sandbox').toLowerCase();
    this.apiBase = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
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
    const res = await fetch(`${this.apiBase}/v1/oauth2/token`, {
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
    intent: BillingIntent;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const token = await this.getAccessToken();
    const { intent, successUrl, cancelUrl } = input;
    const amountValue = (intent.amountCents / 100).toFixed(2);
    const res = await fetch(`${this.apiBase}/v2/checkout/orders`, {
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
      const text = await res.text();
      this.logger.error(`PayPal create order failed: ${text}`);
      throw new BadRequestException('PayPal order creation failed');
    }
    const json = (await res.json()) as {
      id: string;
      links: Array<{ rel: string; href: string }>;
    };
    const approve = json.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
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
    const token = await this.getAccessToken();
    const verifyRes = await fetch(`${this.apiBase}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: this.webhookId,
        webhook_event: JSON.parse(rawBody.toString('utf8')),
      }),
    });
    const verifyJson = (await verifyRes.json()) as { verification_status: string };
    if (verifyJson.verification_status !== 'SUCCESS') {
      throw new BadRequestException('PayPal webhook signature verification failed');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      event_type: string;
      resource: Record<string, unknown>;
    };

    let type: VerifiedWebhookEvent['type'] = 'unknown';
    let intentId: string | null = null;
    let providerRef = event.id;
    let amountCents = 0;
    let currency = 'EUR';

    const resource = event.resource ?? {};
    const customId =
      (resource as { custom_id?: string }).custom_id ??
      (((resource as { purchase_units?: Array<{ custom_id?: string }> }).purchase_units ?? [])[0]?.custom_id ?? null);
    intentId = customId ?? null;

    const amountObj =
      (resource as { amount?: { value?: string; currency_code?: string } }).amount ??
      (resource as { gross_amount?: { value?: string; currency_code?: string } }).gross_amount;
    if (amountObj?.value) amountCents = Math.round(Number(amountObj.value) * 100);
    if (amountObj?.currency_code) currency = amountObj.currency_code.toUpperCase();

    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED':
      case 'PAYMENT.CAPTURE.COMPLETED':
        type = 'completed';
        break;
      case 'PAYMENT.CAPTURE.DENIED':
      case 'CHECKOUT.ORDER.VOIDED':
        type = 'failed';
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
        type = 'refunded';
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
      amountCents,
      currency,
      rawPayload: event,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _hmac(secret: string, payload: string) {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
