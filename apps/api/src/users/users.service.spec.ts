import { UsersService } from './users.service';
import { Role } from '@botparty/shared';

const adminActor = {
  sub: 'admin-1',
  username: 'admin',
  role: Role.ADMIN,
  tokenVersion: 0,
};

function createTransaction() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    robot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    recording: { findMany: jest.fn().mockResolvedValue([]) },
    storageDeletionTask: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

function createDatabase(transaction = createTransaction()) {
  const findMany = jest.fn().mockResolvedValue([]);
  return {
    $transaction<T>(callback: (client: typeof transaction) => Promise<T>): Promise<T> {
      return callback(transaction);
    },
    adminAuditLog: { findMany },
    analyticsEvent: { findMany },
    billingIntent: { findMany },
    chatMessage: { findMany },
    payoutRequest: { findMany },
    queueEntry: { findMany },
    recording: { findMany },
    robot: { findMany },
    robotModerationEntry: { findMany },
    session: { findMany, groupBy: jest.fn().mockResolvedValue([]) },
    transaction: { findMany, groupBy: jest.fn().mockResolvedValue([]) },
    user: {
      findMany,
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('UsersService staff data minimization', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const database = createDatabase();
  database.user.findMany = findMany;
  const service = new UsersService(
    database,
    { adminAdjustInTransaction: jest.fn() },
    { getPlatformUserId: () => '00000000-0000-0000-0000-00000000fee5', isPlatformUser: () => false },
    { recordingBucket: '', thumbnailBucket: '', enqueue: jest.fn() },
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
    const tx = createTransaction();
    tx.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'ADMIN', isActive: true }
            : target,
        ));
    tx.user.update.mockResolvedValue({ ...target, displayName: 'Updated', balance: 150 });
    const wallet = { adminAdjustInTransaction: jest.fn().mockResolvedValue({}) };
    const updateService = new UsersService(
      createDatabase(tx),
      wallet,
      { isPlatformUser: () => false, getPlatformUserId: () => 'platform' },
      { recordingBucket: '', thumbnailBucket: '', enqueue: jest.fn() },
    );

    await updateService.updateUserByStaff(
      'user-1',
      adminActor,
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
    const tx = createTransaction();
    tx.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'MOD', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: true, deletedAt: null, balance: 0 },
        ));
    const wallet = { adminAdjustInTransaction: jest.fn() };
    const updateService = new UsersService(
      createDatabase(tx),
      wallet,
      { isPlatformUser: () => false, getPlatformUserId: () => 'platform' },
      { recordingBucket: '', thumbnailBucket: '', enqueue: jest.fn() },
    );

    await expect(updateService.updateUserByStaff(
      'user-1',
      adminActor,
      { displayName: 'Updated' },
    )).rejects.toThrow('Admin role required');
    expect(wallet.adminAdjustInTransaction).not.toHaveBeenCalled();
  });

  it('does not reactivate or modify an anonymized account', async () => {
    const tx = createTransaction();
    tx.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'ADMIN', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: false, deletedAt: new Date(), balance: 0 },
        ));
    const updateService = new UsersService(
      createDatabase(tx),
      { adminAdjustInTransaction: jest.fn() },
      { isPlatformUser: () => false, getPlatformUserId: () => 'platform' },
      { recordingBucket: '', thumbnailBucket: '', enqueue: jest.fn() },
    );

    await expect(updateService.updateUserByStaff(
      'user-1',
      adminActor,
      { isActive: true },
    )).rejects.toThrow('Deleted accounts cannot be modified');
  });

  it('queues recording keys and private-media prefixes inside the account-deletion transaction', async () => {
    const tx = createTransaction();
    tx.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'USER', isActive: true });
    tx.recording.findMany.mockResolvedValue([
          { objectKey: 'sessions/session-1/camera-a.mp4' },
        ]);
    tx.robot.findMany.mockResolvedValue([{ id: 'robot-1' }]);
    tx.robot.deleteMany.mockResolvedValue({ count: 1 });
    const storageDeletion = {
      recordingBucket: 'botparty-recordings',
      thumbnailBucket: 'botparty-thumbnails',
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const deletionService = new UsersService(
      createDatabase(tx),
      { adminAdjustInTransaction: jest.fn() },
      { isPlatformUser: () => false, getPlatformUserId: () => 'platform' },
      storageDeletion,
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
    const tx = createTransaction();
    tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'ADMIN', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: true },
        ));
    const storageDeletion = {
      recordingBucket: 'botparty-recordings',
      thumbnailBucket: 'botparty-thumbnails',
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const deletionService = new UsersService(
      createDatabase(tx),
      { adminAdjustInTransaction: jest.fn() },
      { isPlatformUser: () => false, getPlatformUserId: () => 'platform' },
      storageDeletion,
    );

    await deletionService.deleteUserByStaff('user-1', adminActor);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.user.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
  });

  it('rejects a staff deletion when the locked actor no longer has the admin role', async () => {
    const tx = createTransaction();
    tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
          where.id === 'admin-1'
            ? { id: 'admin-1', role: 'MOD', isActive: true }
            : { id: 'user-1', role: 'USER', isActive: true },
        ));
    const deletionService = new UsersService(
      createDatabase(tx),
      { adminAdjustInTransaction: jest.fn() },
      { isPlatformUser: () => false, getPlatformUserId: () => 'platform' },
      { enqueue: jest.fn(), recordingBucket: '', thumbnailBucket: '' },
    );

    await expect(deletionService.deleteUserByStaff('user-1', adminActor))
      .rejects.toThrow('Admin role required');
  });
});
