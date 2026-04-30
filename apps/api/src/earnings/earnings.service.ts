import { Injectable } from '@nestjs/common';
import { TransactionType } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EarningsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns lifetime earnings (BUTTON_PAYOUT + DONATION_RECEIVED) for the user
   * along with a per-robot breakdown derived from transaction metadata.
   */
  async getOwnerSummary(userId: string) {
    const [agg, recent] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: {
          userId,
          type: { in: [TransactionType.BUTTON_PAYOUT, TransactionType.DONATION_RECEIVED] },
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: { in: [TransactionType.BUTTON_PAYOUT, TransactionType.DONATION_RECEIVED] },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          type: true,
          amount: true,
          createdAt: true,
          metadata: true,
        },
      }),
    ]);

    // Per-robot rollup (last 100 events for snappy response).
    const sample = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: { in: [TransactionType.BUTTON_PAYOUT, TransactionType.DONATION_RECEIVED] },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { amount: true, type: true, metadata: true },
    });

    const perRobot = new Map<string, { robotId: string; pressEarned: number; donationEarned: number }>();
    for (const tx of sample) {
      const robotId = (tx.metadata as { robotId?: string } | null)?.robotId;
      if (!robotId) continue;
      const entry = perRobot.get(robotId) ?? { robotId, pressEarned: 0, donationEarned: 0 };
      if (tx.type === TransactionType.BUTTON_PAYOUT) entry.pressEarned += tx.amount;
      else entry.donationEarned += tx.amount;
      perRobot.set(robotId, entry);
    }

    return {
      lifetimeCredits: agg._sum.amount ?? 0,
      eventCount: agg._count,
      recent: recent.map((tx) => ({
        ...tx,
        createdAt: tx.createdAt.toISOString(),
        metadata: (tx.metadata as Record<string, unknown> | null) ?? null,
      })),
      perRobot: Array.from(perRobot.values()).sort(
        (a, b) => b.pressEarned + b.donationEarned - (a.pressEarned + a.donationEarned),
      ),
    };
  }
}
