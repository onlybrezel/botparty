import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, IngressClient, IngressInput, RoomServiceClient } from 'livekit-server-sdk';
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
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly livekitUrl: string;
  private readonly livekitServiceUrl: string;
  private readonly roomService: RoomServiceClient;
  private readonly ingressService: IngressClient;

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
}
