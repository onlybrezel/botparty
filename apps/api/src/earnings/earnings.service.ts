import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@botparty/prisma';
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

    const perRobot = await this.prisma.$queryRaw<Array<{ robotId: string; pressEarned: number; donationEarned: number }>>(
      Prisma.sql`
        SELECT metadata->>'robotId' AS "robotId",
          COALESCE(SUM(amount) FILTER (WHERE type = 'BUTTON_PAYOUT'), 0)::int AS "pressEarned",
          COALESCE(SUM(amount) FILTER (WHERE type = 'DONATION_RECEIVED'), 0)::int AS "donationEarned"
        FROM transactions
        WHERE "userId" = ${userId}::uuid
          AND type IN ('BUTTON_PAYOUT', 'DONATION_RECEIVED')
          AND metadata->>'robotId' IS NOT NULL
        GROUP BY metadata->>'robotId'
        ORDER BY SUM(amount) DESC
      `,
    );

    return {
      lifetimeCredits: agg._sum.amount ?? 0,
      eventCount: agg._count,
      recent: recent.map((tx) => ({
        ...tx,
        createdAt: tx.createdAt.toISOString(),
        metadata: (tx.metadata as Record<string, unknown> | null) ?? null,
      })),
      perRobot,
    };
  }
}
