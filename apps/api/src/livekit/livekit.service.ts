import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly livekitUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('LIVEKIT_API_KEY');
    this.apiSecret = config.getOrThrow<string>('LIVEKIT_API_SECRET');
    this.livekitUrl = config.getOrThrow<string>('LIVEKIT_URL');
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
    return this.livekitUrl;
  }
}
