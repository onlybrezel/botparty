import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly livekitUrl: string;
  private readonly roomService: RoomServiceClient;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('LIVEKIT_API_KEY');
    this.apiSecret = config.getOrThrow<string>('LIVEKIT_API_SECRET');
    this.livekitUrl = config.getOrThrow<string>('LIVEKIT_URL');
    this.roomService = new RoomServiceClient(this.livekitUrl, this.apiKey, this.apiSecret);
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
}
