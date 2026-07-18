import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@botparty/prisma';
import { Gauge, register } from 'prom-client';
import { createS3CompatibleStorageClient, resolveS3CompatibleStorageConfig } from '../common/s3-compatible-storage';
import { PrismaService } from '../prisma/prisma.service';

const deletionBacklog = (register.getSingleMetric('botparty_storage_deletion_backlog') as Gauge | undefined)
  ?? new Gauge({
    name: 'botparty_storage_deletion_backlog',
    help: 'Object-storage deletion tasks that have not completed',
  });
const deletionFailures = (register.getSingleMetric('botparty_storage_deletion_failed') as Gauge | undefined)
  ?? new Gauge({
    name: 'botparty_storage_deletion_failed',
    help: 'Object-storage deletion tasks waiting for retry after a failure',
  });

@Injectable()
export class StorageDeletionService {
  private readonly logger = new Logger(StorageDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  get recordingBucket(): string {
    return this.config.get<string>('LIVEKIT_RECORDINGS_S3_BUCKET')?.trim() || 'botparty-recordings';
  }

  get thumbnailBucket(): string {
    return this.config.get<string>('THUMBNAIL_S3_BUCKET')?.trim() || 'botparty-thumbnails';
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    bucket: string,
    objectKeys: string[],
  ): Promise<void> {
    const uniqueKeys = [...new Set(objectKeys.map((key) => key.trim()).filter(Boolean))];
    if (uniqueKeys.length === 0) {
      return;
    }
    await tx.storageDeletionTask.createMany({
      data: uniqueKeys.map((objectKey) => ({ bucket, objectKey })),
      skipDuplicates: true,
    });
  }

  async processDue(limit = 5_000): Promise<number> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10_000);
    let processed = 0;
    while (processed < safeLimit) {
      const tasks = await this.prisma.storageDeletionTask.findMany({
        where: {
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: Math.min(500, safeLimit - processed),
        select: { id: true, bucket: true, objectKey: true, attempts: true },
      });
      if (tasks.length === 0) {
        break;
      }

      const tasksByBucket = new Map<string, typeof tasks>();
      for (const task of tasks) {
        const bucketTasks = tasksByBucket.get(task.bucket) ?? [];
        bucketTasks.push(task);
        tasksByBucket.set(task.bucket, bucketTasks);
      }
      for (const [bucket, bucketTasks] of tasksByBucket) {
        const storage = this.resolveStorage(bucket);
        if (!storage) {
          await this.markFailed(bucketTasks, `No object-storage credentials configured for bucket ${bucket}`);
          continue;
        }
        const client = createS3CompatibleStorageClient(storage);
        const exactTasks = bucketTasks.filter((task) => !task.objectKey.endsWith('/'));
        const prefixTasks = bucketTasks.filter((task) => task.objectKey.endsWith('/'));
        if (exactTasks.length > 0) {
          await this.processExactTasks(client, bucket, exactTasks);
        }
        for (const task of prefixTasks) {
          await this.processPrefixTask(client, task);
        }
      }
      processed += tasks.length;
    }

    await this.refreshMetrics();
    return processed;
  }

  private resolveStorage(bucket: string) {
    const candidates = [
      resolveS3CompatibleStorageConfig(this.config, 'LIVEKIT_RECORDINGS_S3_'),
      resolveS3CompatibleStorageConfig(this.config, 'THUMBNAIL_S3_'),
    ];
    return candidates.find((candidate) => candidate?.bucket === bucket) ?? null;
  }

  private async processExactTasks(
    client: S3Client,
    bucket: string,
    tasks: Array<{ id: string; objectKey: string; attempts: number }>,
  ) {
    try {
      const response = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: tasks.map((task) => ({ Key: task.objectKey })), Quiet: true },
      }));
      const failedByKey = new Map(
        (response.Errors ?? [])
          .filter((entry): entry is typeof entry & { Key: string } => Boolean(entry.Key))
          .map((entry) => [entry.Key, entry.Message || entry.Code || 'Object deletion failed']),
      );
      const succeededIds = tasks.filter((task) => !failedByKey.has(task.objectKey)).map((task) => task.id);
      const failed = tasks.filter((task) => failedByKey.has(task.objectKey));
      await this.prisma.$transaction([
        ...(succeededIds.length > 0
          ? [this.prisma.storageDeletionTask.deleteMany({ where: { id: { in: succeededIds } } })]
          : []),
        ...failed.map((task) => this.prisma.storageDeletionTask.update({
          where: { id: task.id },
          data: this.failureUpdate(task.attempts, failedByKey.get(task.objectKey) ?? 'Object deletion failed'),
        })),
      ]);
    } catch (error) {
      await this.markFailed(tasks, this.errorMessage(error));
    }
  }

  private async processPrefixTask(
    client: S3Client,
    task: { id: string; bucket: string; objectKey: string; attempts: number },
  ) {
    try {
      while (true) {
        const listed = await client.send(new ListObjectsV2Command({
          Bucket: task.bucket,
          Prefix: task.objectKey,
          MaxKeys: 1_000,
        }));
        const objects = (listed.Contents ?? []).flatMap((entry) => entry.Key ? [{ Key: entry.Key }] : []);
        if (objects.length === 0) break;
        const deleted = await client.send(new DeleteObjectsCommand({
          Bucket: task.bucket,
          Delete: { Objects: objects, Quiet: true },
        }));
        if ((deleted.Errors ?? []).length > 0) {
          throw new Error(deleted.Errors?.[0]?.Message || deleted.Errors?.[0]?.Code || 'Prefix deletion failed');
        }
      }
      await this.prisma.storageDeletionTask.deleteMany({ where: { id: task.id } });
    } catch (error) {
      await this.markFailed([task], this.errorMessage(error));
    }
  }

  private async markFailed(
    tasks: Array<{ id: string; attempts: number }>,
    message: string,
  ) {
    await this.prisma.$transaction(tasks.map((task) => this.prisma.storageDeletionTask.update({
      where: { id: task.id },
      data: this.failureUpdate(task.attempts, message),
    })));
    this.logger.warn(`Object-storage deletion batch failed: ${message}`);
  }

  async refreshMetrics(): Promise<void> {
    const [pending, failed] = await Promise.all([
      this.prisma.storageDeletionTask.count(),
      this.prisma.storageDeletionTask.count({ where: { attempts: { gt: 0 } } }),
    ]);
    deletionBacklog.set(pending);
    deletionFailures.set(failed);
  }

  private failureUpdate(attempts: number, message: string) {
    const delayMinutes = Math.min(2 ** Math.min(attempts, 6), 60);
    return {
      attempts: { increment: 1 },
      nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
      lastError: message.slice(0, 1_000),
    };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return 'Unknown object-storage error';
  }
}
