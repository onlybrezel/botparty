import { Injectable } from '@nestjs/common';
import { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import type { AnalyticsEventInput } from '@botparty/shared';

const ANALYTICS_SCHEMA_VERSION = 1;
const ANALYTICS_RETENTION_DAYS = 90;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getConsent(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { productAnalyticsEnabled: true, productAnalyticsConsentAt: true },
    });
  }

  async setConsent(userId: string, enabled: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        productAnalyticsEnabled: enabled,
        productAnalyticsConsentAt: enabled ? new Date() : null,
      },
      select: { productAnalyticsEnabled: true, productAnalyticsConsentAt: true },
    });
    if (!enabled) {
      await this.prisma.analyticsEvent.deleteMany({ where: { userId } });
    }
    return user;
  }

  async ingest(userId: string, input: AnalyticsEventInput) {
    return input.event === 'PERFORMANCE_WEB_VITAL'
      ? this.recordConsented(userId, input.event, undefined, input.payload)
      : this.recordConsented(userId, input.event, input.robotId);
  }

  async recordConsented(userId: string, event: string, robotId?: string, payload?: Prisma.InputJsonValue) {
    const consent = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { productAnalyticsEnabled: true, isActive: true },
    });
    if (!consent?.isActive || !consent.productAnalyticsEnabled) return { accepted: false };
    await this.prisma.analyticsEvent.create({
      data: {
        userId,
        robotId,
        event,
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        payload,
      },
    });
    return { accepted: true };
  }

  async dashboard(days = 30) {
    const normalizedDays = Math.min(Math.max(days, 1), ANALYTICS_RETENTION_DAYS);
    const from = new Date(Date.now() - normalizedDays * 86_400_000);
    const [events, webVitalEvents, sessions, completedSessions, robots, publicRobots, billing, paidBilling] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ['event', 'schemaVersion'],
        where: { createdAt: { gte: from } },
        _count: true,
        orderBy: { event: 'asc' },
      }),
      this.prisma.analyticsEvent.findMany({
        where: { event: 'PERFORMANCE_WEB_VITAL', createdAt: { gte: from } },
        select: { payload: true },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      }),
      this.prisma.session.count({ where: { startedAt: { gte: from } } }),
      this.prisma.session.aggregate({
        where: { startedAt: { gte: from }, status: 'ENDED', durationMs: { gt: 0 } },
        _count: true,
        _avg: { durationMs: true },
      }),
      this.prisma.robot.count({ where: { createdAt: { gte: from } } }),
      this.prisma.robot.count({ where: { createdAt: { gte: from }, visibility: 'PUBLIC' } }),
      this.prisma.billingIntent.count({ where: { createdAt: { gte: from } } }),
      this.prisma.billingIntent.aggregate({
        where: { createdAt: { gte: from }, status: 'PAID' },
        _count: true,
        _sum: { amountCents: true },
      }),
    ]);
    const webVitalValues = (metric: string) => webVitalEvents.flatMap((entry) => {
      const payload = entry.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
      const value = 'value' in payload ? payload.value : null;
      return payload.metric === metric && typeof value === 'number' && Number.isFinite(value)
        ? [value]
        : [];
    });
    const p75 = (values: number[]) => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)] ?? null;
    };
    return {
      window: { days: normalizedDays, from: from.toISOString(), to: new Date().toISOString() },
      definitions: {
        turnSuccessRate: 'ended sessions with positive duration / sessions started',
        hostPublishRate: 'public robots created / robots created',
        paymentConversionRate: 'paid billing intents / billing intents created',
      },
      discovery: events
        .filter((entry) => entry.event === 'DISCOVERY_ROBOT_VIEW')
        .reduce((sum, entry) => sum + entry._count, 0),
      hostActivation: {
        robotsCreated: robots,
        robotsPublished: publicRobots,
        publishRate: robots > 0 ? publicRobots / robots : null,
      },
      turns: {
        started: sessions,
        completed: completedSessions._count,
        successRate: sessions > 0 ? completedSessions._count / sessions : null,
        averageDurationMs: completedSessions._avg.durationMs ?? null,
      },
      monetization: {
        checkoutIntents: billing,
        paidIntents: paidBilling._count,
        grossAmountCents: paidBilling._sum.amountCents ?? 0,
        conversionRate: billing > 0 ? paidBilling._count / billing : null,
      },
      webVitals: {
        sampleCount: webVitalEvents.length,
        lcpP75Ms: p75(webVitalValues('LCP')),
        inpP75Ms: p75(webVitalValues('INP')),
        clsP75: p75(webVitalValues('CLS')),
      },
      eventQuality: {
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        retainedDays: ANALYTICS_RETENTION_DAYS,
        counts: events.map((entry) => ({
          event: entry.event,
          schemaVersion: entry.schemaVersion,
          count: entry._count,
        })),
      },
    };
  }
}
