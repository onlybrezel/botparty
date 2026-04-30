import { WebhookProcessor } from './webhook.processor';

describe('WebhookProcessor', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects deliveries to unsafe targets before performing fetch', async () => {
    const prisma = {
      robotWebhook: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'hook-1',
          isActive: true,
          url: 'http://127.0.0.1:8080/webhook',
          secret: 'a'.repeat(64),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    };

    global.fetch = jest.fn();

    const processor = new WebhookProcessor(prisma as never, config as never);

    await expect(
      processor.process({
        data: {
          hookId: 'hook-1',
          event: 'robot.online',
          payload: { robot: { id: 'robot-1' } },
        },
      } as never),
    ).rejects.toThrow('Webhook URL must not target loopback, private, or link-local IP ranges.');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.robotWebhook.update).toHaveBeenCalledWith({
      where: { id: 'hook-1' },
      data: { lastTriggeredAt: expect.any(Date), lastStatusCode: null },
    });
  });
});
