import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@botparty/prisma';
import { RedisService } from '../redis/redis.service';
import { Counter, Gauge, register } from 'prom-client';
import { StorageDeletionService } from '../storage/storage-deletion.service';

// AnalyticsEvent rows older than this are deleted during maintenance sweeps.
const ANALYTICS_RETENTION_DAYS = Number(process.env['ANALYTICS_RETENTION_DAYS'] ?? 90);
// How often the cleanup job runs (default: every 6 hours).
const CLEANUP_INTERVAL_MS = Number(process.env['CLEANUP_INTERVAL_MS'] ?? 6 * 60 * 60 * 1000);
const ROBOT_STREAM_KEY_MAX_AGE_DAYS = Number(process.env['ROBOT_STREAM_KEY_MAX_AGE_DAYS'] ?? 90);
const ADMIN_AUDIT_LOG_RETENTION_DAYS = Number(process.env['ADMIN_AUDIT_LOG_RETENTION_DAYS'] ?? 180);
const LEDGER_RECONCILIATION_LOOKBACK_DAYS = Number(
  process.env['LEDGER_RECONCILIATION_LOOKBACK_DAYS'] ?? 30,
);
const CHAT_RETENTION_DAYS = Number(process.env['CHAT_RETENTION_DAYS'] ?? 30);
const BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS = Number(
  process.env['BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS'] ?? 30,
);
const MODERATION_RETENTION_DAYS = Number(process.env['MODERATION_RETENTION_DAYS'] ?? 180);
const RECORDING_RETENTION_DAYS = Number(process.env['RECORDING_RETENTION_DAYS'] ?? 30);
const ROBOT_MAINTENANCE_BATCH_SIZE = 100;

const cleanupRuns =
  (register.getSingleMetric('botparty_retention_cleanup_runs_total') as
    | Counter<'dataset' | 'outcome'>
    | undefined) ??
  new Counter({
    name: 'botparty_retention_cleanup_runs_total',
    help: 'Retention cleanup runs by dataset and outcome',
    labelNames: ['dataset', 'outcome'] as const,
  });
const cleanupRows =
  (register.getSingleMetric('botparty_retention_cleanup_rows_total') as
    | Counter<'dataset'>
    | undefined) ??
  new Counter({
    name: 'botparty_retention_cleanup_rows_total',
    help: 'Rows deleted or minimized by retention cleanup',
    labelNames: ['dataset'] as const,
  });
const cleanupLastSuccess =
  (register.getSingleMetric('botparty_retention_cleanup_last_success_timestamp_seconds') as
    | Gauge<'dataset'>
    | undefined) ??
  new Gauge({
    name: 'botparty_retention_cleanup_last_success_timestamp_seconds',
    help: 'Unix timestamp of the last successful retention cleanup',
    labelNames: ['dataset'] as const,
  });

