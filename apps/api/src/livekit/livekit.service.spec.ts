import type { EncodedFileOutput } from '@livekit/protocol';
import { TrackType } from '@livekit/protocol';
import type { ConfigService } from '@nestjs/config';
import { LivekitService } from './livekit.service';

const mockRoomService = {
  listRooms: jest.fn(),
  listParticipants: jest.fn(),
  removeParticipant: jest.fn(),
};

const mockIngressService = {
  listIngress: jest.fn(),
  updateIngress: jest.fn(),
  createIngress: jest.fn(),
  deleteIngress: jest.fn(),
};

const mockEgressService = {
  listEgress: jest.fn(),
  startTrackCompositeEgress: jest.fn(),
  stopEgress: jest.fn(),
};

const mockTokens: Array<{
  key: string;
  secret: string;
  options: Record<string, unknown>;
  grants: Record<string, unknown>[];
}> = [];

jest.mock('livekit-server-sdk', () => {
  class AccessToken {
    private readonly entry: (typeof mockTokens)[number];

    constructor(key: string, secret: string, options: Record<string, unknown>) {
      this.entry = { key, secret, options, grants: [] };
      mockTokens.push(this.entry);
    }

    addGrant(grant: Record<string, unknown>) {
      this.entry.grants.push(grant);
    }

    async toJwt() {
      return `jwt-${String(this.entry.options.identity)}`;
    }
  }

  return {
    AccessToken,
    RoomServiceClient: jest.fn(() => mockRoomService),
    IngressClient: jest.fn(() => mockIngressService),
    EgressClient: jest.fn(() => mockEgressService),
    IngressInput: { WHIP_INPUT: 'WHIP_INPUT' },
  };
});

