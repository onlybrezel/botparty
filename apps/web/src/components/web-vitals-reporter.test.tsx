import { render } from '@testing-library/react';
import { WebVitalsReporter } from './web-vitals-reporter';

const mocks = vi.hoisted(() => ({
  report: undefined as undefined | ((metric: {
    name: string;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    navigationType: string;
  }) => void),
  setToken: vi.fn(),
  webVital: vi.fn().mockResolvedValue({ accepted: true }),
  authState: { accessToken: 'token-1' as string | null },
  preferenceState: { productAnalyticsEnabled: true },
}));

vi.mock('next/web-vitals', () => ({
  useReportWebVitals: (callback: typeof mocks.report) => {
    mocks.report = callback;
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    setToken: mocks.setToken,
    analytics: { webVital: mocks.webVital },
  },
}));

vi.mock('@/lib/store', () => ({
  useAuth: { getState: () => mocks.authState },
}));

vi.mock('@/lib/preferences', () => ({
  usePreferences: { getState: () => mocks.preferenceState },
}));

describe('WebVitalsReporter', () => {
  beforeEach(() => {
    mocks.setToken.mockClear();
    mocks.webVital.mockClear();
    mocks.authState.accessToken = 'token-1';
    mocks.preferenceState.productAnalyticsEnabled = true;
  });

  it('sends supported metrics only for a signed-in user with consent', () => {
    render(<WebVitalsReporter />);
    mocks.report?.({ name: 'INP', value: 148, rating: 'good', navigationType: 'navigate' });

    expect(mocks.setToken).toHaveBeenCalledWith('token-1');
    expect(mocks.webVital).toHaveBeenCalledWith({
      metric: 'INP',
      value: 148,
      rating: 'good',
      path: '/',
      navigationType: 'navigate',
    });

    window.history.replaceState({}, '', '/robot/owner/private-slug');
    mocks.report?.({ name: 'LCP', value: 1900, rating: 'good', navigationType: 'navigate' });
    expect(mocks.webVital).toHaveBeenLastCalledWith(expect.objectContaining({
      metric: 'LCP',
      path: '/robot/[...parts]',
    }));

    mocks.preferenceState.productAnalyticsEnabled = false;
    mocks.report?.({ name: 'LCP', value: 1900, rating: 'good', navigationType: 'navigate' });
    expect(mocks.webVital).toHaveBeenCalledTimes(2);
  });
});
