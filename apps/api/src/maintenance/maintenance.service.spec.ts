import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService retention', () => {
  it('purges or minimizes every configured content class while retaining newer rows by cutoff', async () => {
    const prisma = {
      chatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $executeRaw: jest.fn().mockResolvedValue(3),
      robotModerationEntry: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      recording: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      notification: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const service = new MaintenanceService(prisma as never, {} as never);

    await (service as unknown as { _enforceContentRetention: () => Promise<void> })._enforceContentRetention();

    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.robotModerationEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, expiresAt: { lt: expect.any(Date) } },
    }));
    expect(prisma.recording.deleteMany).toHaveBeenCalledWith({ where: { startedAt: { lt: expect.any(Date) } } });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } });
  });
});
