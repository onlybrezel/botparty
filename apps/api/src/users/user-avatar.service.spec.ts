import {
  DeleteObjectsCommand,
  type GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { UserAvatarService } from './user-avatar.service';
import {
  createS3CompatibleStorageClient,
  resolveS3CompatibleStorageConfig,
} from '../common/s3-compatible-storage';

jest.mock('../common/s3-compatible-storage', () => ({
  createS3CompatibleStorageClient: jest.fn(),
  resolveS3CompatibleStorageConfig: jest.fn(),
}));

const USER_ID = '10000000-0000-4000-8000-000000000001';
const VALID_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9pUAAAAASUVORK5CYII=';
const storage = {
  bucket: 'botparty-thumbnails',
  region: 'us-east-1',
  endpoint: 'http://minio:9000',
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
  forcePathStyle: true,
};

describe('UserAvatarService', () => {
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let storageDeletion: { enqueue: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: USER_ID, isActive: true }),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: USER_ID, avatarUrl: data.avatarUrl })),
      },
    };
    prisma = {
      ...transactionClient,
      $transaction: jest.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
    };
    storageDeletion = { enqueue: jest.fn().mockResolvedValue(undefined) };
    jest.mocked(resolveS3CompatibleStorageConfig).mockReturnValue(storage);
  });

  function service() {
    return new UserAvatarService(prisma as never, new ConfigService(), storageDeletion as never);
  }

  it('stores a normalized avatar privately and exposes only the API proxy URL', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: `avatars/${USER_ID}/old.webp`, LastModified: new Date('2026-01-01') }],
      })
      .mockResolvedValueOnce({});
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({ send } as never);

    const result = await service().save(USER_ID, VALID_PNG_DATA_URL);

    expect(send).toHaveBeenNthCalledWith(1, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(PutObjectCommand));
    expect(result).toEqual({ id: USER_ID, avatarUrl: `/api/v1/users/${USER_ID}/avatar-image` });
    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      expect.any(Object),
      storage.bucket,
      [`avatars/${USER_ID}/old.webp`],
    );
  });

  it('serves the newest stored avatar and rejects cleared profiles before storage access', async () => {
    prisma.user.findUnique.mockResolvedValue({
      avatarUrl: `/api/v1/users/${USER_ID}/avatar-image`,
      isActive: true,
    });
    const send = jest.fn()
      .mockResolvedValueOnce({
        Contents: [
          { Key: `avatars/${USER_ID}/old.webp`, LastModified: new Date('2026-01-01') },
          { Key: `avatars/${USER_ID}/new.webp`, LastModified: new Date('2026-02-01') },
        ],
      })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])) },
        ContentType: 'image/webp',
      });
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({ send } as never);

    await expect(service().read(USER_ID)).resolves.toEqual({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'image/webp',
    });
    const get = send.mock.calls[1]?.[0] as GetObjectCommand;
    expect(get.input.Key).toBe(`avatars/${USER_ID}/new.webp`);

    prisma.user.findUnique.mockResolvedValue({ avatarUrl: null, isActive: true });
    await expect(service().read(USER_ID)).rejects.toThrow('Avatar not found');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('clears the database reference and queues exact existing objects in one transaction', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Contents: [{ Key: `avatars/${USER_ID}/avatar.webp` }],
    });
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({ send } as never);

    await expect(service().clear(USER_ID)).resolves.toEqual({ id: USER_ID, avatarUrl: null });

    expect(storageDeletion.enqueue).toHaveBeenCalledWith(
      expect.any(Object),
      storage.bucket,
      [`avatars/${USER_ID}/avatar.webp`],
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('removes an uploaded object when the database update fails', async () => {
    prisma.user.update.mockRejectedValue(new Error('database unavailable'));
    const send = jest.fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Errors: [] });
    jest.mocked(createS3CompatibleStorageClient).mockReturnValue({ send } as never);

    await expect(service().save(USER_ID, VALID_PNG_DATA_URL)).rejects.toThrow('database unavailable');

    expect(send).toHaveBeenNthCalledWith(2, expect.any(PutObjectCommand));
    expect(send).toHaveBeenNthCalledWith(3, expect.any(DeleteObjectsCommand));
    expect(storageDeletion.enqueue).not.toHaveBeenCalled();
  });
});
