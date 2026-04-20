import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { RecordingAdminService } from './recording-admin.service';

describe('RecordingAdminService', () => {
  let service: RecordingAdminService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
  };
  let configValues: Record<string, string | undefined>;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
      },
    };
    configValues = {};

    service = new RecordingAdminService(
      prisma as never,
      {} as never,
      {
        get: jest.fn((key: string) => configValues[key]),
      } as never,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  it('rejects listing recordings when object storage is not configured', async () => {
    await expect(service.listAdminRecordings('staff-1')).rejects.toThrow('Recording object storage is not configured');
  });

  it('lists recording objects from S3-compatible storage using basename metadata', async () => {
    configValues.LIVEKIT_RECORDINGS_S3_BUCKET = 'botparty-recordings';
    configValues.LIVEKIT_RECORDINGS_S3_REGION = 'us-east-1';
    configValues.LIVEKIT_RECORDINGS_S3_ENDPOINT = 'http://minio:9000';
    configValues.LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID = 'botpartyminio';
    configValues.LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY = 'minio-secret';

    const send = jest.fn().mockResolvedValue({
      Contents: [
        {
          Key: 'recordings/robot-00000000-0000-0000-0000-000000000001-front-2026-04-20T120000.mp4',
          Size: 2048,
          LastModified: new Date('2026-04-20T12:05:00Z'),
        },
      ],
    });
    jest.spyOn(service as never, '_createObjectStorageClient').mockReturnValue({ send } as never);

    const files = await service.listAdminRecordings('staff-1');

    expect(send).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
    expect(files).toEqual([
      expect.objectContaining({
        fileName: 'robot-00000000-0000-0000-0000-000000000001-front-2026-04-20T120000.mp4',
        sizeBytes: 2048,
        robotId: '00000000-0000-0000-0000-000000000001',
        cameraId: 'front',
      }),
    ]);
  });

  it('streams recordings from S3-compatible storage by matching basename when objects use a prefix', async () => {
    configValues.LIVEKIT_RECORDINGS_S3_BUCKET = 'botparty-recordings';
    configValues.LIVEKIT_RECORDINGS_S3_REGION = 'us-east-1';
    configValues.LIVEKIT_RECORDINGS_S3_ENDPOINT = 'http://minio:9000';
    configValues.LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID = 'botpartyminio';
    configValues.LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY = 'minio-secret';

    const send = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }))
      .mockResolvedValueOnce({
        Contents: [{ Key: 'recordings/robot-00000000-0000-0000-0000-000000000001-front-2026-04-20T120000.mp4' }],
      })
      .mockResolvedValueOnce({
        Body: Readable.from(Buffer.from('video-data')),
        ContentType: 'video/mp4',
      });
    jest.spyOn(service as never, '_createObjectStorageClient').mockReturnValue({ send } as never);

    const file = await service.streamAdminRecording(
      'robot-00000000-0000-0000-0000-000000000001-front-2026-04-20T120000.mp4',
      'staff-1',
    );

    expect(send).toHaveBeenNthCalledWith(1, expect.any(GetObjectCommand));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(ListObjectsV2Command));
    expect(send).toHaveBeenNthCalledWith(3, expect.any(GetObjectCommand));
    expect(file).toBeInstanceOf(StreamableFile);
  });
});