describe('LivekitService', () => {
  const robotId = '00000000-0000-0000-0000-000000000001';
  const roomName = `robot-${robotId}`;
  const defaultParticipant = {
    identity: `robot-media:${robotId}:front`,
    tracks: [
      { sid: 'video-1', type: TrackType.VIDEO, muted: false },
      { sid: 'audio-1', type: TrackType.AUDIO, muted: false },
    ],
  };
  const defaultEgress = {
    egressId: 'egress-1',
    request: {
      case: 'trackComposite',
      value: { videoTrackId: 'video-1', audioTrackId: 'audio-1' },
    },
    startedAt: BigInt(1_700_000_000_000),
  };
  const prisma = {
    recording: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  let values: Record<string, string | undefined>;
  let config: jest.Mocked<ConfigService>;
  let service: LivekitService;

  function instantiate(overrides: Record<string, string | undefined> = {}) {
    Object.assign(values, overrides);
    service = new LivekitService(config, prisma as never);
    return service;
  }

  function configureStorage() {
    Object.assign(values, {
      LIVEKIT_RECORDING_OBJECT_KEY_TEMPLATE: 'sessions/{session_id}/{camera_id}-{time}.mp4',
      LIVEKIT_RECORDINGS_S3_BUCKET: 'botparty-recordings',
      LIVEKIT_RECORDINGS_S3_REGION: 'us-east-1',
      LIVEKIT_RECORDINGS_S3_ENDPOINT: 'http://minio:9000',
      LIVEKIT_RECORDINGS_S3_ACCESS_KEY_ID: 'botpartyminio',
      LIVEKIT_RECORDINGS_S3_SECRET_ACCESS_KEY: 'minio-secret',
      LIVEKIT_RECORDINGS_S3_FORCE_PATH_STYLE: 'true',
    });
  }

  function ingress(overrides: Record<string, unknown> = {}) {
    return {
      ingressId: 'ingress-front',
      inputType: 'WHIP_INPUT',
      url: 'https://ingress.example/whip/',
      streamKey: '/secret-key',
      participantIdentity: `robot-media:${robotId}:front`,
      participantName: 'Robot Front',
      enableTranscoding: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockTokens.length = 0;
    values = {
      LIVEKIT_API_KEY: 'livekit-key',
      LIVEKIT_API_SECRET: 'livekit-secret',
      LIVEKIT_URL: 'ws://livekit:7880',
    };
    config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (!value) throw new Error(`Missing config: ${key}`);
        return value;
      }),
    } as never;

    mockRoomService.listRooms.mockResolvedValue([{ name: roomName }]);
    mockRoomService.listParticipants.mockResolvedValue([defaultParticipant]);
    mockRoomService.removeParticipant.mockResolvedValue(undefined);
    mockIngressService.listIngress.mockResolvedValue([]);
    mockIngressService.updateIngress.mockImplementation((_id, options) =>
      Promise.resolve(ingress(options)),
    );
    mockIngressService.createIngress.mockImplementation((_type, options) =>
      Promise.resolve(ingress(options)),
    );
    mockIngressService.deleteIngress.mockResolvedValue(undefined);
    mockEgressService.listEgress.mockResolvedValue([]);
    mockEgressService.startTrackCompositeEgress.mockResolvedValue(defaultEgress);
    mockEgressService.stopEgress.mockResolvedValue(defaultEgress);
    prisma.recording.create.mockResolvedValue({ id: 'recording-1' });
    prisma.recording.updateMany.mockResolvedValue({ count: 1 });

    instantiate();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('clients and grants', () => {
    it('converts ws/wss service URLs and preserves invalid custom URLs', () => {
      const sdk = jest.requireMock('livekit-server-sdk') as {
        RoomServiceClient: jest.Mock;
      };
      expect(sdk.RoomServiceClient).toHaveBeenLastCalledWith(
        'http://livekit:7880',
        'livekit-key',
        'livekit-secret',
      );
      instantiate({ LIVEKIT_URL: 'wss://livekit.example/' });
      expect(sdk.RoomServiceClient).toHaveBeenLastCalledWith(
        'https://livekit.example',
        'livekit-key',
        'livekit-secret',
      );
      instantiate({ LIVEKIT_URL: 'http://livekit.internal:7880/' });
      expect(sdk.RoomServiceClient).toHaveBeenLastCalledWith(
        'http://livekit.internal:7880',
        'livekit-key',
        'livekit-secret',
      );
      instantiate({ LIVEKIT_URL: 'not a url' });
      expect(sdk.RoomServiceClient).toHaveBeenLastCalledWith(
        'not a url',
        'livekit-key',
        'livekit-secret',
      );
    });

    it('issues a short-lived robot command/media token with exact grants', async () => {
      await expect(service.generateRobotToken(robotId, 'Rover')).resolves.toBe(
        `jwt-robot-${robotId}`,
      );
      expect(mockTokens[0]).toEqual({
        key: 'livekit-key',
        secret: 'livekit-secret',
        options: { identity: `robot-${robotId}`, name: 'Rover', ttl: '15m' },
        grants: [
          {
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
          },
        ],
      });
    });

    it('issues isolated publisher tokens and ignores blank camera ids', async () => {
      await expect(
        service.generateRobotPublisherTokens(robotId, 'Rover', [
          ' front_cam ',
          ' ',
          'rear-deck',
        ]),
      ).resolves.toEqual({
        front_cam: `jwt-robot-media:${robotId}:front_cam`,
        'rear-deck': `jwt-robot-media:${robotId}:rear-deck`,
      });
      expect(mockTokens).toHaveLength(2);
      expect(mockTokens[0]?.options).toEqual(
        expect.objectContaining({ name: 'Rover Front Cam', ttl: '15m' }),
      );
      expect(mockTokens[0]?.grants[0]).toEqual(
        expect.objectContaining({ canPublish: true, canSubscribe: false, canPublishData: false }),
      );
    });

    it('limits controller tokens to two minutes and prevents viewer data publishing', async () => {
      await service.generateViewerToken(robotId, 'user-1', 'Alice', true);
      await service.generateViewerToken(robotId, 'user-2', 'Bob', false);
      expect(mockTokens[0]?.options).toEqual(
        expect.objectContaining({ identity: 'user-user-1', ttl: '2m' }),
      );
      expect(mockTokens[0]?.grants[0]).toHaveProperty('canPublishData', true);
      expect(mockTokens[1]?.options).toEqual(expect.objectContaining({ ttl: '15m' }));
      expect(mockTokens[1]?.grants[0]).toHaveProperty('canPublishData', false);
    });

    it('returns public URL overrides and delegates room/participant queries', async () => {
      expect(service.getLivekitUrl()).toBe('ws://livekit:7880');
      values.LIVEKIT_PUBLIC_URL = 'wss://media.example';
      expect(service.getLivekitUrl()).toBe('wss://media.example');
      await service.listRooms(['one']);
      await service.listParticipants('one');
      expect(mockRoomService.listRooms).toHaveBeenCalledWith(['one']);
      expect(mockRoomService.listParticipants).toHaveBeenCalledWith('one');
    });

    it('revokes a controller and treats an already absent participant as idempotent', async () => {
      await service.revokeController(robotId, 'user-1');
      expect(mockRoomService.removeParticipant).toHaveBeenCalledWith(roomName, 'user-user-1');
      mockRoomService.removeParticipant.mockRejectedValueOnce(new Error('not found'));
      await expect(service.revokeController(robotId, 'user-1')).resolves.toBeUndefined();
    });
  });

  describe('recording lifecycle', () => {
    it('reports inactive missing rooms and maps/sorts active camera sessions', async () => {
      mockRoomService.listRooms.mockResolvedValueOnce([]);
      mockEgressService.listEgress.mockResolvedValueOnce([]);
      await expect(service.getRoomRecordingStatus(robotId)).resolves.toEqual({
        roomName,
        active: false,
        activeCount: 0,
        egressId: null,
        startedAt: null,
        sessions: [],
      });
      expect(mockRoomService.listParticipants).not.toHaveBeenCalled();

      mockRoomService.listRooms.mockResolvedValueOnce([{ name: roomName, activeRecording: false }]);
      mockRoomService.listParticipants.mockResolvedValueOnce([
        defaultParticipant,
        {
          identity: `robot-media:${robotId}:back`,
          tracks: [{ sid: 'video-2', type: TrackType.VIDEO, muted: false }],
        },
      ]);
      mockEgressService.listEgress.mockResolvedValueOnce([
        defaultEgress,
        {
          egressId: 'egress-2',
          request: {
            case: 'trackComposite',
            value: { videoTrackId: 'video-2', audioTrackId: '' },
          },
          startedAt: BigInt(1_700_000_001),
        },
        { request: { case: 'roomComposite', value: {} }, startedAt: null },
      ]);
      const status = await service.getRoomRecordingStatus(robotId);
      expect(status.active).toBe(true);
      expect(status.activeCount).toBe(2);
      expect(status.sessions.map((entry) => entry.cameraId)).toEqual(['back', 'front']);
      expect(status.sessions[0]?.audioTrackId).toBeNull();
    });

    it('rejects start for a missing room, missing tracks, or missing storage', async () => {
      mockRoomService.listRooms.mockResolvedValueOnce([]);
      await expect(service.startRoomRecording(robotId, 'session-1')).rejects.toThrow(
        'Robot room is not active',
      );

      mockRoomService.listParticipants.mockResolvedValueOnce([
        { identity: 'robot-media', tracks: [{ sid: 'muted', type: TrackType.VIDEO, muted: true }] },
      ]);
      await expect(service.startRoomRecording(robotId, 'session-1')).rejects.toThrow(
        'No published tracks available to record yet',
      );

      await expect(service.startRoomRecording(robotId, 'session-1')).rejects.toThrow(
        'Recording object storage is not configured',
      );
      expect(mockEgressService.startTrackCompositeEgress).not.toHaveBeenCalled();
    });

    it('returns current status without creating duplicate egresses', async () => {
      mockEgressService.listEgress.mockResolvedValueOnce([defaultEgress]);
      const status = await service.startRoomRecording(robotId, 'session-1');
      expect(status).toEqual(expect.objectContaining({ active: true, activeCount: 1 }));
      expect(mockEgressService.startTrackCompositeEgress).not.toHaveBeenCalled();
    });

    it('starts one S3 egress per camera and persists only sessions with IDs', async () => {
      configureStorage();
      values.LIVEKIT_RECORDINGS_S3_SESSION_TOKEN = 'temporary-token';
      mockRoomService.listParticipants.mockResolvedValueOnce([
        defaultParticipant,
        {
          identity: `robot-media:${robotId}:back`,
          tracks: [{ sid: 'video-2', type: TrackType.VIDEO, muted: false }],
        },
        {
          identity: 'viewer',
          tracks: [{ sid: '', type: TrackType.VIDEO, muted: false }],
        },
      ]);
      mockEgressService.startTrackCompositeEgress
        .mockResolvedValueOnce({ ...defaultEgress, egressId: '' })
        .mockResolvedValueOnce({
          ...defaultEgress,
          egressId: 'egress-front',
          request: {
            case: 'trackComposite',
            value: { videoTrackId: 'video-1', audioTrackId: 'audio-1' },
          },
        });

      const status = await service.startRoomRecording(robotId, ' session/unsafe ');

      expect(mockEgressService.startTrackCompositeEgress).toHaveBeenCalledTimes(2);
      const outputs = mockEgressService.startTrackCompositeEgress.mock.calls.map(
        (call) => call[1] as EncodedFileOutput,
      );
      expect(outputs.map((output) => output.filepath)).toEqual([
        'sessions/session_unsafe/back-{time}.mp4',
        'sessions/session_unsafe/front-{time}.mp4',
      ]);
      expect(outputs[0]?.output.case).toBe('s3');
      if (outputs[0]?.output.case !== 's3') throw new Error('Expected S3 output');
      expect(outputs[0].output.value).toEqual(
        expect.objectContaining({
          bucket: 'botparty-recordings',
          endpoint: 'http://minio:9000',
          forcePathStyle: true,
          sessionToken: 'temporary-token',
        }),
      );
      expect(prisma.recording.create).toHaveBeenCalledTimes(1);
      expect(status.activeCount).toBe(1);
    });

    it('records a default-identity video without an audio track', async () => {
      configureStorage();
      mockRoomService.listParticipants.mockResolvedValueOnce([
        {
          identity: 'robot-media',
          tracks: [{ sid: 'video-only', type: TrackType.VIDEO, muted: false }],
        },
      ]);
      mockEgressService.startTrackCompositeEgress.mockResolvedValueOnce({
        ...defaultEgress,
        egressId: 'egress-video-only',
      });

      await service.startRoomRecording(robotId, 'session-video');

      expect(mockEgressService.startTrackCompositeEgress).toHaveBeenCalledWith(
        roomName,
        expect.anything(),
        { audioTrackId: undefined, videoTrackId: 'video-only' },
      );
    });

    it('stops every active egress, waits for shutdown, and closes persisted rows', async () => {
      mockEgressService.listEgress
        .mockResolvedValueOnce([defaultEgress, { ...defaultEgress, egressId: '' }])
        .mockResolvedValueOnce([]);
      const status = await service.stopRoomRecording(robotId);
      expect(mockEgressService.stopEgress).toHaveBeenCalledWith('egress-1');
      expect(prisma.recording.updateMany).toHaveBeenCalledWith({
        where: { egressId: { in: ['egress-1'] }, endedAt: null },
        data: { endedAt: expect.any(Date) },
      });
      expect(status).toEqual(expect.objectContaining({ active: false, activeCount: 0 }));
    });

    it('stops cleanly when no egress is active and surfaces stop-wait timeouts', async () => {
      await service.stopRoomRecording(robotId);
      expect(prisma.recording.updateMany).not.toHaveBeenCalled();

      (service as any).egressStopWaitMs = 0;
      await expect((service as any).waitForActiveEgressCount(roomName, 0)).rejects.toThrow(
        'Timed out waiting',
      );
    });
  });

  describe('WHIP ingress lifecycle', () => {
    it('creates the default ingress, upgrades old ingress, and reuses current ingress', async () => {
      mockIngressService.createIngress.mockResolvedValueOnce(ingress());
      await expect(service.ensureRobotWhipIngress(robotId, 'Rover')).resolves.toEqual(
        expect.objectContaining({ endpointUrl: 'https://ingress.example/whip/secret-key' }),
      );

      mockIngressService.listIngress.mockResolvedValueOnce([
        ingress({ participantIdentity: `robot-media-${robotId}` }),
      ]);
      mockIngressService.updateIngress.mockResolvedValueOnce(ingress({ enableTranscoding: true }));
      await expect(service.ensureRobotWhipIngress(robotId, 'Rover')).resolves.toEqual(
        expect.objectContaining({ enableTranscoding: true }),
      );

      mockIngressService.listIngress.mockResolvedValueOnce([
        ingress({
          enableTranscoding: true,
          url: 'https://ingress.example/whip/secret-key',
          participantIdentity: `robot-media-${robotId}`,
        }),
      ]);
      await expect(service.ensureRobotWhipIngress(robotId, 'Rover')).resolves.toEqual(
        expect.objectContaining({ endpointUrl: 'https://ingress.example/whip/secret-key' }),
      );
    });

    it('returns null for invalid SDK responses and both Error/non-Error failures', async () => {
      mockIngressService.createIngress.mockResolvedValueOnce(ingress({ streamKey: '' }));
      await expect(service.ensureRobotWhipIngress(robotId, 'Rover')).resolves.toBeNull();
      mockIngressService.listIngress.mockRejectedValueOnce(new Error('offline'));
      await expect(service.ensureRobotWhipIngress(robotId, 'Rover')).resolves.toBeNull();
      mockIngressService.listIngress.mockRejectedValueOnce('offline');
      await expect(service.ensureRobotWhipIngress(robotId, 'Rover')).resolves.toBeNull();
    });

    it('normalizes camera ids and creates or updates camera-specific ingresses', async () => {
      await expect(
        service.ensureRobotCameraWhipIngress(robotId, 'Rover', ' Front Camera!! ', ' Main ', true),
      ).resolves.toEqual(
        expect.objectContaining({ cameraId: 'front-camera', isLive: false }),
      );
      expect(mockIngressService.createIngress).toHaveBeenCalledWith(
        'WHIP_INPUT',
        expect.objectContaining({
          participantIdentity: `robot-media:${robotId}:front-camera`,
          participantName: 'Rover Main',
          enableTranscoding: true,
        }),
      );

      mockIngressService.listIngress.mockResolvedValueOnce([ingress()]);
      mockRoomService.listParticipants.mockResolvedValueOnce([
        { identity: `robot-media:${robotId}:front`, tracks: [] },
      ]);
      await expect(
        service.ensureRobotCameraWhipIngress(robotId, 'Rover', 'front'),
      ).resolves.toEqual(expect.objectContaining({ cameraId: 'front', isLive: true }));
      expect(mockIngressService.updateIngress).toHaveBeenCalled();
    });

    it('rejects empty ids and handles invalid mappings, participant errors, and provisioning errors', async () => {
      await expect(service.ensureRobotCameraWhipIngress(robotId, 'Rover', ' !!! ')).resolves.toBeNull();
      mockIngressService.createIngress.mockResolvedValueOnce(ingress({ ingressId: '' }));
      await expect(
        service.ensureRobotCameraWhipIngress(robotId, 'Rover', 'side'),
      ).resolves.toBeNull();

      mockRoomService.listParticipants.mockRejectedValueOnce(new Error('room ended'));
      await expect(
        service.ensureRobotCameraWhipIngress(robotId, 'Rover', 'side'),
      ).resolves.toEqual(expect.objectContaining({ isLive: false }));

      mockIngressService.listIngress.mockRejectedValueOnce('offline');
      await expect(
        service.ensureRobotCameraWhipIngress(robotId, 'Rover', 'side'),
      ).resolves.toBeNull();
      mockIngressService.listIngress.mockRejectedValueOnce(new Error('offline'));
      await expect(
        service.ensureRobotCameraWhipIngress(robotId, 'Rover', 'side'),
      ).resolves.toBeNull();
    });

    it('lists live camera ingresses in camera order and filters other/invalid ingresses', async () => {
      mockIngressService.listIngress.mockResolvedValueOnce([
        ingress({
          ingressId: 'back',
          participantIdentity: `robot-media:${robotId}:back`,
        }),
        ingress({ ingressId: 'invalid', streamKey: '' }),
        ingress({ ingressId: 'rtmp', inputType: 'RTMP_INPUT' }),
        ingress({
          ingressId: 'front',
          participantIdentity: `robot-media:${robotId}:front`,
        }),
        ingress({ ingressId: 'default', participantIdentity: `robot-media-${robotId}` }),
      ]);
      mockRoomService.listParticipants.mockResolvedValueOnce([
        { identity: `robot-media:${robotId}:front`, tracks: [] },
        { identity: ' ', tracks: [] },
      ]);
      const result = await service.listRobotCameraIngresses(robotId);
      expect(result.map((entry) => entry.cameraId)).toEqual([null, 'back', 'front']);
      expect(result.find((entry) => entry.cameraId === 'front')?.isLive).toBe(true);
      expect(result.find((entry) => entry.cameraId === 'back')?.isLive).toBe(false);
    });

    it('deletes only camera-specific WHIP ingresses owned by the robot', async () => {
      await expect(service.deleteRobotCameraIngress(robotId, 'missing')).resolves.toBeNull();
      mockIngressService.listIngress.mockResolvedValueOnce([
        ingress({ ingressId: 'rtmp', inputType: 'RTMP_INPUT' }),
      ]);
      await expect(service.deleteRobotCameraIngress(robotId, 'rtmp')).resolves.toBeNull();
      mockIngressService.listIngress.mockResolvedValueOnce([
        ingress({ ingressId: 'default', participantIdentity: `robot-media-${robotId}` }),
      ]);
      await expect(service.deleteRobotCameraIngress(robotId, 'default')).resolves.toBeNull();
      mockIngressService.listIngress.mockResolvedValueOnce([
        ingress({ ingressId: 'empty-identity', participantIdentity: undefined }),
      ]);
      await expect(
        service.deleteRobotCameraIngress(robotId, 'empty-identity'),
      ).resolves.toBeNull();
      mockIngressService.listIngress.mockResolvedValueOnce([ingress()]);
      await expect(service.deleteRobotCameraIngress(robotId, 'ingress-front')).resolves.toBe('front');
      expect(mockIngressService.deleteIngress).toHaveBeenCalledWith('ingress-front');
    });
  });

  describe('pure mapping and timeout behavior', () => {
    it('maps endpoint, identity, and sanitized camera/path variants', () => {
      const internal = service as any;
      expect(internal.buildIngressEndpointUrl('https://host/path/', '/key')).toBe(
        'https://host/path/key',
      );
      expect(internal.buildIngressEndpointUrl('https://host/path/key', 'key')).toBe(
        'https://host/path/key',
      );
      expect(internal.buildIngressEndpointUrl('https://host/path/', ' ')).toBe(
        'https://host/path',
      );
      expect(internal.sanitizeCameraId('')).toBe('');
      expect(internal.sanitizeCameraId(`___A${'x'.repeat(80)}!!!`)).toHaveLength(64);
      expect(internal.sanitizePathSegment(' ... ')).toBe('camera');
      expect(internal.sanitizePathSegment('a/b c')).toBe('a_b_c');
      expect(internal.cameraIdFromParticipantIdentity(undefined)).toBeNull();
      expect(internal.cameraIdFromParticipantIdentity('robot-media')).toBeNull();
      expect(internal.cameraIdFromParticipantIdentity('robot-other')).toBeNull();
      expect(internal.cameraIdFromParticipantIdentity('custom-camera')).toBe('custom-camera');
      expect(
        internal.cameraIdFromParticipantIdentity(`robot-media:${robotId}:front`),
      ).toBe('front');
      expect(internal.cameraIdFromParticipantIdentityForRobot(robotId, undefined)).toBeNull();
      expect(internal.cameraIdFromParticipantIdentityForRobot(robotId, 'other')).toBeNull();
      expect(
        internal.mapRobotWhipIngress(
          ingress({ participantIdentity: undefined, participantName: undefined }),
        ),
      ).toEqual(
        expect.objectContaining({ participantIdentity: undefined, participantName: undefined }),
      );
    });

    it('resolves camera-safe recording templates with and without camera placeholders', () => {
      const internal = service as any;
      expect(
        internal.resolveRecordingTemplate('records/{room_name}/{time}.mp4', roomName, 'front'),
      ).toBe(`records/${roomName}/front-{time}.mp4`);
      expect(internal.resolveRecordingTemplate('records/file.mp4', roomName, 'front')).toBe(
        'records/file-front.mp4',
      );
      expect(
        internal.resolveRecordingTemplate(
          'records/default-2026-07-17T160000.mp4',
          roomName,
          null,
        ),
      ).toBe('records/default-2026-07-17T160000.mp4');
      values.LIVEKIT_RECORDING_OBJECT_KEY_TEMPLATE = ' /{room_name}//{camera_id}/{session_id}.mp4 ';
      expect(internal.resolveRecordingObjectKey(roomName, null, ' .unsafe/id. ')).toBe(
        `${roomName}/default/unsafe_id.mp4`,
      );
      delete values.LIVEKIT_RECORDING_OBJECT_KEY_TEMPLATE;
      expect(internal.resolveRecordingObjectKey(roomName, 'front', 'session')).toBe(
        'sessions/session/front-{time}.mp4',
      );
      const output = internal.buildRecordingFileOutput('recording.mp4', {
        bucket: 'bucket',
        region: 'region',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      }) as EncodedFileOutput;
      if (output.output.case !== 's3') throw new Error('Expected S3 output');
      expect(output.output.value.sessionToken).toBe('');
      expect(output.output.value.endpoint).toBe('');
    });

    it('handles non-composite and incomplete recording status entries', () => {
      const internal = service as any;
      expect(internal.getTrackCompositeVideoTrackId({ request: { case: 'roomComposite' } })).toBeNull();
      expect(
        internal.getTrackCompositeVideoTrackId({
          request: { case: 'trackComposite', value: { videoTrackId: ' ' } },
        }),
      ).toBeNull();
      const status = internal.toRecordingStatus(
        roomName,
        [
          { egressId: 'room', request: { case: 'roomComposite', value: {} } },
          { egressId: 'missing-request' },
          { egressId: 'missing-value', request: { case: 'trackComposite' } },
        ],
        true,
        new Map(),
      );
      expect(status).toEqual(expect.objectContaining({ active: true, activeCount: 3 }));
      expect(status.sessions.every((entry: { videoTrackId: string | null }) => entry.videoTrackId === null)).toBe(true);
    });

    it('maps timestamps from seconds, milliseconds, microseconds, and nanoseconds', () => {
      const internal = service as any;
      expect(internal.toIsoTimestamp(null)).toBeNull();
      expect(internal.toIsoTimestamp(0)).toBeNull();
      expect(internal.toIsoTimestamp(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
      expect(internal.toIsoTimestamp(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z');
      expect(internal.toIsoTimestamp(1_700_000_000_000_000n)).toBe(
        '2023-11-14T22:13:20.000Z',
      );
      expect(internal.toIsoTimestamp(1_700_000_000_000_000_000n)).toBe(
        '2023-11-14T22:13:20.000Z',
      );
      expect(internal.toIsoTimestamp(10n ** 400n)).toBeNull();
    });

    it('rejects LiveKit calls that exceed the bounded egress timeout', async () => {
      jest.useFakeTimers();
      const never = new Promise<never>(() => undefined);
      const timed = (service as any).withTimeout(never, 'test action');
      const assertion = expect(timed).rejects.toThrow(
        'LiveKit egress timeout (test action) after 12000ms',
      );
      await jest.advanceTimersByTimeAsync(12_000);
      await assertion;
    });
  });
});
