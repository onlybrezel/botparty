import { ConfigService } from '@nestjs/config';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { StorageDeletionService } from './storage-deletion.service';
import {
  createS3CompatibleStorageClient,
  resolveS3CompatibleStorageConfig,
} from '../common/s3-compatible-storage';

jest.mock('../common/s3-compatible-storage', () => ({
  createS3CompatibleStorageClient: jest.fn(),
  resolveS3CompatibleStorageConfig: jest.fn(),
}));

describe('StorageDeletionService', () => {
  function createDatabase() {
    return {
      storageDeletionTask: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
  }
  const storage = {
    bucket: 'botparty-recordings',
    region: 'us-east-1',
    endpoint: 'http://seaweedfs:8333',
    accessKeyId: 'audit',
    secretAccessKey: 'audit-secret',
    forcePathStyle: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(resolveS3CompatibleStorageConfig).mockReturnValue(storage);
  });

  it('deduplicates exact keys when enqueueing in the caller transaction', async () => {
    const tx = { storageDeletionTask: { createMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    const service = new StorageDeletionService(createDatabase(), new ConfigService({
      LIVEKIT_RECORDINGS_S3_BUCKET: storage.bucket,
    }));

    await service.enqueue(tx, storage.bucket, ['sessions/a.mp4', 'sessions/a.mp4', ' sessions/b.mp4 ']);

    expect(tx.storageDeletionTask.createMany).toHaveBeenCalledWith({
      data: [
        { bucket: storage.bucket, objectKey: 'sessions/a.mp4' },
        { bucket: storage.bucket, objectKey: 'sessions/b.mp4' },
      ],
      skipDuplicates: true,
    });
  });

  it('removes outbox rows only after object storage confirms deletion', async () => {
    const tasks = [
      { id: 'task-1', bucket: storage.bucket, objectKey: 'sessions/a.mp4', attempts: 0 },
      { id: 'task-2', bucket: storage.bucket, objectKey: 'sessions/b.mp4', attempts: 0 },
    ];
    const prisma = {
      storageDeletionTask: {
        findMany: jest.fn().mockResolvedValueOnce(tasks).mockResolvedValueOnce([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const send = jest.fn().mockResolvedValue({ Errors: [] });
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({ send });
    const service = new StorageDeletionService(prisma, new ConfigService());

    await expect(service.processDue()).resolves.toBe(2);

    expect(send).toHaveBeenCalledTimes(1);
    expect(prisma.storageDeletionTask.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['task-1', 'task-2'] } },
    });
    expect(prisma.storageDeletionTask.update).not.toHaveBeenCalled();
  });

  it('retains failed tasks with bounded exponential retry state', async () => {
    const task = { id: 'task-1', bucket: storage.bucket, objectKey: 'sessions/a.mp4', attempts: 2 };
    const prisma = {
      storageDeletionTask: {
        findMany: jest.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]),
        deleteMany: jest.fn(),
        update: jest.fn().mockReturnValue({ update: true }),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({
      send: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    });
    const service = new StorageDeletionService(prisma, new ConfigService());

    await expect(service.processDue()).resolves.toBe(1);

    expect(prisma.storageDeletionTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({
        attempts: { increment: 1 },
        nextAttemptAt: expect.any(Date),
        lastError: 'storage unavailable',
      }),
    });
    expect(prisma.storageDeletionTask.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes every object under a durable thumbnail prefix before completing the task', async () => {
    const thumbnailStorage = { ...storage, bucket: 'botparty-thumbnails' };
    jest.mocked(resolveS3CompatibleStorageConfig).mockImplementation((_config, prefix) =>
      prefix === 'THUMBNAIL_S3_' ? thumbnailStorage : storage,
    );
    const task = {
      id: 'task-prefix',
      bucket: thumbnailStorage.bucket,
      objectKey: 'robot-thumbnails/robot-1/',
      attempts: 0,
    };
    const prisma = {
      storageDeletionTask: {
        findMany: jest.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const send = jest.fn()
      .mockResolvedValueOnce({ Contents: [{ Key: 'robot-thumbnails/robot-1/a.webp' }] })
      .mockResolvedValueOnce({ Errors: [] })
      .mockResolvedValueOnce({ Contents: [] });
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({ send });
    const service = new StorageDeletionService(prisma, new ConfigService());

    await expect(service.processDue()).resolves.toBe(1);

    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(DeleteObjectsCommand));
    expect(prisma.storageDeletionTask.deleteMany).toHaveBeenCalledWith({ where: { id: task.id } });
    expect(prisma.storageDeletionTask.update).not.toHaveBeenCalled();
  });
});
