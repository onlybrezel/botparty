import { BadRequestException } from '@nestjs/common';
import { assertSafeWebhookTarget } from '../common/webhook-target';
import { RobotWebhookService } from './robot-webhook.service';

jest.mock('../common/webhook-target', () => ({
  assertSafeWebhookTarget: jest.fn(),
}));

describe('RobotWebhookService', () => {
  const robotId = '00000000-0000-4000-8000-000000000001';
  let prisma: {
    robot: { findUnique: jest.Mock };
    robotWebhook: { count: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let service: RobotWebhookService;
  let webhookQueue: { addBulk: jest.Mock };

  beforeEach(() => {
    const robotWebhook = {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([{ id: 'hook-1' }]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        ...data,
        createdAt: new Date('2026-07-18T00:00:00Z'),
      })),
    };
    prisma = {
      robot: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) },
      robotWebhook,
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((callback) => callback({
        robotWebhook,
        $queryRaw: prisma.$queryRaw,
      })),
    };
    const config = {
      get: jest.fn((key: string) => ({
        WEBHOOK_SECRET_ENCRYPTION_KEY: 'webhook-test-encryption-key-at-least-32-characters',
        MAX_WEBHOOKS_PER_ROBOT: '1',
      })[key]),
    };
    webhookQueue = { addBulk: jest.fn().mockResolvedValue([]) };
    service = new RobotWebhookService(prisma as never, config as never, webhookQueue as never);
    jest.mocked(assertSafeWebhookTarget).mockResolvedValue(new URL('https://hooks.example.test/events'));
  });

  afterEach(() => jest.restoreAllMocks());

  it('serializes the limit check and webhook insert on the robot row', async () => {
    const created = await service.createForOwner(robotId, 'owner-1', {
      url: 'https://hooks.example.test/events',
      events: ['robot.online'],
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.robotWebhook.count).toHaveBeenCalledWith({ where: { robotId } });
    expect(prisma.robotWebhook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        robotId,
        url: 'https://hooks.example.test/events',
        secret: expect.not.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(created.secret).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects at the configured limit without inserting', async () => {
    prisma.robotWebhook.count.mockResolvedValue(1);

    await expect(service.createForOwner(robotId, 'owner-1', {
      url: 'https://hooks.example.test/events',
      events: ['robot.online'],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.robotWebhook.create).not.toHaveBeenCalled();
  });

  it('uses a stable queue job id to deduplicate repeated session events', async () => {
    const event = {
      id: 'session-1',
      robotId,
      userId: 'user-1',
      startedAt: new Date('2026-07-18T00:00:00Z'),
    };

    service.emitSessionStarted(event);
    service.emitSessionStarted(event);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(webhookQueue.addBulk).toHaveBeenCalledTimes(2);
    const firstJobId = webhookQueue.addBulk.mock.calls[0][0][0].opts.jobId;
    const secondJobId = webhookQueue.addBulk.mock.calls[1][0][0].opts.jobId;
    expect(firstJobId).toMatch(/^webhook-hook-1-[a-f0-9]{64}$/);
    expect(secondJobId).toBe(firstJobId);
  });
});
