import { createElement } from 'react';
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import Nav from './nav';

const usePathnameMock = vi.fn(() => '/');
const restoreSessionMock = vi.fn(() => Promise.resolve());
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
    restoreSession: () => restoreSessionMock(),
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
  it('renders public navigation and sign-in entry', async () => {
    render(<Nav />);

    await waitFor(() => {
      expect(screen.getByText('Explore')).toBeInTheDocument();
    });

    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
