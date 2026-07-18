import type { RequestFn } from './types';
import type { AnalyticsDashboard } from '@botparty/shared';
export type { AnalyticsDashboard } from '@botparty/shared';

export class AnalyticsApi {
  constructor(private readonly req: RequestFn) {}

  consent() {
    return this.req<{ productAnalyticsEnabled: boolean; productAnalyticsConsentAt: string | null }>('/analytics/consent');
  }

  setConsent(enabled: boolean) {
    return this.req<{ productAnalyticsEnabled: boolean; productAnalyticsConsentAt: string | null }>('/analytics/consent', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  event(event: 'DISCOVERY_ROBOT_VIEW' | 'HOST_ONBOARDING_VIEW' | 'WALLET_VIEW', robotId?: string) {
    return this.req<{ accepted: boolean }>('/analytics/events', {
      method: 'POST',
      body: JSON.stringify({ event, ...(robotId ? { robotId } : {}) }),
    });
  }

  webVital(payload: {
    metric: 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB';
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    path: string;
    navigationType?: string;
  }) {
    return this.req<{ accepted: boolean }>('/analytics/events', {
      method: 'POST',
      body: JSON.stringify({ event: 'PERFORMANCE_WEB_VITAL', payload }),
    });
  }

  dashboard(days = 30) {
    return this.req<AnalyticsDashboard>(`/analytics/admin/dashboard?days=${days}`);
  }
}
