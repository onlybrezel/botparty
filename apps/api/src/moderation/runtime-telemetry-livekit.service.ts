import { Injectable } from '@nestjs/common';
import { LivekitService } from '../livekit/livekit.service';

export type RuntimeTelemetryLivekitParticipant = {
  identity: string;
  name: string | null;
  isPublisher: boolean;
  joinedAt: string | null;
  trackCount: number;
};

export type RuntimeTelemetryLivekitRoom = {
  roomName: string;
  robotId: string | null;
  sid: string;
  participants: number;
  publishers: number;
  subscribers: number;
  activeRecording: boolean;
  createdAt: string | null;
  estimatedIngressKbps: number;
  participantNames: string[];
  participantDetails: RuntimeTelemetryLivekitParticipant[];
};

export type RuntimeTelemetryLivekitRuntime = {
  available: boolean;
  error: string | null;
  rooms: RuntimeTelemetryLivekitRoom[];
};

@Injectable()
export class RuntimeTelemetryLivekitService {
  constructor(private readonly livekit: LivekitService) {}

  async getRuntime(): Promise<RuntimeTelemetryLivekitRuntime> {
    try {
      const rooms = await this.livekit.listRooms();
      const robotRooms = rooms.filter((room) => room.name.startsWith('robot-'));
      const mappedRooms: RuntimeTelemetryLivekitRoom[] = await Promise.all(
        robotRooms.map(async (room) => {
          const participants = await this.livekit.listParticipants(room.name);
          const participantSummaries = participants.map((participant) => ({
            identity: participant.identity,
            name: participant.name,
            isPublisher: participant.isPublisher,
            joinedAt: this._livekitTimestampToIso(participant.joinedAtMs, participant.joinedAt),
            trackCount: participant.tracks.length,
          }));
          const publishers = participants.filter((participant) => participant.isPublisher).length;
          const subscribers = participants.filter((participant) => !participant.identity.startsWith('robot-')).length;

          return {
            roomName: room.name,
            robotId: this._robotIdFromRoomName(room.name),
            sid: room.sid,
            participants: room.numParticipants,
            publishers: room.numPublishers || publishers,
            subscribers,
            activeRecording: room.activeRecording,
            createdAt: this._livekitTimestampToIso(room.creationTimeMs, room.creationTime),
            estimatedIngressKbps: Math.round(
              participants.reduce((sum, participant) => sum + this._estimateParticipantIngressBps(participant), 0) / 1000,
            ),
            participantNames: participantSummaries.map((participant) => participant.name || participant.identity).slice(0, 8),
            participantDetails: participantSummaries,
          };
        }),
      );

      return { available: true, error: null, rooms: mappedRooms };
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : 'LiveKit runtime unavailable',
        rooms: [],
      };
    }
  }

  private _robotIdFromRoomName(roomName: string): string | null {
    if (!roomName.startsWith('robot-')) {
      return null;
    }

    const robotId = roomName.slice('robot-'.length).trim();
    return robotId || null;
  }

  private _livekitTimestampToIso(msValue?: bigint, secValue?: bigint): string | null {
    let timestampMs: bigint | null = null;

    if (typeof msValue === 'bigint' && msValue > 0n) {
      timestampMs = msValue;
    } else if (typeof secValue === 'bigint' && secValue > 0n) {
      timestampMs = secValue * 1000n;
    }

    if (timestampMs === null || timestampMs > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }

    return new Date(Number(timestampMs)).toISOString();
  }

  private _estimateParticipantIngressBps(participant: {
    tracks: Array<{
      layers?: Array<{ bitrate: number }>;
      codecs?: Array<{ layers?: Array<{ bitrate: number }> }>;
    }>;
  }): number {
    return participant.tracks.reduce((sum, track) => sum + this._estimateTrackBitrateBps(track), 0);
  }

  private _estimateTrackBitrateBps(track: {
    layers?: Array<{ bitrate: number }>;
    codecs?: Array<{ layers?: Array<{ bitrate: number }> }>;
  }): number {
    let bestBitrate = 0;

    for (const codec of track.codecs ?? []) {
      for (const layer of codec.layers ?? []) {
        if (typeof layer.bitrate === 'number' && Number.isFinite(layer.bitrate)) {
          bestBitrate = Math.max(bestBitrate, layer.bitrate);
        }
      }
    }

    if (bestBitrate > 0) {
      return bestBitrate;
    }

    for (const layer of track.layers ?? []) {
      if (typeof layer.bitrate === 'number' && Number.isFinite(layer.bitrate)) {
        bestBitrate = Math.max(bestBitrate, layer.bitrate);
      }
    }

    return bestBitrate;
  }
}