interface MaintenanceDatabase {
  $executeRaw: PrismaService['$executeRaw'];
  $queryRaw: PrismaService['$queryRaw'];
  $transaction: PrismaService['$transaction'];
  adminAuditLog: Pick<PrismaService['adminAuditLog'], 'deleteMany'>;
  analyticsEvent: Pick<PrismaService['analyticsEvent'], 'deleteMany'>;
  chatMessage: Pick<PrismaService['chatMessage'], 'deleteMany'>;
  notification: Pick<PrismaService['notification'], 'deleteMany'>;
  queueEntry: Pick<PrismaService['queueEntry'], 'deleteMany'>;
  robot: Pick<PrismaService['robot'], 'findMany' | 'update'>;
  robotModerationEntry: Pick<PrismaService['robotModerationEntry'], 'deleteMany' | 'updateMany'>;
  user: Pick<PrismaService['user'], 'updateMany'>;
}

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private _startupTimer: ReturnType<typeof setTimeout> | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _viewerCountTimer: ReturnType<typeof setInterval> | null = null;
  private _lastViewerCountErrorLogAt = 0;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: MaintenanceDatabase,
    @Inject(RedisService) private readonly redis: Pick<RedisService, 'eval' | 'mget' | 'set'>,
    @Inject(StorageDeletionService)
    private readonly storageDeletion: Pick<
      StorageDeletionService,
      'enqueue' | 'processDue' | 'recordingBucket'
    >,
  ) {}

  onModuleInit() {
    // Run once shortly after startup, then on the configured interval.
    const runSoon = setTimeout(() => {
      void this._runCleanup().catch((error) => {
        this.logger.error(`Maintenance cleanup cycle failed: ${(error as Error).message}`);
      });
    }, 30_000);
    runSoon.unref?.();
    this._startupTimer = runSoon;

    const timer = setInterval(() => {
      void this._runCleanup().catch((error) => {
        this.logger.error(`Maintenance cleanup cycle failed: ${(error as Error).message}`);
      });
    }, CLEANUP_INTERVAL_MS);
    timer.unref?.();
    this._timer = timer;
    const viewerCountTimer = setInterval(() => {
      void this._flushViewerCounts()
        .then(() => {
          this._lastViewerCountErrorLogAt = 0;
        })
        .catch((error) => {
          const now = Date.now();
          if (now - this._lastViewerCountErrorLogAt >= 60_000) {
            this._lastViewerCountErrorLogAt = now;
            this.logger.warn(`Viewer count synchronization failed: ${(error as Error).message}`);
          }
        });
    }, 30_000);
    viewerCountTimer.unref?.();
    this._viewerCountTimer = viewerCountTimer;
  }

  onModuleDestroy() {
    if (this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._viewerCountTimer) {
      clearInterval(this._viewerCountTimer);
      this._viewerCountTimer = null;
    }
  }

  private async _runCleanup() {
    await this.withDistributedLock('maintenance:retention', 30 * 60_000, async () => {
      await this._runCleanupJobs();
    });
  }

  private async _runCleanupJobs() {
    const jobs: Array<[string, () => Promise<void>]> = [
      ['queue', () => this._purgeExpiredQueueEntries()],
      ['analytics', () => this._purgeOldAnalyticsEvents()],
      ['robot_stream_keys', () => this._rotateExpiredRobotStreamKeys()],
      ['admin_audit', () => this._purgeOldAdminAuditLogs()],
      ['ledger_reconciliation', () => this._reconcileLedgerGroups()],
      ['content', () => this.enforceContentRetention()],
      [
        'storage_deletions',
        async () => {
          const processed = await this.storageDeletion.processDue();
          if (processed > 0) {
            cleanupRows.inc({ dataset: 'storage_deletions' }, processed);
          }
        },
      ],
    ];
    for (const [dataset, job] of jobs) {
      try {
        await job();
        cleanupRuns.inc({ dataset, outcome: 'success' });
        cleanupLastSuccess.set({ dataset }, Date.now() / 1000);
      } catch (error) {
        cleanupRuns.inc({ dataset, outcome: 'failure' });
        this.logger.warn(`${dataset} maintenance failed`, error);
      }
    }
  }

  private async _purgeExpiredQueueEntries() {
    const result = await this.prisma.queueEntry.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    if (result.count > 0) {
      cleanupRows.inc({ dataset: 'queue_entries' }, result.count);
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
      cleanupRows.inc({ dataset: 'analytics_events' }, result.count);
      this.logger.log(
        `Purged ${result.count} analytics event(s) older than ${ANALYTICS_RETENTION_DAYS} days`,
      );
    }
  }

  protected async _rotateExpiredRobotStreamKeys() {
    if (!Number.isFinite(ROBOT_STREAM_KEY_MAX_AGE_DAYS) || ROBOT_STREAM_KEY_MAX_AGE_DAYS <= 0) {
      return;
    }

    const maxAgeMs = ROBOT_STREAM_KEY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let rotated = 0;
    let cursor: string | undefined;
    while (true) {
      const robots = await this.prisma.robot.findMany({
        select: {
          id: true,
          createdAt: true,
          metadata: true,
        },
        orderBy: { id: 'asc' },
        take: ROBOT_MAINTENANCE_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (robots.length === 0) break;

      for (const robot of robots) {
        const issuedAt = this._readIssuedAt(robot.metadata, 'streamKeyIssuedAt') ?? robot.createdAt;
        if (now - issuedAt.getTime() <= maxAgeMs) {
          continue;
        }

        const nextMetadata = this._withIssuedAt(robot.metadata, 'streamKeyIssuedAt');
        await this.prisma.robot.update({
          where: { id: robot.id },
          data: {
            streamKeyHash: createHash('sha256')
              .update(randomBytes(32).toString('hex'))
              .digest('hex'),
            metadata: nextMetadata as Prisma.InputJsonValue,
          },
        });
        rotated += 1;
      }

      if (robots.length < ROBOT_MAINTENANCE_BATCH_SIZE) break;
      cursor = robots[robots.length - 1]?.id;
      if (!cursor) break;
    }

    if (rotated > 0) {
      this.logger.log(
        `Rotated ${rotated} robot stream key(s) older than ${ROBOT_STREAM_KEY_MAX_AGE_DAYS} days`,
      );
    }
  }

  private async _purgeOldAdminAuditLogs() {
    if (!Number.isFinite(ADMIN_AUDIT_LOG_RETENTION_DAYS) || ADMIN_AUDIT_LOG_RETENTION_DAYS <= 0) {
      return;
    }

    const cutoff = new Date(Date.now() - ADMIN_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.prisma.adminAuditLog.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { createdAt: { lt: cutoff } }] },
    });

    if (result.count > 0) {
      cleanupRows.inc({ dataset: 'admin_audit_logs' }, result.count);
      this.logger.log(
        `Purged ${result.count} admin audit log entr${result.count === 1 ? 'y' : 'ies'} older than ${ADMIN_AUDIT_LOG_RETENTION_DAYS} days`,
      );
    }
  }

  private async _reconcileLedgerGroups() {
    if (
      !Number.isFinite(LEDGER_RECONCILIATION_LOOKBACK_DAYS) ||
      LEDGER_RECONCILIATION_LOOKBACK_DAYS <= 0
    ) {
      return;
    }

    const cutoff = new Date(Date.now() - LEDGER_RECONCILIATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const mismatches = await this.prisma.$queryRaw<
      Array<{ ledgerGroupId: string; netAmount: number; entryCount: number }>
    >(
      Prisma.sql`
        SELECT
          "ledgerGroupId"::text AS "ledgerGroupId",
          COALESCE(SUM(amount), 0)::int AS "netAmount",
          COUNT(*)::int AS "entryCount"
        FROM transactions
        WHERE "ledgerGroupId" IS NOT NULL
          AND "createdAt" >= ${cutoff}
        GROUP BY "ledgerGroupId"
        HAVING COALESCE(SUM(amount), 0) <> 0
        ORDER BY MAX("createdAt") DESC
        LIMIT 100
      `,
    );

    if (mismatches.length > 0) {
      for (const mismatch of mismatches) {
        this.logger.warn(
          `Ledger reconciliation mismatch for ${mismatch.ledgerGroupId}: net=${mismatch.netAmount}, entries=${mismatch.entryCount}`,
        );
      }
    }
  }

  private async _flushViewerCounts() {
    await this.withDistributedLock('maintenance:viewer-counts', 25_000, async () => {
      await this._flushViewerCountsUnlocked();
    });
  }

  protected async _flushViewerCountsUnlocked() {
    let cursor: string | undefined;
    while (true) {
      const robots = await this.prisma.robot.findMany({
        where: { status: { in: ['ONLINE', 'BUSY'] } },
        select: { id: true, viewerCount: true },
        orderBy: { id: 'asc' },
        take: ROBOT_MAINTENANCE_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (robots.length === 0) break;

      const counts = await this.redis.mget(
        ...robots.map((robot) => `robot:viewer-count:${robot.id}`),
      );
      const updates = robots.flatMap((robot, index) => {
        const count = Math.max(0, Number(counts[index] ?? 0) || 0);
        return count === robot.viewerCount
          ? []
          : [this.prisma.robot.update({ where: { id: robot.id }, data: { viewerCount: count } })];
      });
      if (updates.length > 0) await this.prisma.$transaction(updates);

      if (robots.length < ROBOT_MAINTENANCE_BATCH_SIZE) break;
      cursor = robots[robots.length - 1]?.id;
      if (!cursor) break;
    }
  }

  async enforceContentRetention() {
    const now = Date.now();
    if (CHAT_RETENTION_DAYS > 0) {
      const deleted = await this.prisma.chatMessage.deleteMany({
        where: { createdAt: { lt: new Date(now - CHAT_RETENTION_DAYS * 86_400_000) } },
      });
      cleanupRows.inc({ dataset: 'chat_messages' }, deleted.count);
    }
    if (BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS > 0) {
      const cutoff = new Date(now - BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS * 86_400_000);
      const minimized = await this.prisma.$executeRaw`
        UPDATE billing_webhook_events
        SET payload = '{"retained":false,"reason":"payload_retention_elapsed"}'::jsonb
        WHERE "processedAt" < ${cutoff}
          AND payload IS DISTINCT FROM '{"retained":false,"reason":"payload_retention_elapsed"}'::jsonb
      `;
      cleanupRows.inc({ dataset: 'billing_webhook_payloads' }, minimized);
    }
    if (MODERATION_RETENTION_DAYS > 0) {
      await this.prisma.robotModerationEntry.updateMany({
        where: { isActive: true, expiresAt: { lt: new Date() } },
        data: { isActive: false },
      });
      const deleted = await this.prisma.robotModerationEntry.deleteMany({
        where: {
          createdAt: { lt: new Date(now - MODERATION_RETENTION_DAYS * 86_400_000) },
          isActive: false,
        },
      });
      cleanupRows.inc({ dataset: 'moderation_entries' }, deleted.count);
    }
    if (RECORDING_RETENTION_DAYS > 0) {
      const cutoff = new Date(now - RECORDING_RETENTION_DAYS * 86_400_000);
      const deletedCount = await this.prisma.$transaction(async (tx) => {
        const expired = await tx.recording.findMany({
          where: { startedAt: { lt: cutoff } },
          orderBy: { startedAt: 'asc' },
          take: 5_000,
          select: { id: true, objectKey: true },
        });
        await this.storageDeletion.enqueue(
          tx,
          this.storageDeletion.recordingBucket,
          expired.map((recording) => recording.objectKey),
        );
        if (expired.length === 0) {
          return 0;
        }
        const deleted = await tx.recording.deleteMany({
          where: { id: { in: expired.map((recording) => recording.id) } },
        });
        return deleted.count;
      });
      cleanupRows.inc({ dataset: 'recording_metadata' }, deletedCount);
    }
    await this.prisma.user.updateMany({
      where: { emailVerificationExpiry: { lt: new Date() } },
      data: { emailVerificationToken: null, emailVerificationExpiry: null },
    });
    const notifications = await this.prisma.notification.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    cleanupRows.inc({ dataset: 'notifications' }, notifications.count);
  }

  private _withIssuedAt(metadata: unknown, field: 'streamKeyIssuedAt'): Record<string, unknown> {
    const base =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
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

  async withDistributedLock(
    key: string,
    ttlMs: number,
    work: () => Promise<void>,
  ): Promise<boolean> {
    const token = randomBytes(24).toString('hex');
    let acquired: string | null;
    try {
      acquired = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    } catch (error) {
      this.logger.warn(`Cannot acquire distributed maintenance lock ${key}`, error);
      return false;
    }
    if (acquired !== 'OK') {
      return false;
    }

    try {
      await work();
      return true;
    } finally {
      try {
        await this.redis.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          key,
          token,
        );
      } catch (error) {
        this.logger.warn(`Cannot release distributed maintenance lock ${key}`, error);
      }
    }
  }
}
