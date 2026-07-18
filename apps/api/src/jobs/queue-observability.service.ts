import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Gauge, register } from 'prom-client';
import { JOBS_QUEUE_AUDIT_CLEANUP, JOBS_QUEUE_MAIL, JOBS_QUEUE_WEBHOOK } from './jobs.constants';

function getGauge(name: string, help: string) {
  return (register.getSingleMetric(name) as Gauge<'queue'> | undefined) ?? new Gauge({
    name,
    help,
    labelNames: ['queue'] as const,
  });
}

const queueDepth = getGauge(
  'botparty_job_queue_depth',
  'Jobs waiting, delayed, prioritized, or waiting for child jobs',
);
const queueActive = getGauge('botparty_job_queue_active', 'Jobs currently processed by a worker');
const queueFailed = getGauge('botparty_job_queue_failed', 'Failed jobs retained in the queue');
const queueWorkerUp = getGauge(
  'botparty_job_queue_worker_up',
  'Whether the API worker can inspect and process its Redis-backed queue',
);

@Injectable()
export class QueueObservabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueObservabilityService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastErrorLogAt = 0;
  private readonly queues: Array<{ name: string; queue: Queue }>;

  constructor(
    @InjectQueue(JOBS_QUEUE_WEBHOOK) webhookQueue: Queue,
    @InjectQueue(JOBS_QUEUE_MAIL) mailQueue: Queue,
    @InjectQueue(JOBS_QUEUE_AUDIT_CLEANUP) auditCleanupQueue: Queue,
  ) {
    this.queues = [
      { name: JOBS_QUEUE_WEBHOOK, queue: webhookQueue },
      { name: JOBS_QUEUE_MAIL, queue: mailQueue },
      { name: JOBS_QUEUE_AUDIT_CLEANUP, queue: auditCleanupQueue },
    ];
  }

  onModuleInit() {
    this.collectSafely();
    this.timer = setInterval(() => this.collectSafely(), 15_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async collect() {
    await Promise.all(this.queues.map(async ({ name, queue }) => {
      const counts = await queue.getJobCounts(
        'waiting',
        'delayed',
        'prioritized',
        'waiting-children',
        'active',
        'failed',
      );
      queueDepth.set(
        { queue: name },
        (counts.waiting ?? 0) +
          (counts.delayed ?? 0) +
          (counts.prioritized ?? 0) +
          (counts['waiting-children'] ?? 0),
      );
      queueActive.set({ queue: name }, counts.active ?? 0);
      queueFailed.set({ queue: name }, counts.failed ?? 0);
      queueWorkerUp.set({ queue: name }, 1);
    }));
  }

  private collectSafely() {
    void this.collect().catch((error) => {
      for (const { name } of this.queues) queueWorkerUp.set({ queue: name }, 0);
      const now = Date.now();
      if (now - this.lastErrorLogAt >= 60_000) {
        this.lastErrorLogAt = now;
        this.logger.warn(`Queue metrics unavailable: ${(error as Error).message}`);
      }
    });
  }
}
