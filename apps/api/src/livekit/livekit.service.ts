import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, EgressClient, IngressClient, IngressInput, RoomServiceClient } from 'livekit-server-sdk';
import { EncodedFileOutput, EncodedFileType } from '@livekit/protocol';
import type { IngressInfo } from '@livekit/protocol';

type RobotWhipIngress = {
  type: 'WHIP';
  ingressId: string;
  url: string;
  streamKey: string;
  endpointUrl: string;
  participantIdentity?: string;
  participantName?: string;
  enableTranscoding: boolean;
};

@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly egressTimeoutMs = 12000;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly livekitUrl: string;
  private readonly livekitServiceUrl: string;
  private readonly roomService: RoomServiceClient;
  private readonly ingressService: IngressClient;
  private readonly egressService: EgressClient;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('LIVEKIT_API_KEY');
    this.apiSecret = config.getOrThrow<string>('LIVEKIT_API_SECRET');
    this.livekitUrl = config.getOrThrow<string>('LIVEKIT_URL');
    this.livekitServiceUrl = this.toLivekitServiceUrl(this.livekitUrl);
    this.roomService = new RoomServiceClient(
      this.livekitServiceUrl,
      this.apiKey,
      this.apiSecret,
    );
    this.ingressService = new IngressClient(
      this.livekitServiceUrl,
      this.apiKey,
      this.apiSecret,
    );
    this.egressService = new EgressClient(
      this.livekitServiceUrl,
      this.apiKey,
      this.apiSecret,
    );
  }

  /**
   * Generate a LiveKit token for a robot (publisher).
   * The robot publishes video + audio and subscribes to DataChannel commands.
   */
  async generateRobotToken(robotId: string, robotName: string): Promise<string> {
    const roomName = `robot-${robotId}`;
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: `robot-${robotId}`,
      name: robotName,
      ttl: '24h',
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    this.logger.debug(`Generated robot token for room: ${roomName}`);
    return await at.toJwt();
  }

  async generateRobotPublisherTokens(
    robotId: string,
    robotName: string,
    cameraIds: string[],
  ): Promise<Record<string, string>> {
    const roomName = `robot-${robotId}`;
    const tokens: Record<string, string> = {};

    for (const rawCameraId of cameraIds) {
      const cameraId = rawCameraId.trim();
      if (!cameraId) {
        continue;
      }

      const label = cameraId.replace(/[._-]+/g, ' ').replace(/\b\w/g, (part) => part.toUpperCase());
      const at = new AccessToken(this.apiKey, this.apiSecret, {
        identity: `robot-media:${robotId}:${cameraId}`,
        name: `${robotName} ${label}`.trim(),
        ttl: '24h',
      });

      at.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: false,
        canPublishData: false,
      });

      tokens[cameraId] = await at.toJwt();
    }

    return tokens;
  }

  /**
   * Generate a LiveKit token for a viewer/controller.
   * Viewers subscribe to video. Controllers can also send DataChannel commands.
   */
  async generateViewerToken(
    robotId: string,
    userId: string,
    username: string,
    canControl: boolean,
  ): Promise<string> {
    const roomName = `robot-${robotId}`;
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: `user-${userId}`,
      name: username,
      ttl: '4h',
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: canControl, // Only controllers can send DataChannel
    });

    this.logger.debug(`Generated viewer token for ${username} (control: ${canControl})`);
    return await at.toJwt();
  }

  getLivekitUrl(): string {
    // LIVEKIT_PUBLIC_URL is the URL returned to browser clients.
    // Falls back to LIVEKIT_URL if not set.
    return this.config.get<string>('LIVEKIT_PUBLIC_URL') ?? this.livekitUrl;
  }

  async listRooms(names?: string[]) {
    return this.roomService.listRooms(names);
  }

  async listParticipants(roomName: string) {
    return this.roomService.listParticipants(roomName);
  }

  async getRoomRecordingStatus(robotId: string): Promise<{
    roomName: string;
    active: boolean;
    egressId: string | null;
    startedAt: string | null;
  }> {
    const roomName = `robot-${robotId}`;
    const [rooms, activeEgress] = await Promise.all([
      this.roomService.listRooms([roomName]),
      this.withTimeout(
        this.egressService.listEgress({ roomName, active: true }),
        'list recording status',
      ),
    ]);

    const room = rooms.find((entry) => entry.name === roomName) ?? null;
    const current = activeEgress[0] ?? null;

    return {
      roomName,
      active: Boolean(room?.activeRecording) || activeEgress.length > 0,
      egressId: current?.egressId ?? null,
      startedAt: this.toIsoTimestamp(current?.startedAt),
    };
  }

  async startRoomRecording(robotId: string): Promise<{
    roomName: string;
    active: boolean;
    egressId: string | null;
    startedAt: string | null;
  }> {
    const roomName = `robot-${robotId}`;
    const rooms = await this.roomService.listRooms([roomName]);
    const room = rooms.find((entry) => entry.name === roomName) ?? null;
    if (!room) {
      throw new Error('Robot room is not active');
    }

    const activeEgress = await this.withTimeout(
      this.egressService.listEgress({ roomName, active: true }),
      'list active recording before start',
    );
    const existing = activeEgress[0] ?? null;
    if (existing) {
      return {
        roomName,
        active: true,
        egressId: existing.egressId ?? null,
        startedAt: this.toIsoTimestamp(existing.startedAt),
      };
    }

    const filepath = this.resolveRecordingFilepath(roomName);
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      disableManifest: true,
    });

    const created = await this.withTimeout(
      this.egressService.startRoomCompositeEgress(roomName, output),
      'start room recording',
    );
    return {
      roomName,
      active: true,
      egressId: created.egressId ?? null,
      startedAt: this.toIsoTimestamp(created.startedAt),
    };
  }

  async stopRoomRecording(robotId: string): Promise<{
    roomName: string;
    active: boolean;
    egressId: string | null;
    startedAt: string | null;
  }> {
    const roomName = `robot-${robotId}`;
    const activeEgress = await this.withTimeout(
      this.egressService.listEgress({ roomName, active: true }),
      'list active recording before stop',
    );

    await Promise.all(
      activeEgress
        .map((entry) => entry.egressId)
        .filter((entry): entry is string => Boolean(entry))
        .map((egressId) => this.withTimeout(this.egressService.stopEgress(egressId), 'stop room recording')),
    );

    return {
      roomName,
      active: false,
      egressId: null,
      startedAt: null,
    };
  }

  async ensureRobotWhipIngress(
    robotId: string,
    robotName: string,
  ): Promise<RobotWhipIngress | null> {
    const roomName = `robot-${robotId}`;
    const participantIdentity = `robot-media-${robotId}`;

    try {
      const existing = (await this.ingressService.listIngress({ roomName })).find(
        (entry) =>
          entry.inputType === IngressInput.WHIP_INPUT &&
          entry.participantIdentity === participantIdentity,
      );
      if (existing) {
        if (!existing.enableTranscoding) {
          const updated = await this.ingressService.updateIngress(existing.ingressId, {
            name: `${robotName} Camera`,
            roomName,
            participantIdentity,
            participantName: `${robotName} Camera`,
            participantMetadata: JSON.stringify({
              kind: 'robot-media',
              robotId,
            }),
            enableTranscoding: true,
          });
          return this.mapRobotWhipIngress(updated);
        }
        return this.mapRobotWhipIngress(existing);
      }

      const created = await this.ingressService.createIngress(IngressInput.WHIP_INPUT, {
        name: `${robotName} Camera`,
        roomName,
        participantIdentity,
        participantName: `${robotName} Camera`,
        participantMetadata: JSON.stringify({
          kind: 'robot-media',
          robotId,
        }),
        enableTranscoding: true,
      });

      return this.mapRobotWhipIngress(created);
    } catch (error) {
      this.logger.warn(
        `Failed to provision WHIP ingress for robot ${robotId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private toLivekitServiceUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'ws:') {
        parsed.protocol = 'http:';
      } else if (parsed.protocol === 'wss:') {
        parsed.protocol = 'https:';
      }
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  private mapRobotWhipIngress(info: IngressInfo): RobotWhipIngress | null {
    const ingressId = info.ingressId?.trim();
    const url = info.url?.trim();
    const streamKey = info.streamKey?.trim();
    if (!ingressId || !url || !streamKey) {
      return null;
    }

    return {
      type: 'WHIP',
      ingressId,
      url,
      streamKey,
      endpointUrl: this.buildIngressEndpointUrl(url, streamKey),
      participantIdentity: info.participantIdentity?.trim() || undefined,
      participantName: info.participantName?.trim() || undefined,
      enableTranscoding: Boolean(info.enableTranscoding),
    };
  }

  private buildIngressEndpointUrl(baseUrl: string, streamKey: string): string {
    const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
    const normalizedKey = streamKey.trim().replace(/^\/+/, '');
    if (!normalizedKey || normalizedBase.endsWith(`/${normalizedKey}`)) {
      return normalizedBase;
    }
    return `${normalizedBase}/${normalizedKey}`;
  }

  private resolveRecordingFilepath(roomName: string): string {
    const template = this.config
      .get<string>('LIVEKIT_RECORDING_FILEPATH_TEMPLATE')
      ?.trim() || 'recordings/{room_name}-{time}.mp4';
    const roomSegment = roomName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return template.replaceAll('{room_name}', roomSegment);
  }

  private toIsoTimestamp(raw?: bigint | number | null): string | null {
    if (raw === null || raw === undefined) {
      return null;
    }

    const asBigInt = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(raw));
    if (asBigInt <= 0n) {
      return null;
    }

    let millis: bigint;
    if (asBigInt > 9_999_999_999_999_999n) {
      // Most LiveKit timestamps are unix nanos.
      millis = asBigInt / 1_000_000n;
    } else if (asBigInt > 9_999_999_999_999n) {
      // Microseconds fallback.
      millis = asBigInt / 1_000n;
    } else if (asBigInt > 9_999_999_999n) {
      // Milliseconds fallback.
      millis = asBigInt;
    } else {
      // Seconds fallback.
      millis = asBigInt * 1000n;
    }

    const asNumber = Number(millis);
    if (!Number.isFinite(asNumber)) {
      return null;
    }

    return new Date(asNumber).toISOString();
  }

  private async withTimeout<T>(promise: Promise<T>, action: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`LiveKit egress timeout (${action}) after ${this.egressTimeoutMs}ms`));
          }, this.egressTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
