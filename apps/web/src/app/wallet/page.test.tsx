import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WalletPage from './page';

const mockState = vi.hoisted(() => ({
  accessToken: 'access-token' as string | null,
  billing: true,
  payouts: true,
}));

const mockWallet = vi.hoisted(() => ({
  setToken: vi.fn(),
  me: vi.fn(),
  packages: vi.fn(),
  myPayouts: vi.fn(),
  transactions: vi.fn(),
  exportTransactions: vi.fn(),
  checkout: vi.fn(),
  requestPayout: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useAuth: () => ({ accessToken: mockState.accessToken }),
}));

vi.mock('@/lib/release-features', () => ({
  releaseFeatures: mockState,
}));

vi.mock('@/lib/api', () => ({
  api: {
    setToken: mockWallet.setToken,
    wallet: {
      me: mockWallet.me,
      packages: mockWallet.packages,
      myPayouts: mockWallet.myPayouts,
      transactions: mockWallet.transactions,
      exportTransactions: mockWallet.exportTransactions,
      checkout: mockWallet.checkout,
      requestPayout: mockWallet.requestPayout,
    },
  },
}));

const transaction = {
  id: 'transaction-1',
  type: 'DEPOSIT',
  amount: 100,
  balanceAfter: 100,
  description: 'Initial credits',
  ledgerGroupId: null,
  reconciliationId: 'reconciliation-1',
  metadata: null,
  createdAt: '2026-07-17T12:00:00.000Z',
};

