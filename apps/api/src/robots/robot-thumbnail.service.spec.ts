import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { NotFoundException } from '@nestjs/common';
import { RobotThumbnailService } from './robot-thumbnail.service';

type RobotThumbnailServiceTestAccess = {
  _createObjectStorageClient(): { send: jest.Mock };
};

const VALID_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9pUAAAAASUVORK5CYII=';

describe('RobotThumbnailService', () => {
  let service: RobotThumbnailService;
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    user: {
      findUnique: jest.Mock;
    };
    robot: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let storageDeletion: { enqueue: jest.Mock };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn(),
      },
      robot: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma = {
      ...transactionClient,
      $transaction: jest.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
    };
    storageDeletion = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new RobotThumbnailService(prisma as never, storageDeletion as never);
  });

  afterEach(async () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    jest.restoreAllMocks();
  });

  it('rejects thumbnail writes when object storage is not configured', async () => {
    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      owner: { id: 'owner-1', username: 'owner', displayName: null, avatarUrl: null },
    });
    await expect(service.save('robot-1', 'owner-1', VALID_PNG_DATA_URL)).rejects.toThrow(
      'Thumbnail object storage is not configured',
    );
  });

  it('uploads thumbnails to private S3-compatible storage and returns the API proxy url', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ENDPOINT = 'https://storage.example.com';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';

    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      owner: { id: 'owner-1', username: 'owner', displayName: null, avatarUrl: null },
    });
    prisma.robot.update.mockImplementation(async ({ data }) => ({
      id: 'robot-1',
      ownerId: 'owner-1',
      owner: { id: 'owner-1', username: 'owner', displayName: null, avatarUrl: null },
      thumbnailUrl: data.thumbnailUrl,
    }));

    const send = jest.fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({});
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });
    const saved = await service.save('robot-1', 'owner-1', VALID_PNG_DATA_URL);

    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(PutObjectCommand));
    expect(saved.thumbnailUrl).toBe('/api/v1/robots/robot-1/thumbnail-image');

    const putInput = send.mock.calls[1]?.[0].input as { CacheControl?: string; ContentType?: string };
    expect(putInput.ContentType).toBe('image/webp');
    expect(putInput.CacheControl).toBe('private, no-store');
    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      expect.any(Object),
      'botparty-thumbnails',
      [],
    );
  });

  it('removes a newly uploaded object when the database transaction fails', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';
    prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', ownerId: 'owner-1' });
    prisma.robot.update.mockRejectedValue(new Error('database unavailable'));
    const send = jest.fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Errors: [] });
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });

    await expect(service.save('robot-1', 'owner-1', VALID_PNG_DATA_URL)).rejects.toThrow(
      'database unavailable',
    );

    expect(send).toHaveBeenNthCalledWith(2, expect.any(PutObjectCommand));
    expect(send).toHaveBeenNthCalledWith(3, expect.any(DeleteObjectsCommand));
    expect(storageDeletion.enqueue).not.toHaveBeenCalled();
  });

  it('hides a cleared thumbnail and queues its exact object key transactionally', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';

    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      thumbnailUrl: 'https://cdn.example.com/robot-thumbnails/robot-1/1700000000000.webp',
    });
    prisma.robot.update.mockImplementation(async ({ data }) => ({
      id: 'robot-1',
      ownerId: 'owner-1',
      thumbnailUrl: data.thumbnailUrl,
    }));

    const send = jest.fn()
      .mockResolvedValueOnce({ Contents: [{ Key: 'robot-thumbnails/robot-1/1700000000000.webp' }] });
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });

    const cleared = await service.clear('robot-1', 'owner-1');

    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenCalledTimes(1);
    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      expect.any(Object),
      'botparty-thumbnails',
      ['robot-thumbnails/robot-1/1700000000000.webp'],
    );
    expect(cleared.thumbnailUrl).toBeNull();
  });

  it('reads thumbnails from object storage when the stored url points at the CDN', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';

    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      visibility: 'PUBLIC',
      thumbnailUrl: 'https://cdn.example.com/robot-thumbnails/robot-1/1700000000000.webp',
    });

    const transformToByteArray = jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]));
    const send = jest.fn().mockResolvedValue({
      Body: { transformToByteArray },
      ContentType: 'image/webp',
    });
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });

    const file = await service.read('robot-1', null);

    expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(file).toEqual({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    });
  });

  it('does not disclose private thumbnails to anonymous or foreign users', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';
    prisma.robot.findUnique.mockResolvedValue({
      id: 'private-robot',
      ownerId: 'owner-1',
      visibility: 'PRIVATE',
      thumbnailUrl: 'https://cdn.example.com/robot-thumbnails/private-robot/image.webp',
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    const send = jest.fn();
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });

    await expect(service.read('private-robot', null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.read('private-robot', 'foreign-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', 'owner-1', null],
    ['staff', 'staff-1', { role: 'MOD' }],
  ])('serves a private thumbnail to its %s', async (_label, requesterId, requester) => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';
    prisma.robot.findUnique.mockResolvedValue({
      id: 'private-robot',
      ownerId: 'owner-1',
      visibility: 'PRIVATE',
      thumbnailUrl: 'https://cdn.example.com/robot-thumbnails/private-robot/image.webp',
    });
    prisma.user.findUnique.mockResolvedValue(requester);
    const send = jest.fn().mockResolvedValue({
      Body: { transformToByteArray: jest.fn().mockResolvedValue(Uint8Array.from([7, 8])) },
      ContentType: 'image/webp',
    });
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });

    await expect(service.read('private-robot', requesterId)).resolves.toEqual({
      buffer: Buffer.from([7, 8]),
      contentType: 'image/webp',
      cacheControl: 'private, no-store',
    });
  });

  it('reads the latest object for a robot when the stored thumbnail url is legacy', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';

    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1',
      ownerId: 'owner-1',
      visibility: 'PUBLIC',
      thumbnailUrl: '/api/v1/robots/robot-1/thumbnail-image?v=123',
    });

    const send = jest.fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: 'robot-thumbnails/robot-1/1700000000000.webp', LastModified: new Date('2026-04-20T12:00:00Z') }],
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: jest.fn().mockResolvedValue(Uint8Array.from([4, 5, 6])) },
        ContentType: 'image/webp',
      });
    jest
      .spyOn(service as unknown as RobotThumbnailServiceTestAccess, '_createObjectStorageClient')
      .mockReturnValue({ send });

    const file = await service.read('robot-1', null);

    expect(file).toEqual({
      buffer: Buffer.from([4, 5, 6]),
      contentType: 'image/webp',
      cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    });
    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(GetObjectCommand));
  });
});
