import { GetObjectCommand } from '@aws-sdk/client-s3';
import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { RecordingAdminService } from './recording-admin.service';

const recording = {
  id: 'recording-1',
  sessionId: 'session-1',
  robotId: '00000000-0000-0000-0000-000000000001',
  cameraId: 'front',
  objectKey: 'recordings/session-1/front.mp4',
  startedAt: new Date('2026-04-20T12:00:00Z'),
  endedAt: new Date('2026-04-20T12:05:00Z'),
};

describe('RecordingAdminService', () => {
  let service: RecordingAdminService;
  let prisma: {
    user: { findUnique: jest.Mock };
    recording: { findMany: jest.Mock; findUnique: jest.Mock };
    session: { findFirst: jest.Mock };
  };
  let configValues: Record<string, string | undefined>;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
      recording: {
        findMany: jest.fn().mockResolvedValue([recording]),
        findUnique: jest.fn().mockResolvedValue(recording),
      },
      session: { findFirst: jest.fn() },
    };
    configValues = { JWT_SECRET: 'recording-test-signing-secret' };

    service = new RecordingAdminService(
      prisma,
      {
        getRoomRecordingStatus: jest.fn(),
        startRoomRecording: jest.fn(),
        stopRoomRecording: jest.fn(),
      },
      {
        get: jest.fn((key: string) => configValues[key]),
        getOrThrow: jest.fn((key: string) => {
          const value = configValues[key];
          if (!value) throw new Error(`Missing ${key}`);
          return value;
        }),
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function configureStorage() {
    configValues['LIVEKIT_RECORDINGS_S3_BUCKET'] = 'botparty-recordings';
    configValues['LIVEKIT_RECORDINGS_S3_REGION'] = 'us-east-1';
    configValues['LIVEKIT_RECORDINGS_S3_ENDPOINT'] = 'http://seaweedfs:8333';
    configValues['LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID'] = 'botparty';
    configValues['LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY'] = 'object-storage-secret';
  }

  it('lists only indexed recording metadata without scanning object storage', async () => {
    const files = await service.listAdminRecordings('staff-1');

    expect(prisma.recording.findMany).toHaveBeenCalledWith({
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
    expect(files).toEqual([
      expect.objectContaining({
        fileName: 'front.mp4',
        robotId: recording.robotId,
        cameraId: 'front',
        playbackPath: expect.stringContaining(
          '/api/v1/moderation/admin/recordings/recording-1/signed',
        ),
      }),
    ]);
  });

  it('rejects moderators at the service boundary for admin recordings', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'MOD' });

    await expect(service.listAdminRecordings('moderator-1')).rejects.toThrow('Access denied');
    expect(prisma.recording.findMany).not.toHaveBeenCalled();
  });

  it('streams an indexed recording by its exact object key', async () => {
    configureStorage();
    const send = jest.fn().mockResolvedValue({
      Body: Readable.from(Buffer.from('video-data')),
      ContentType: 'video/mp4',
    });
    jest.spyOn(service, 'createObjectStorageClient').mockReturnValue({ send });

    const file = await service.streamAdminRecording('recording-1', 'staff-1');

    expect(prisma.recording.findUnique).toHaveBeenCalledWith({
      where: { id: 'recording-1' },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(file).toBeInstanceOf(StreamableFile);
  });

  it('does not fall back to a bucket scan for an unknown recording', async () => {
    configureStorage();
    prisma.recording.findUnique.mockResolvedValue(null);
    const send = jest.fn();
    jest.spyOn(service, 'createObjectStorageClient').mockReturnValue({ send });

    await expect(service.streamAdminRecording('missing-recording', 'staff-1')).rejects.toThrow(
      'Recording not found',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('streams recordings through a valid short-lived signed playback URL', async () => {
    configureStorage();
    configValues['JWT_SECRET'] = 'signing-secret';
    const send = jest.fn().mockResolvedValue({
      Body: Readable.from(Buffer.from('video-data')),
      ContentType: 'video/mp4',
    });
    jest.spyOn(service, 'createObjectStorageClient').mockReturnValue({ send });

    const [entry] = await service.listAdminRecordings('staff-1');
    expect(entry).toBeDefined();
    if (!entry) throw new Error('Expected an admin recording');
    const playbackUrl = new URL(`http://localhost${entry.playbackPath}`);
    const file = await service.streamSignedAdminRecording(
      'recording-1',
      playbackUrl.searchParams.get('expires') ?? undefined,
      playbackUrl.searchParams.get('signature') ?? undefined,
    );

    expect(file).toBeInstanceOf(StreamableFile);
    expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  });
});
