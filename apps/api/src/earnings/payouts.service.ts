import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayoutRequestStatus, TransactionType } from '@botparty/prisma';
import { LIMITS } from '@botparty/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async createRequest(input: { userId: string; amount: number; destination: string; notes?: string }) {
    if (
      input.amount < LIMITS.MIN_PAYOUT_REQUEST_CREDITS ||
      input.amount > LIMITS.MAX_PAYOUT_REQUEST_CREDITS
    ) {
      throw new BadRequestException('Payout amount out of allowed range');
    }
    const balance = await this.wallet.getBalance(input.userId);
    if (balance < input.amount) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient balance for payout',
        balance,
      });
    }

    const pending = await this.prisma.payoutRequest.findFirst({
      where: {
        userId: input.userId,
        status: { in: [PayoutRequestStatus.PENDING, PayoutRequestStatus.APPROVED] },
      },
    });
    if (pending) {
      throw new BadRequestException('You already have an open payout request');
    }

    return this.prisma.payoutRequest.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        destination: input.destination.slice(0, 128),
        notes: input.notes?.slice(0, 1000) ?? null,
        status: PayoutRequestStatus.PENDING,
      },
    });
  }

  async listForUser(userId: string) {
    return this.prisma.payoutRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async listForReview() {
    return this.prisma.payoutRequest.findMany({
      where: { status: PayoutRequestStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, username: true, email: true } } },
    });
  }

  async approve(id: string, reviewerId: string) {
    return this.transition(id, reviewerId, PayoutRequestStatus.APPROVED);
  }

  async reject(id: string, reviewerId: string, reason: string) {
    return this.transition(id, reviewerId, PayoutRequestStatus.REJECTED, reason);
  }

  /** Marks the payout as paid and debits the creator's wallet. */
  async markPaid(id: string, reviewerId: string) {
    const req = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Payout request not found');
    if (req.status !== PayoutRequestStatus.APPROVED) {
      throw new ForbiddenException('Only approved requests can be marked paid');
    }

    await this.wallet.debit(req.userId, req.amount, TransactionType.WITHDRAWAL, {
      description: `Payout ${req.id}`,
      metadata: { payoutRequestId: req.id, reviewerId },
    });

    return this.prisma.payoutRequest.update({
      where: { id },
      data: {
        status: PayoutRequestStatus.PAID,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  private async transition(
    id: string,
    reviewerId: string,
    target: PayoutRequestStatus,
    notes?: string,
  ) {
    const req = await this.prisma.payoutRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Payout request not found');
    if (req.status !== PayoutRequestStatus.PENDING && target !== PayoutRequestStatus.REJECTED) {
      throw new ForbiddenException('Request is not pending');
    }
    return this.prisma.payoutRequest.update({
      where: { id },
      data: {
        status: target,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        notes: notes ?? req.notes,
      },
    });
  }
}
