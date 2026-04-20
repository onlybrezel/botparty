import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { rm } from 'node:fs/promises';
import { RobotThumbnailService } from './robot-thumbnail.service';

const VALID_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9pUAAAAASUVORK5CYII=';

describe('RobotThumbnailService', () => {
  let service: RobotThumbnailService;
  let prisma: {
    robot: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    prisma = {
      robot: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new RobotThumbnailService(prisma as never);
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

  it('uploads thumbnails to S3-compatible storage and returns the public CDN url', async () => {
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
    jest.spyOn(service as any, '_createObjectStorageClient').mockReturnValue({ send } as never);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const saved = await service.save('robot-1', 'owner-1', VALID_PNG_DATA_URL);

    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(PutObjectCommand));
    expect(saved.thumbnailUrl).toBe('https://cdn.example.com/robot-thumbnails/robot-1/1700000000000.webp');

    const putInput = send.mock.calls[1]?.[0].input as { CacheControl?: string; ContentType?: string };
    expect(putInput.ContentType).toBe('image/webp');
    expect(putInput.CacheControl).toBe('public, max-age=31536000, immutable');
  });

  it('clears existing object-storage thumbnails before removing the database url', async () => {
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
      .mockResolvedValueOnce({ Contents: [{ Key: 'robot-thumbnails/robot-1/1700000000000.webp' }] })
      .mockResolvedValueOnce({});
    jest.spyOn(service as any, '_createObjectStorageClient').mockReturnValue({ send } as never);

    const cleared = await service.clear('robot-1', 'owner-1');

    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(DeleteObjectsCommand));
    expect(cleared.thumbnailUrl).toBeNull();
  });

  it('reads thumbnails from object storage when the stored url points at the CDN', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';

    prisma.robot.findUnique.mockResolvedValue({
      thumbnailUrl: 'https://cdn.example.com/robot-thumbnails/robot-1/1700000000000.webp',
    });

    const transformToByteArray = jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]));
    const send = jest.fn().mockResolvedValue({
      Body: { transformToByteArray },
      ContentType: 'image/webp',
    });
    jest.spyOn(service as any, '_createObjectStorageClient').mockReturnValue({ send } as never);

    const file = await service.read('robot-1');

    expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(file).toEqual({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/webp',
    });
  });

  it('reads the latest object for a robot when the stored thumbnail url is legacy', async () => {
    process.env.THUMBNAIL_S3_BUCKET = 'botparty-thumbnails';
    process.env.THUMBNAIL_S3_REGION = 'auto';
    process.env.THUMBNAIL_S3_ACCESS_KEY_ID = 'access-key';
    process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.THUMBNAIL_PUBLIC_BASE_URL = 'https://cdn.example.com';

    prisma.robot.findUnique.mockResolvedValue({ thumbnailUrl: '/api/v1/robots/robot-1/thumbnail-image?v=123' });

    const send = jest.fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: 'robot-thumbnails/robot-1/1700000000000.webp', LastModified: new Date('2026-04-20T12:00:00Z') }],
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: jest.fn().mockResolvedValue(Uint8Array.from([4, 5, 6])) },
        ContentType: 'image/webp',
      });
    jest.spyOn(service as any, '_createObjectStorageClient').mockReturnValue({ send } as never);

    const file = await service.read('robot-1');

    expect(file).toEqual({
      buffer: Buffer.from([4, 5, 6]),
      contentType: 'image/webp',
    });
    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(GetObjectCommand));
  });
});