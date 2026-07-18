'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { usePreferences } from '@/lib/preferences';

const supportedMetrics = new Set(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']);
type WebVitalMetric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

function normalizedMetricPath(pathname: string) {
  if (pathname.startsWith('/robot/') || pathname.startsWith('/embed/')) {
    return pathname.startsWith('/robot/') ? '/robot/[...parts]' : '/embed/[...parts]';
  }
  if (/^\/sessions\/[^/]+/.test(pathname)) return '/sessions/[id]';
  return pathname.slice(0, 200);
}

function reportWebVital(metric: WebVitalMetric) {
  if (!supportedMetrics.has(metric.name)) return;
  const { accessToken } = useAuth.getState();
  const { productAnalyticsEnabled } = usePreferences.getState();
  if (!accessToken || !productAnalyticsEnabled) return;

  api.setToken(accessToken);
  void api.analytics.webVital({
    metric: metric.name as 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB',
    value: metric.value,
    rating: metric.rating,
    path: normalizedMetricPath(window.location.pathname),
    navigationType: metric.navigationType,
  }).catch(() => undefined);
}

export function WebVitalsReporter() {
  useReportWebVitals(reportWebVital);

  return null;
}
