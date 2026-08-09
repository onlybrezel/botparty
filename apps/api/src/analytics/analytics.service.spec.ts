import { AnalyticsService } from './analytics.service';

function build() {
  const prisma = {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    analyticsEvent: { create: jest.fn(), deleteMany: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    session: { count: jest.fn(), aggregate: jest.fn() },
    robot: { count: jest.fn() },
    billingIntent: { count: jest.fn(), aggregate: jest.fn() },
  };
  return { service: new AnalyticsService(prisma), prisma };
}

describe('AnalyticsService', () => {
  it('does not persist product events without active consent', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ isActive: true, productAnalyticsEnabled: false });
    await expect(service.recordConsented('user-1', 'DISCOVERY_ROBOT_VIEW', 'robot-1')).resolves.toEqual({ accepted: false });
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('deletes historical events when consent is withdrawn', async () => {
    const { service, prisma } = build();
    prisma.user.update.mockResolvedValue({ productAnalyticsEnabled: false, productAnalyticsConsentAt: null });
    prisma.analyticsEvent.deleteMany.mockResolvedValue({ count: 4 });
    await service.setConsent('user-1', false);
    expect(prisma.analyticsEvent.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('stores validated web-vital payloads only through the consent gate', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ isActive: true, productAnalyticsEnabled: true });
    prisma.analyticsEvent.create.mockResolvedValue({ id: 'event-1' });

    await expect(service.ingest('user-1', {
      event: 'PERFORMANCE_WEB_VITAL',
      payload: {
        metric: 'INP',
        value: 148,
        rating: 'good',
        path: '/robot/owner/rover',
        navigationType: 'navigate',
      },
    })).resolves.toEqual({ accepted: true });

    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        event: 'PERFORMANCE_WEB_VITAL',
        payload: expect.objectContaining({ metric: 'INP', value: 148 }),
      }),
    });
  });

  it('derives funnel metrics from authoritative tables', async () => {
    const { service, prisma } = build();
    prisma.analyticsEvent.groupBy.mockResolvedValue([{ event: 'DISCOVERY_ROBOT_VIEW', schemaVersion: 1, _count: 8 }]);
    prisma.analyticsEvent.findMany.mockResolvedValue([
      { payload: { metric: 'LCP', value: 1800 } },
      { payload: { metric: 'LCP', value: 2200 } },
      { payload: { metric: 'INP', value: 160 } },
    ]);
    prisma.session.count.mockResolvedValue(4);
    prisma.session.aggregate.mockResolvedValue({ _count: 3, _avg: { durationMs: 1200 } });
    prisma.robot.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    prisma.billingIntent.count.mockResolvedValue(5);
    prisma.billingIntent.aggregate.mockResolvedValue({ _count: 2, _sum: { amountCents: 1998 } });

    await expect(service.dashboard(30)).resolves.toEqual(expect.objectContaining({
      discovery: 8,
      hostActivation: expect.objectContaining({ publishRate: 0.5 }),
      turns: expect.objectContaining({ successRate: 0.75 }),
      monetization: expect.objectContaining({ conversionRate: 0.4, grossAmountCents: 1998 }),
      webVitals: { sampleCount: 3, lcpP75Ms: 2200, inpP75Ms: 160, clsP75: null },
    }));
  });
});
