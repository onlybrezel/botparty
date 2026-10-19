import { createElement } from 'react';
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import Nav from './nav';

const usePathnameMock = vi.fn(() => '/');
const restoreSessionMock = vi.fn((_signal?: AbortSignal) => Promise.resolve());
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
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
