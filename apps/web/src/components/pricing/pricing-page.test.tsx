import type { AnchorHTMLAttributes } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PricingPage } from './pricing-page';

const mockState = vi.hoisted(() => ({
  billing: true,
  accessToken: null as string | null,
}));

const mockApi = vi.hoisted(() => ({
  packages: vi.fn(),
  checkout: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/release-features', () => ({
  releaseFeatures: mockState,
}));

vi.mock('@/lib/store', () => ({
  useAuth: () => ({ accessToken: mockState.accessToken }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    setToken: mockApi.setToken,
    wallet: {
      packages: mockApi.packages,
      checkout: mockApi.checkout,
    },
  },
}));

const creditPackage = {
  id: 'starter',
  label: 'Starter',
  credits: 1200,
  amountCents: 499,
  currency: 'EUR',
};

describe('PricingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.billing = true;
    mockState.accessToken = null;
    mockApi.packages.mockResolvedValue({ packages: [creditPackage] });
    mockApi.checkout.mockRejectedValue(new Error('provider unavailable'));
  });

  it('fails closed with a clear deployment message when billing is disabled', () => {
    mockState.billing = false;
    render(<PricingPage />);
    expect(screen.getByRole('heading', { name: 'Pricing' })).toBeInTheDocument();
    expect(
      screen.getByText('Credit purchases are not available on this deployment.'),
    ).toBeInTheDocument();
    expect(mockApi.packages).not.toHaveBeenCalled();
  });

  it('loads packages and directs anonymous visitors to sign in', async () => {
    render(<PricingPage />);
    expect(screen.getByText('Loading packages…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByText('1,200 credits')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /sign in/i })).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('requires delivery consent and surfaces provider checkout errors', async () => {
    mockState.accessToken = 'access-token';
    const user = userEvent.setup();
    render(<PricingPage />);
    const card = await screen.findByRole('button', { name: 'Pay by card' });
    const paypal = screen.getByRole('button', { name: 'Pay with PayPal' });
    expect(card).toBeDisabled();
    expect(paypal).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Open wallet' })).toHaveAttribute('href', '/wallet');

    await user.click(screen.getByRole('checkbox'));
    expect(card).toBeEnabled();
    await user.click(card);
    expect(mockApi.setToken).toHaveBeenCalledWith('access-token');
    expect(mockApi.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        packageId: 'starter',
        immediateDeliveryConsent: true,
      }),
    );
    expect(await screen.findByText('provider unavailable')).toBeInTheDocument();
    await waitFor(() => expect(card).toBeEnabled());

    mockApi.checkout.mockRejectedValueOnce('offline');
    await user.click(paypal);
    expect(await screen.findByText('Could not start checkout')).toBeInTheDocument();
  });

  it('shows empty and typed/untyped package-loading failures', async () => {
    mockApi.packages.mockResolvedValueOnce({ packages: [] });
    const empty = render(<PricingPage />);
    expect(await screen.findByText('No credit packages are available.')).toBeInTheDocument();
    empty.unmount();

    mockApi.packages.mockRejectedValueOnce(new Error('catalog offline'));
    const typed = render(<PricingPage />);
    expect(await screen.findByText('catalog offline')).toBeInTheDocument();
    typed.unmount();

    mockApi.packages.mockRejectedValueOnce('offline');
    render(<PricingPage />);
    expect(await screen.findByText('Could not load credit packages')).toBeInTheDocument();
  });

  it('does not update state after an in-flight catalog request is unmounted', async () => {
    const { promise, resolve } = Promise.withResolvers<{
      packages: (typeof creditPackage)[];
    }>();
    mockApi.packages.mockReturnValueOnce(promise);
    const view = render(<PricingPage />);
    view.unmount();
    resolve({ packages: [creditPackage] });
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: 'Starter' })).not.toBeInTheDocument();
  });
});
