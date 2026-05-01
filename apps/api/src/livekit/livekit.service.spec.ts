import type { EncodedFileOutput} from '@livekit/protocol';
import { TrackType } from '@livekit/protocol';
import type { ConfigService } from '@nestjs/config';
import { LivekitService } from './livekit.service';

const roomService = {
  listRooms: jest.fn(),
  listParticipants: jest.fn(),
};

const ingressService = {};

const egressService = {
  listEgress: jest.fn(),
  startTrackCompositeEgress: jest.fn(),
};

jest.mock('livekit-server-sdk', () => {
  class AccessToken {
    addGrant() {}

    async toJwt() {
      return 'jwt-token';
    }
  }

  return {
    AccessToken,
    RoomServiceClient: jest.fn(() => roomService),
    IngressClient: jest.fn(() => ingressService),
    EgressClient: jest.fn(() => egressService),
    IngressInput: {},
  };
});

describe('LivekitService', () => {
  const robotId = '00000000-0000-0000-0000-000000000001';

  let config: jest.Mocked<ConfigService>;
  let service: LivekitService;
  let values: Record<string, string | undefined>;

  beforeEach(() => {
    values = {
      LIVEKIT_API_KEY: 'livekit-key',
      LIVEKIT_API_SECRET: 'livekit-secret',
      LIVEKIT_URL: 'ws://livekit:7880',
    };

    config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (!value) {
          throw new Error(`Missing config: ${key}`);
        }
        return value;
      }),
    } as never;

    roomService.listRooms.mockResolvedValue([{ name: `robot-${robotId}` }]);
    roomService.listParticipants.mockResolvedValue([
      {
        identity: `robot-media:${robotId}:front`,
        tracks: [
          { sid: 'video-1', type: TrackType.VIDEO, muted: false },
          { sid: 'audio-1', type: TrackType.AUDIO, muted: false },
        ],
      },
    ]);
    egressService.listEgress.mockResolvedValue([]);
    egressService.startTrackCompositeEgress.mockResolvedValue({
      egressId: 'egress-1',
      request: {
        case: 'trackComposite',
        value: {
          videoTrackId: 'video-1',
          audioTrackId: 'audio-1',
        },
      },
      startedAt: BigInt(1_700_000_000_000),
    });

    service = new LivekitService(config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects recording start when object storage is not configured', async () => {
    await expect(service.startRoomRecording(robotId)).rejects.toThrow('Recording object storage is not configured');
    expect(egressService.startTrackCompositeEgress).not.toHaveBeenCalled();
  });

  it('uses S3-compatible outputs when recording object storage is configured', async () => {
    values.LIVEKIT_RECORDING_OBJECT_KEY_TEMPLATE = 'recordings/{room_name}-{time}.mp4';
    values.LIVEKIT_RECORDINGS_S3_BUCKET = 'botparty-recordings';
    values.LIVEKIT_RECORDINGS_S3_REGION = 'us-east-1';
    values.LIVEKIT_RECORDINGS_S3_ENDPOINT = 'http://minio:9000';
    values.LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID = 'botpartyminio';
    values.LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY = 'minio-secret';
    values.LIVEKIT_RECORDINGS_S3_FORCE_PATH_STYLE = 'true';

    await service.startRoomRecording(robotId);

    const output = egressService.startTrackCompositeEgress.mock.calls[0]?.[1] as EncodedFileOutput;
    expect(output.filepath).toBe(`robot-${robotId}-front-{time}.mp4`);
    expect(output.output.case).toBe('s3');
    if (output.output.case !== 's3') {
      throw new Error('Expected an S3 recording output');
    }
    expect(output.output.value.bucket).toBe('botparty-recordings');
    expect(output.output.value.endpoint).toBe('http://minio:9000');
    expect(output.output.value.forcePathStyle).toBe(true);
  });
});