import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@botparty/prisma';

// AnalyticsEvent rows older than this are deleted during maintenance sweeps.
const ANALYTICS_RETENTION_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 90);
// How often the cleanup job runs (default: every 6 hours).
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const ROBOT_STREAM_KEY_MAX_AGE_DAYS = Number(process.env.ROBOT_STREAM_KEY_MAX_AGE_DAYS ?? 90);

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

    try {
      await this._rotateExpiredRobotStreamKeys();
    } catch (err) {
      this.logger.warn('Robot stream key rotation sweep failed', err);
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

  private async _rotateExpiredRobotStreamKeys() {
    if (!Number.isFinite(ROBOT_STREAM_KEY_MAX_AGE_DAYS) || ROBOT_STREAM_KEY_MAX_AGE_DAYS <= 0) {
      return;
    }

    const maxAgeMs = ROBOT_STREAM_KEY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const robots = await this.prisma.robot.findMany({
      select: {
        id: true,
        createdAt: true,
        metadata: true,
      },
    });

    let rotated = 0;
    for (const robot of robots) {
      const issuedAt = this._readIssuedAt(robot.metadata, 'streamKeyIssuedAt') ?? robot.createdAt;
      if (Date.now() - issuedAt.getTime() <= maxAgeMs) {
        continue;
      }

      const nextMetadata = this._withIssuedAt(robot.metadata, 'streamKeyIssuedAt');
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: {
          streamKey: randomBytes(32).toString('hex'),
          metadata: nextMetadata as Prisma.InputJsonValue,
        },
      });
      rotated += 1;
    }

    if (rotated > 0) {
      this.logger.log(`Rotated ${rotated} robot stream key(s) older than ${ROBOT_STREAM_KEY_MAX_AGE_DAYS} days`);
    }
  }

  private _withIssuedAt(metadata: unknown, field: 'streamKeyIssuedAt'): Record<string, unknown> {
    const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
    base[field] = new Date().toISOString();
    return base;
  }

  private _readIssuedAt(metadata: unknown, field: 'streamKeyIssuedAt'): Date | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const raw = (metadata as Record<string, unknown>)[field];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return null;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }
}
