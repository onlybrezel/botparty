import {
  buildWalletExportContent,
  buildWalletHistoryFilters,
  formatCredits,
  formatMoney,
  transactionLabel,
  TRANSACTION_TYPES,
} from './wallet-page.helpers';
import type { WalletTransactionRecord } from '@/lib/api/wallet';
import { TransactionType } from '@botparty/shared';

const baseTransaction: WalletTransactionRecord = {
  id: 'transaction-1',
  type: TransactionType.DEPOSIT,
  amount: 100,
  balanceAfter: 100,
  description: null,
  ledgerGroupId: null,
  metadata: null,
  createdAt: '2026-07-17T12:00:00.000Z',
};

describe('wallet page helpers', () => {
  it('formats credits, currencies, and every supported transaction label', () => {
    expect(formatCredits(1200)).toMatch(/1.?200/);
    expect(formatMoney(499, 'EUR')).toContain('4');
    const labels = TRANSACTION_TYPES.map((type) => transactionLabel({ type }));
    expect(labels).toEqual([
      'Credits purchased',
      'Withdrawal',
      'Button press',
      'Button earnings',
      'Donation sent',
      'Donation received',
      'Platform fee',
      'Refund',
      'Chargeback',
      'Admin adjustment',
      'Reward',
    ]);
    expect(transactionLabel({ type: 'OTHER' as WalletTransactionRecord['type'] })).toBe('OTHER');
  });

  it('builds normalized history filters and excludes malformed robot ids', () => {
    expect(
      buildWalletHistoryFilters({
        type: 'REFUND',
        from: '2026-07-01',
        to: '2026-07-17',
        robotId: ' 550e8400-e29b-41d4-a716-446655440000 ',
      }),
    ).toEqual({
      type: TransactionType.REFUND,
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-17T23:59:59.999Z',
      robotId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(buildWalletHistoryFilters({ type: '', from: '', to: '', robotId: 'bad' })).toEqual({
      type: undefined,
      from: undefined,
      to: undefined,
      robotId: undefined,
    });
  });

  it('exports stable JSON and reconciliation-aware CSV without spreadsheet formulas', () => {
    const refund: WalletTransactionRecord = {
      ...baseTransaction,
      id: 'refund-1',
      type: TransactionType.REFUND,
      amount: -25,
      balanceAfter: 75,
      reconciliationId: '=provider-reference',
      description: 'Refund "quoted"',
    };
    const chargeback: WalletTransactionRecord = {
      ...baseTransaction,
      id: 'chargeback-1',
      type: TransactionType.CHARGEBACK,
      description: '@formula',
    };
    const csv = buildWalletExportContent([baseTransaction, refund, chargeback], 'csv', 'now');
    expect(csv).toContain('"REVERSED"');
    expect(csv).toContain('"\'=provider-reference"');
    expect(csv).toContain('"Refund ""quoted"""');
    expect(csv).toContain('"\'@formula"');
    expect(csv).toContain('"chargeback-1"');
    expect(csv).toContain('""');

    expect(JSON.parse(buildWalletExportContent([refund], 'json', '2026-07-17'))).toEqual({
      exportedAt: '2026-07-17',
      items: [refund],
    });
  });
});
