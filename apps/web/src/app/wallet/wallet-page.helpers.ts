import type { WalletTransactionRecord } from '@/lib/api/wallet';
import { TransactionType } from '@botparty/shared/constants';

export const TRANSACTION_TYPES = [
  TransactionType.DEPOSIT,
  TransactionType.WITHDRAWAL,
  TransactionType.BUTTON_SPEND,
  TransactionType.BUTTON_PAYOUT,
  TransactionType.DONATION_SENT,
  TransactionType.DONATION_RECEIVED,
  TransactionType.PLATFORM_FEE,
  TransactionType.REFUND,
  TransactionType.CHARGEBACK,
  TransactionType.ADMIN_ADJUSTMENT,
  TransactionType.REWARD,
] as const;

export function formatCredits(value: number) {
  return value.toLocaleString();
}

export function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountCents / 100,
  );
}

export function transactionLabel(transaction: Pick<WalletTransactionRecord, 'type'>) {
  switch (transaction.type) {
    case 'DEPOSIT':
      return 'Credits purchased';
    case 'BUTTON_SPEND':
      return 'Button press';
    case 'BUTTON_PAYOUT':
      return 'Button earnings';
    case 'DONATION_SENT':
      return 'Donation sent';
    case 'DONATION_RECEIVED':
      return 'Donation received';
    case 'PLATFORM_FEE':
      return 'Platform fee';
    case 'WITHDRAWAL':
      return 'Withdrawal';
    case 'REFUND':
      return 'Refund';
    case 'CHARGEBACK':
      return 'Chargeback';
    case 'ADMIN_ADJUSTMENT':
      return 'Admin adjustment';
    case 'REWARD':
      return 'Reward';
    default:
      return transaction.type;
  }
}

export function buildWalletHistoryFilters(input: {
  type: string;
  from: string;
  to: string;
  robotId: string;
}) {
  const robotId = input.robotId.trim();
  return {
    ...(input.type ? { type: input.type } : {}),
    ...(input.from ? { from: new Date(`${input.from}T00:00:00.000Z`).toISOString() } : {}),
    ...(input.to ? { to: new Date(`${input.to}T23:59:59.999Z`).toISOString() } : {}),
    ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(robotId)
      ? { robotId }
      : {}),
  };
}

function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildWalletExportContent(
  items: WalletTransactionRecord[],
  format: 'csv' | 'json',
  exportedAt: string,
) {
  if (format === 'json') {
    return JSON.stringify({ exportedAt, items }, null, 2);
  }

  return [
    ['Date', 'Type', 'Amount', 'Balance after', 'Status', 'Reference', 'Description']
      .map(csvCell)
      .join(','),
    ...items.map((item) =>
      [
        item.createdAt,
        item.type,
        item.amount,
        item.balanceAfter,
        item.type === 'REFUND' || item.type === 'CHARGEBACK' ? 'REVERSED' : 'FINAL',
        item.reconciliationId ?? item.id,
        item.description,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');
}
