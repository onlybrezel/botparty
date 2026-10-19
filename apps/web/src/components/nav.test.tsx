import { createElement } from 'react';
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import Nav from './nav';
import { usePreferences } from '@/lib/preferences';

const usePathnameMock = vi.fn(() => '/');
const restoreSessionMock = vi.fn((_signal?: AbortSignal): Promise<boolean | void> => Promise.resolve());
const consentMock = vi.fn<() => Promise<{ productAnalyticsEnabled: boolean }>>();
const syncTokenFromStoreMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    createElement('img', { ...props, alt: props.alt ?? '' })
  ),
}));

vi.mock('@/lib/api', () => ({
  api: {
    syncTokenFromStore: () => syncTokenFromStoreMock(),
    restoreSession: (signal?: AbortSignal) => restoreSessionMock(signal),
    logout: () => Promise.resolve(),
    setToken: () => undefined,
    analytics: { consent: () => consentMock() },
  },
}));

vi.mock('@/lib/store', () => ({
  useAuth: () => ({
    accessToken: null,
    username: null,
    logout: vi.fn(),
    role: null,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  defaultLocale: 'en',
  localizePath: (pathname: string) => pathname,
}));

describe('Nav', () => {
  it('does not apply delayed analytics consent after its document leaves', async () => {
    let finishConsent!: (value: { productAnalyticsEnabled: boolean }) => void;
    usePreferences.setState({ productAnalyticsEnabled: false });
    restoreSessionMock.mockResolvedValueOnce(true);
    consentMock.mockImplementationOnce(() => new Promise((resolve) => { finishConsent = resolve; }));
    render(<Nav />);
    await waitFor(() => expect(consentMock).toHaveBeenCalled());
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await act(async () => finishConsent({ productAnalyticsEnabled: true }));
    expect(usePreferences.getState().productAnalyticsEnabled).toBe(false);
  });

  it('does not let an old bootstrap complete a pending BFCache restoration', async () => {
    let finishOld!: () => void;
    let finishCurrent!: () => void;
    restoreSessionMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOld = resolve; }));
    restoreSessionMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishCurrent = resolve; }));
    render(<Nav />);
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await act(async () => finishOld());
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    await act(async () => finishCurrent());
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('cancels document bootstrap on pagehide and restarts after a back-forward cache restore', async () => {
    restoreSessionMock.mockClear();
    const view = render(<Nav />);
    const originalSignal = restoreSessionMock.mock.calls[0]?.[0];
    expect(originalSignal?.aborted).toBe(false);
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(originalSignal?.aborted).toBe(true);
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(restoreSessionMock).toHaveBeenCalledTimes(2);
    const resumedSignal = restoreSessionMock.mock.calls[1]?.[0];
    expect(resumedSignal?.aborted).toBe(false);
    expect(resumedSignal).not.toBe(originalSignal);
    view.unmount();
    expect(resumedSignal?.aborted).toBe(false);
  });

  it('renders public navigation and sign-in entry', async () => {
    render(<Nav />);

    await waitFor(() => {
      expect(screen.getByText('Explore')).toBeInTheDocument();
    });

    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
