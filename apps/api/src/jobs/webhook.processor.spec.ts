import { WebhookProcessor } from './webhook.processor';
import { AeadCipher } from '../common/aead-cipher';

describe('WebhookProcessor', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects deliveries to unsafe targets before performing fetch', async () => {
    const encryptionKey = 'test-webhook-encryption-key-at-least-32-characters';
    const encryptedSecret = new AeadCipher(encryptionKey).encrypt(
      'webhook-signing-secret',
      'robot-webhook:hook-1',
    );
    const prisma = {
      robotWebhook: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'hook-1',
          isActive: true,
          url: 'http://127.0.0.1:8080/webhook',
          secret: encryptedSecret,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'WEBHOOK_SECRET_ENCRYPTION_KEY' ? encryptionKey : undefined,
      ),
    };

    global.fetch = jest.fn();

    const processor = new WebhookProcessor(prisma, config);

    await expect(
      processor.process({
        data: {
          hookId: 'hook-1',
          event: 'robot.online',
          payload: { robot: { id: 'robot-1' } },
        },
      }),
    ).rejects.toThrow('Webhook URL must not target loopback, private, or link-local IP ranges.');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.robotWebhook.update).toHaveBeenCalledWith({
      where: { id: 'hook-1' },
      data: { lastTriggeredAt: expect.any(Date), lastStatusCode: null },
    });
  });
});
