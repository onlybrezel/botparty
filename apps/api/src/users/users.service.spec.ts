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
});
