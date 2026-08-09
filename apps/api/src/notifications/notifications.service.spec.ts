import { NotificationsService } from './notifications.service';

const preference = {
  inAppEnabled: true,
  browserEnabled: true,
  emailTurn: true,
  emailRobot: true,
  emailFinance: true,
  quietStartMin: null,
  quietEndMin: null,
  timezone: 'UTC',
};

function build() {
  const prisma = {
    user: { findUnique: jest.fn() },
    notification: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    notificationPreference: {
      upsert: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };
  const mail = { isEnabled: jest.fn().mockReturnValue(true), sendRaw: jest.fn() };
  return { service: new NotificationsService(prisma, mail), prisma, mail };
}

describe('NotificationsService', () => {
  it('stores a channel-aware outbox row and rejects external action URLs', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com', emailVerified: true, isActive: true, notificationPreference: preference,
    });
    prisma.notification.create.mockImplementation(async ({ data }) => ({ id: 'notification-1', ...data }));

    const result = await service.publish({
      userId: 'user-1', kind: 'TURN_NOW', category: 'TURN', title: ' Your turn ', body: ' Ready ',
      actionUrl: 'https://tracker.example/turn', dedupeKey: 'turn:session-1:now',
    });

    expect(result).toEqual(expect.objectContaining({
      browserRequested: true, emailRequested: true, emailStatus: 'PENDING', actionUrl: null,
    }));
  });

  it('returns the original notification after a concurrent duplicate insert', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com', emailVerified: true, isActive: true, notificationPreference: preference,
    });
    prisma.notification.create.mockRejectedValue({ code: 'P2002' });
    prisma.notification.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(service.publish({
      userId: 'user-1', kind: 'PAYMENT_FINAL', category: 'FINANCE', title: 'Paid', body: 'Complete', dedupeKey: 'payment:intent-1:paid',
    })).resolves.toEqual({ id: 'existing' });
  });

  it('returns preferences created by a concurrent first request', async () => {
    const { service, prisma } = build();
    prisma.notificationPreference.upsert.mockRejectedValue({ code: 'P2002' });
    prisma.notificationPreference.findUniqueOrThrow.mockResolvedValue(preference);

    await expect(service.getPreferences('user-1')).resolves.toEqual(preference);
    expect(prisma.notificationPreference.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('applies preference updates after a concurrent first insert', async () => {
    const { service, prisma } = build();
    prisma.notificationPreference.upsert.mockRejectedValue({ code: 'P2002' });
    prisma.notificationPreference.update.mockResolvedValue({ ...preference, inAppEnabled: false });

    await expect(
      service.updatePreferences('user-1', { inAppEnabled: false }),
    ).resolves.toEqual({ ...preference, inAppEnabled: false });
    expect(prisma.notificationPreference.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { inAppEnabled: false },
    });
  });

  it('claims and delivers a pending email with a deterministic message id', async () => {
    const { service, prisma, mail } = build();
    prisma.notification.findMany.mockResolvedValue([{
      id: 'notification-1', title: '<Paid>', body: 'Credits & receipt', actionUrl: '/wallet',
      emailAttempts: 0, user: { email: 'user@example.com', emailVerified: true, isActive: true },
    }]);
    prisma.notification.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.notification.update.mockResolvedValue({});

    await service.deliverPendingEmails();

    expect(mail.sendRaw).toHaveBeenCalledWith(
      'user@example.com', '<Paid>', expect.stringContaining('&lt;Paid&gt;'), expect.any(String), undefined,
      '<notification-notification-1@botparty.live>',
    );
    expect(prisma.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ emailStatus: 'DELIVERED' }),
    }));
  });
});
