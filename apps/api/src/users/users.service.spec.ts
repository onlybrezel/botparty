import { UsersService } from './users.service';

describe('UsersService staff data minimization', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new UsersService(
    { user: { findMany } } as never,
    {} as never,
    { getPlatformUserId: () => '00000000-0000-0000-0000-00000000fee5' } as never,
    {} as never,
  );

  beforeEach(() => findMany.mockClear());

  it('does not select contact or finance fields for moderators', async () => {
    await service.listUsersForStaff({ requesterRole: 'MOD', q: 'alex' });
    const query = findMany.mock.calls[0][0];
    expect(query.select).not.toHaveProperty('email');
    expect(query.select).not.toHaveProperty('balance');
    expect(query.select).not.toHaveProperty('credits');
    expect(query.where.OR).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ email: expect.anything() }),
    ]));
  });

  it('selects administrative fields only for administrators', async () => {
    await service.listUsersForStaff({ requesterRole: 'ADMIN' });
    expect(findMany.mock.calls[0][0].select).toMatchObject({ email: true, balance: true, credits: true });
  });

  it('locks staff updates and commits profile and balance ledger changes atomically', async () => {
    const target = {
      id: 'user-1',
      username: 'user',
      email: 'user@example.test',
      role: 'USER',
      isActive: true,
      deletedAt: null,
      balance: 100,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'ADMIN', isActive: true }
            : target,
        )),
        update: jest.fn().mockResolvedValue({ ...target, displayName: 'Updated', balance: 150 }),
      },
    };
    const wallet = { adminAdjustInTransaction: jest.fn().mockResolvedValue({}) };
    const updateService = new UsersService(
      { $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as never,
      wallet as never,
      { isPlatformUser: () => false } as never,
      {} as never,
    );

    await updateService.updateUserByStaff(
      'user-1',
      { sub: 'admin-1' } as never,
      { displayName: 'Updated', balance: 150 },
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(wallet.adminAdjustInTransaction).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      delta: 50,
      reason: 'staff balance set to 150',
      requesterId: 'admin-1',
    });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: { displayName: 'Updated' },
    }));
  });

  it('rejects a staff update when the locked actor has lost the admin role', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'MOD', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: true, deletedAt: null, balance: 0 },
        )),
      },
    };
    const wallet = { adminAdjustInTransaction: jest.fn() };
    const updateService = new UsersService(
      { $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as never,
      wallet as never,
      { isPlatformUser: () => false } as never,
      {} as never,
    );

    await expect(updateService.updateUserByStaff(
      'user-1',
      { sub: 'admin-1' } as never,
      { displayName: 'Updated' },
    )).rejects.toThrow('Admin role required');
    expect(wallet.adminAdjustInTransaction).not.toHaveBeenCalled();
  });

  it('does not reactivate or modify an anonymized account', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'ADMIN', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: false, deletedAt: new Date(), balance: 0 },
        )),
      },
    };
    const updateService = new UsersService(
      { $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as never,
      {} as never,
      { isPlatformUser: () => false } as never,
      {} as never,
    );

    await expect(updateService.updateUserByStaff(
      'user-1',
      { sub: 'admin-1' } as never,
      { isActive: true },
    )).rejects.toThrow('Deleted accounts cannot be modified');
  });

  it('queues recording keys and private-media prefixes inside the account-deletion transaction', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', role: 'USER', isActive: true }),
        update: jest.fn().mockResolvedValue({}),
      },
      recording: {
        findMany: jest.fn().mockResolvedValue([
          { objectKey: 'sessions/session-1/camera-a.mp4' },
        ]),
      },
      robot: {
        findMany: jest.fn().mockResolvedValue([{ id: 'robot-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };
    const storageDeletion = {
      recordingBucket: 'botparty-recordings',
      thumbnailBucket: 'botparty-thumbnails',
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const deletionService = new UsersService(
      prisma as never,
      {} as never,
      {} as never,
      storageDeletion as never,
    );

    await deletionService.deleteOwnAccount('user-1');

    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      tx,
      'botparty-recordings',
      ['sessions/session-1/camera-a.mp4'],
    );
    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      tx,
      'botparty-thumbnails',
      ['avatars/user-1/', 'robot-thumbnails/robot-1/'],
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.robot.deleteMany).toHaveBeenCalledWith({ where: { ownerId: 'user-1' } });
  });

  it('locks and revalidates both actor and target before a staff deletion', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'ADMIN', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: true },
        )),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
      recording: { findMany: jest.fn().mockResolvedValue([]) },
      robot: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };
    const storageDeletion = {
      recordingBucket: 'botparty-recordings',
      thumbnailBucket: 'botparty-thumbnails',
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const deletionService = new UsersService(
      prisma as never,
      {} as never,
      { isPlatformUser: () => false } as never,
      storageDeletion as never,
    );

    await deletionService.deleteUserByStaff('user-1', { sub: 'admin-1' } as never);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.user.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
  });

  it('rejects a staff deletion when the locked actor no longer has the admin role', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'MOD', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: true },
        )),
      },
    };
    const deletionService = new UsersService(
      { $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)) } as never,
      {} as never,
      { isPlatformUser: () => false } as never,
      { enqueue: jest.fn() } as never,
    );

    await expect(deletionService.deleteUserByStaff('user-1', { sub: 'admin-1' } as never))
      .rejects.toThrow('Admin role required');
  });
});