describe('WalletPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.accessToken = 'access-token';
    mockState.billing = true;
    mockState.payouts = true;
    mockWallet.me.mockResolvedValue({ balance: 1200, recentTransactions: [] });
    mockWallet.packages.mockResolvedValue({
      packages: [
        {
          id: 'starter',
          label: 'Starter',
          credits: 1000,
          bonus: 200,
          amountCents: 499,
          currency: 'EUR',
        },
      ],
    });
    mockWallet.myPayouts.mockResolvedValue({
      items: [
        {
          id: 'payout-1',
          amount: 500,
          status: 'PENDING',
          destination: 'host@example.com',
          notes: null,
          createdAt: '2026-07-17T12:00:00.000Z',
          reviewedAt: null,
          paidAt: null,
        },
      ],
    });
    mockWallet.transactions.mockResolvedValue({ items: [transaction], nextCursor: null });
    mockWallet.exportTransactions.mockResolvedValue({
      exportedAt: '2026-07-17T12:00:00.000Z',
      items: [transaction],
    });
    mockWallet.checkout.mockRejectedValue(new Error('checkout offline'));
    mockWallet.requestPayout.mockResolvedValue({ id: 'payout-2' });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:wallet-export'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('requires authentication before loading private wallet data', () => {
    mockState.accessToken = null;
    render(<WalletPage />);
    expect(screen.getByText('Please sign in to view your wallet.')).toBeInTheDocument();
    expect(mockWallet.me).not.toHaveBeenCalled();
    expect(mockWallet.transactions).not.toHaveBeenCalled();
  });

  it('loads balance, packages, reconciled activity, and payout status', async () => {
    render(<WalletPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText(/1.?200 cr/)).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText(/\(\+200 bonus\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Credits purchased')).toHaveLength(2);
    expect(screen.getByText(/Ref reconciliation-1/)).toBeInTheDocument();
    expect(screen.getByText('host@example.com', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(mockWallet.setToken).toHaveBeenCalledWith('access-token');
  });

  it('filters and paginates history without duplicating existing transactions', async () => {
    mockWallet.transactions
      .mockResolvedValueOnce({ items: [transaction], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({
        items: [transaction, { ...transaction, id: 'transaction-2', type: 'REFUND', amount: -20 }],
        nextCursor: null,
      });
    const user = userEvent.setup();
    render(<WalletPage />);
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    await user.click(loadMore);
    expect(await screen.findAllByText('Refund')).toHaveLength(2);
    expect(screen.getAllByText('Credits purchased')).toHaveLength(2);
    expect(mockWallet.transactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2', limit: 50 }),
    );

    await user.selectOptions(screen.getByLabelText('Transaction type'), 'REFUND');
    await user.type(screen.getByLabelText('Transactions from'), '2026-07-01');
    await user.type(screen.getByLabelText('Transactions through'), '2026-07-17');
    await user.type(
      screen.getByLabelText('Robot ID filter'),
      '550e8400-e29b-41d4-a716-446655440000',
    );
    await waitFor(() =>
      expect(mockWallet.transactions).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REFUND',
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-17T23:59:59.999Z',
          robotId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ),
    );
  }, 10_000);

  it('exports CSV and JSON using a temporary object URL', async () => {
    const user = userEvent.setup();
    render(<WalletPage />);
    await screen.findAllByText('Credits purchased');
    await user.click(screen.getByRole('button', { name: 'CSV' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallet-export');
    await user.click(screen.getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(mockWallet.exportTransactions).toHaveBeenCalledTimes(2));
  });

  it('surfaces history, export, and wallet-loading failures', async () => {
    mockWallet.transactions.mockRejectedValueOnce('history offline');
    mockWallet.me.mockRejectedValueOnce('wallet offline');
    mockWallet.exportTransactions.mockRejectedValueOnce('export offline');
    const user = userEvent.setup();
    render(<WalletPage />);
    expect(await screen.findByText('Wallet could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'CSV' }));
    expect(await screen.findByText('Wallet export failed')).toBeInTheDocument();
  });

  it('requires delivery consent and surfaces checkout failures', async () => {
    const user = userEvent.setup();
    render(<WalletPage />);
    const card = await screen.findByRole('button', { name: 'Card' });
    expect(card).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(card);
    expect(await screen.findByText('checkout offline')).toBeInTheDocument();
    expect(card).toBeEnabled();
  });

  it('opens a confirmed checkout redirect and tolerates optional catalog failures', async () => {
    mockWallet.checkout.mockResolvedValueOnce({ redirectUrl: '#checkout' });
    mockWallet.packages.mockRejectedValueOnce(new Error('catalog offline'));
    mockWallet.myPayouts.mockRejectedValueOnce(new Error('payout list offline'));
    const user = userEvent.setup();
    const view = render(<WalletPage />);
    await screen.findByText(/1.?200 cr/);
    expect(screen.getByText('No packages are currently available.')).toBeInTheDocument();
    view.unmount();

    mockWallet.packages.mockResolvedValueOnce({
      packages: [
        {
          id: 'starter',
          label: 'Starter',
          credits: 1000,
          amountCents: 499,
          currency: 'EUR',
        },
      ],
    });
    render(<WalletPage />);
    await screen.findByRole('button', { name: 'PayPal' });
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'PayPal' }));
    await waitFor(() => expect(window.location.hash).toBe('#checkout'));
  });

  it('validates and submits payout details, then refreshes wallet state', async () => {
    const user = userEvent.setup();
    render(<WalletPage />);
    await screen.findAllByText('Credits purchased');
    const amount = screen.getByRole('spinbutton');
    const destination = screen.getByPlaceholderText('name@example.com');
    fireEvent.submit(amount.closest('form')!);
    expect(await screen.findByText('Invalid amount')).toBeInTheDocument();

    await user.type(amount, '250');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Payout method' }), 'IBAN');
    await user.clear(screen.getByPlaceholderText('DE…'));
    await user.type(screen.getByPlaceholderText('DE…'), 'DE89370400440532013000');
    await user.type(screen.getByRole('textbox', { name: 'Notes (optional)' }), 'Monthly payout');
    await user.click(screen.getByRole('button', { name: 'Request' }));

    await waitFor(() =>
      expect(mockWallet.requestPayout).toHaveBeenCalledWith({
        amount: 250,
        destination: 'DE89370400440532013000',
        destinationType: 'IBAN',
        notes: 'Monthly payout',
      }),
    );
    expect(mockWallet.me).toHaveBeenCalledTimes(2);
  });

  it('shows payout submission failures and restores the form action', async () => {
    mockWallet.requestPayout.mockRejectedValueOnce(new Error('review service offline'));
    const user = userEvent.setup();
    render(<WalletPage />);
    await screen.findAllByText('Credits purchased');
    await user.type(screen.getByRole('spinbutton'), '25');
    await user.type(screen.getByPlaceholderText('name@example.com'), 'host@example.com');
    await user.click(screen.getByRole('button', { name: 'Request' }));
    expect(await screen.findByText('review service offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request' })).toBeEnabled();
  });

  it('hides disabled release features and handles optional API failures as empty data', async () => {
    mockState.billing = false;
    mockState.payouts = false;
    render(<WalletPage />);
    await screen.findByText(/1.?200 cr/);
    expect(screen.queryByText('Buy credits')).not.toBeInTheDocument();
    expect(screen.queryByText('Request payout')).not.toBeInTheDocument();
    expect(mockWallet.packages).not.toHaveBeenCalled();
    expect(mockWallet.myPayouts).not.toHaveBeenCalled();
  });
});
