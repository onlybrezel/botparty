import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// AnalyticsEvent rows older than this are deleted during maintenance sweeps.
const ANALYTICS_RETENTION_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 90);
// How often the cleanup job runs (default: every 6 hours).
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Run once shortly after startup, then on the configured interval.
    const runSoon = setTimeout(() => void this._runCleanup(), 30_000);
    runSoon.unref?.();

    const timer = setInterval(() => void this._runCleanup(), CLEANUP_INTERVAL_MS);
    timer.unref?.();
    this._timer = timer;
  }

  onModuleDestroy() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _runCleanup() {
    try {
      await this._purgeExpiredQueueEntries();
    } catch (err) {
      this.logger.warn('Queue entry cleanup failed', err);
    }

    try {
      await this._purgeOldAnalyticsEvents();
    } catch (err) {
      this.logger.warn('Analytics event cleanup failed', err);
    }
  }

  private async _purgeExpiredQueueEntries() {
    const result = await this.prisma.queueEntry.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} expired queue entry(ies)`);
    }
  }

  private async _purgeOldAnalyticsEvents() {
    if (ANALYTICS_RETENTION_DAYS <= 0) return;

    const cutoff = new Date(Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.prisma.analyticsEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (result.count > 0) {
      this.logger.log(
        `Purged ${result.count} analytics event(s) older than ${ANALYTICS_RETENTION_DAYS} days`,
      );
    }
  }
}
