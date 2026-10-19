import { renderToString } from 'react-dom/server';
import DashboardPage from './page';

vi.mock('@/components/dashboard/use-dashboard-page', () => ({
  useDashboardPage: () => ({
    hasHydrated: false,
    accessToken: null,
    robots: [],
    loading: true,
  }),
}));

describe('dashboard server shell', () => {
  it('renders its heading and reserves fleet space before session hydration', () => {
    const html = renderToString(<DashboardPage />);

    expect(html).toContain('Create robots, manage access and operate connected clients.');
    expect(html).toContain('Loading robot cards');
    expect(html).toContain('Total robots');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Create your robot');
  });
});
