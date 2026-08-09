import { TransactionType } from '@botparty/prisma';
import { EarningsService } from './earnings.service';

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function build() {
  const prisma = {
    transaction: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const svc = new EarningsService(prisma);
  return {
    svc,
    prisma,
  };
}

describe('EarningsService.getOwnerSummary', () => {
  it('aggregates lifetime earnings and rolls up per-robot breakdown', async () => {
    const { svc, prisma } = build();
    const now = new Date('2025-06-01T00:00:00Z');

    prisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: 270 }, _count: 4 });

    const recent = [
      {
        id: 't1',
        type: TransactionType.BUTTON_PAYOUT,
        amount: 90,
        createdAt: now,
        metadata: { robotId: 'r1' },
      },
      {
        id: 't2',
        type: TransactionType.DONATION_RECEIVED,
        amount: 90,
        createdAt: now,
        metadata: { robotId: 'r1' },
      },
      {
        id: 't3',
        type: TransactionType.BUTTON_PAYOUT,
        amount: 45,
        createdAt: now,
        metadata: { robotId: 'r2' },
      },
      { id: 't4', type: TransactionType.BUTTON_PAYOUT, amount: 45, createdAt: now, metadata: null },
    ];
    prisma.transaction.findMany.mockResolvedValueOnce(recent);
    prisma.$queryRaw.mockResolvedValue([
      { robotId: 'r1', pressEarned: 90, donationEarned: 90 },
      { robotId: 'r2', pressEarned: 45, donationEarned: 0 },
    ]);

    const result = await svc.getOwnerSummary(userId);

    expect(result.lifetimeCredits).toBe(270);
    expect(result.eventCount).toBe(4);
    expect(result.recent).toHaveLength(4);
    const newest = result.recent[0];
    expect(newest).toBeDefined();
    if (!newest) throw new Error('Expected a recent earning');
    expect(newest.createdAt).toBe(now.toISOString());

    const r1 = result.perRobot.find((r) => r.robotId === 'r1');
    const r2 = result.perRobot.find((r) => r.robotId === 'r2');
    expect(r1).toEqual({ robotId: 'r1', pressEarned: 90, donationEarned: 90 });
    expect(r2).toEqual({ robotId: 'r2', pressEarned: 45, donationEarned: 0 });

    // Sorted by total earned desc → r1 (180) before r2 (45)
    expect(result.perRobot.map((r) => r.robotId)).toEqual(['r1', 'r2']);
  });

  it('returns empty rollup when no earnings exist', async () => {
    const { svc, prisma } = build();
    prisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await svc.getOwnerSummary(userId);
    expect(result.lifetimeCredits).toBe(0);
    expect(result.perRobot).toEqual([]);
  });
});
