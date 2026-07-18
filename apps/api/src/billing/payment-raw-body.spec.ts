import Fastify from 'fastify';
import { installPaymentRawBodyCapture } from './payment-raw-body';

describe('payment webhook raw body capture', () => {
  it('captures exact bytes only for payment webhooks', async () => {
    const app = Fastify({ bodyLimit: 1024 * 1024 });
    installPaymentRawBodyCapture(app, 256 * 1024);
    app.post('/api/v1/billing/webhooks/stripe', async (request) => ({
      raw: (request as typeof request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? null,
    }));
    app.post('/api/v1/users/profile', async (request) => ({
      captured: 'rawBody' in request,
      body: request.body,
    }));

    const payload = '{"id":"evt_1","data":"ä"}';
    const webhook = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json()).toEqual({ raw: payload });

    const normal = await app.inject({
      method: 'POST',
      url: '/api/v1/users/profile',
      headers: { 'content-type': 'application/json' },
      payload: '{"displayName":"Pilot"}',
    });
    expect(normal.statusCode).toBe(200);
    expect(normal.json()).toEqual({ captured: false, body: { displayName: 'Pilot' } });
    await app.close();
  });

  it('rejects payment webhook bodies over the dedicated limit', async () => {
    const app = Fastify({ bodyLimit: 1024 * 1024 });
    installPaymentRawBodyCapture(app, 1024);
    app.post('/api/v1/billing/webhooks/paypal', async () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhooks/paypal',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(1025),
    });
    expect(response.statusCode).toBe(413);
    await app.close();
  });
});
