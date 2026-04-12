import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, EgressClient, IngressClient, IngressInput, RoomServiceClient } from 'livekit-server-sdk';
import { EncodedFileOutput, EncodedFileType, TrackType } from '@livekit/protocol';
import type { EgressInfo, IngressInfo } from '@livekit/protocol';

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

export type RobotCameraIngress = RobotWhipIngress & {
  cameraId: string | null;
  isLive: boolean;
};

type RecordingTrackTarget = {
  cameraId: string | null;
  videoTrackId: string;
  audioTrackId: string | null;
};

type ActiveRecordingSession = {
  egressId: string;
  cameraId: string | null;
  videoTrackId: string | null;
  audioTrackId: string | null;
  startedAt: string | null;
};

type RecordingStatus = {
  roomName: string;
  active: boolean;
  activeCount: number;
  egressId: string | null;
  startedAt: string | null;
  sessions: ActiveRecordingSession[];
};

@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly egressTimeoutMs = 12000;
  private readonly egressStopWaitMs = 12000;
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

  async getRoomRecordingStatus(robotId: string): Promise<RecordingStatus> {
    const roomName = `robot-${robotId}`;
    const [rooms, activeEgress] = await Promise.all([
      this.roomService.listRooms([roomName]),
      this.withTimeout(
        this.egressService.listEgress({ roomName, active: true }),
        'list recording status',
      ),
    ]);

    const room = rooms.find((entry) => entry.name === roomName) ?? null;
    const participants = room ? await this.roomService.listParticipants(roomName) : [];
    const trackCameraLookup = this.buildTrackCameraLookup(participants);
    return this.toRecordingStatus(roomName, activeEgress, Boolean(room?.activeRecording), trackCameraLookup);
  }

  async startRoomRecording(robotId: string): Promise<RecordingStatus> {
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

    const participants = await this.roomService.listParticipants(roomName);
    const trackCameraLookup = this.buildTrackCameraLookup(participants);
    const targets = this.collectRecordingTargets(participants);
    if (targets.length === 0) {
      throw new Error('No published tracks available to record yet');
    }

    const activeVideoTrackIds = new Set(
      activeEgress
        .map((entry) => this.getTrackCompositeVideoTrackId(entry))
        .filter((trackId): trackId is string => Boolean(trackId)),
    );
    const pendingTargets = targets.filter((target) => !activeVideoTrackIds.has(target.videoTrackId));

    if (pendingTargets.length === 0) {
      return this.toRecordingStatus(roomName, activeEgress, true, trackCameraLookup);
    }

    const created: Awaited<ReturnType<EgressClient['startTrackCompositeEgress']>>[] = [];
    for (const target of pendingTargets) {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: this.resolveRecordingFilepath(roomName, target.cameraId),
        disableManifest: true,
      });

      const session = await this.withTimeout(
        this.egressService.startTrackCompositeEgress(roomName, output, {
          audioTrackId: target.audioTrackId ?? undefined,
          videoTrackId: target.videoTrackId,
        }),
        `start room recording${target.cameraId ? ` (${target.cameraId})` : ''}`,
      );
      created.push(session);
    }

    return this.toRecordingStatus(roomName, [...activeEgress, ...created], true, trackCameraLookup);
  }

  async stopRoomRecording(robotId: string): Promise<RecordingStatus> {
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

    await this.waitForActiveEgressCount(roomName, 0);

    return this.toRecordingStatus(roomName, [], false, new Map());
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

  async ensureRobotCameraWhipIngress(
    robotId: string,
    robotName: string,
    cameraId: string,
    cameraLabel?: string,
  ): Promise<RobotCameraIngress | null> {
    const normalizedCameraId = this.sanitizeCameraId(cameraId);
    if (!normalizedCameraId) {
      return null;
    }

    const roomName = `robot-${robotId}`;
    const participantIdentity = `robot-media:${robotId}:${normalizedCameraId}`;
    const participantName = cameraLabel?.trim()
      ? `${robotName} ${cameraLabel.trim()}`
      : `${robotName} ${normalizedCameraId}`;

    try {
      const existing = (await this.ingressService.listIngress({ roomName })).find(
        (entry) =>
          entry.inputType === IngressInput.WHIP_INPUT &&
          entry.participantIdentity === participantIdentity,
      );

      const mapped = existing
        ? this.mapRobotWhipIngress(
            await this.ingressService.updateIngress(existing.ingressId, {
              name: participantName,
              roomName,
              participantIdentity,
              participantName,
              participantMetadata: JSON.stringify({
                kind: 'robot-media',
                robotId,
                cameraId: normalizedCameraId,
              }),
              enableTranscoding: true,
            }),
          )
        : this.mapRobotWhipIngress(
            await this.ingressService.createIngress(IngressInput.WHIP_INPUT, {
              name: participantName,
              roomName,
              participantIdentity,
              participantName,
              participantMetadata: JSON.stringify({
                kind: 'robot-media',
                robotId,
                cameraId: normalizedCameraId,
              }),
              enableTranscoding: true,
            }),
          );

      if (!mapped) {
        return null;
      }

      return {
        ...mapped,
        cameraId: normalizedCameraId,
        isLive: await this.isParticipantLive(roomName, participantIdentity),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to provision camera WHIP ingress for robot ${robotId}/${normalizedCameraId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async listRobotCameraIngresses(robotId: string): Promise<RobotCameraIngress[]> {
    const roomName = `robot-${robotId}`;
    const [ingresses, participants] = await Promise.all([
      this.ingressService.listIngress({ roomName }),
      this.safeListParticipants(roomName),
    ]);

    const liveParticipants = new Set(
      participants
        .map((participant) => participant.identity?.trim())
        .filter((identity): identity is string => Boolean(identity)),
    );

    return ingresses
      .filter((entry) => entry.inputType === IngressInput.WHIP_INPUT)
      .map((entry) => {
        const mapped = this.mapRobotWhipIngress(entry);
        if (!mapped) {
          return null;
        }

        const cameraId = this.cameraIdFromParticipantIdentityForRobot(robotId, mapped.participantIdentity);
        return {
          ...mapped,
          cameraId,
          isLive: Boolean(mapped.participantIdentity && liveParticipants.has(mapped.participantIdentity)),
        } satisfies RobotCameraIngress;
      })
      .filter((entry): entry is RobotCameraIngress => Boolean(entry))
      .sort((left, right) => {
        const leftId = left.cameraId ?? '';
        const rightId = right.cameraId ?? '';
        return leftId.localeCompare(rightId);
      });
  }

  async deleteRobotCameraIngress(robotId: string, ingressId: string): Promise<boolean> {
    const roomName = `robot-${robotId}`;
    const existing = (await this.ingressService.listIngress({ roomName })).find(
      (entry) => entry.ingressId === ingressId,
    );
    if (!existing || existing.inputType !== IngressInput.WHIP_INPUT) {
      return false;
    }

    const participantIdentity = existing.participantIdentity?.trim() || '';
    const cameraId = this.cameraIdFromParticipantIdentityForRobot(robotId, participantIdentity);
    if (!cameraId) {
      // Keep the default robot ingress untouched.
      return false;
    }

    await this.ingressService.deleteIngress(ingressId);
    return true;
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

  private sanitizeCameraId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return '';
    }
    return normalized.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  }

  private cameraIdFromParticipantIdentityForRobot(robotId: string, identity?: string): string | null {
    const normalized = identity?.trim();
    if (!normalized) {
      return null;
    }

    const prefixed = normalized.match(new RegExp(`^robot-media:${robotId}:(.+)$`, 'i'));
    if (prefixed?.[1]) {
      return prefixed[1];
    }

    if (normalized === `robot-media-${robotId}`) {
      return null;
    }

    return null;
  }

  private async safeListParticipants(roomName: string) {
    try {
      return await this.roomService.listParticipants(roomName);
    } catch {
      return [];
    }
  }

  private async isParticipantLive(roomName: string, participantIdentity: string): Promise<boolean> {
    const participants = await this.safeListParticipants(roomName);
    return participants.some((participant) => participant.identity === participantIdentity);
  }

  private buildIngressEndpointUrl(baseUrl: string, streamKey: string): string {
    const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
    const normalizedKey = streamKey.trim().replace(/^\/+/, '');
    if (!normalizedKey || normalizedBase.endsWith(`/${normalizedKey}`)) {
      return normalizedBase;
    }
    return `${normalizedBase}/${normalizedKey}`;
  }

  private resolveRecordingFilepath(roomName: string, cameraId: string | null): string {
    let template = this.config
      .get<string>('LIVEKIT_RECORDING_FILEPATH_TEMPLATE')
      ?.trim() || 'recordings/{room_name}-{time}.mp4';
    const roomSegment = roomName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cameraSegment = cameraId ? this.sanitizePathSegment(cameraId) : '';

    if (cameraSegment && !template.includes('{camera_id}')) {
      template = template.includes('{time}')
        ? template.replace('{time}', `${cameraSegment}-{time}`)
        : template.replace(/(\.mp4)$/i, `-${cameraSegment}$1`);
    }

    let resolved = template
      .replaceAll('{room_name}', roomSegment)
      .replaceAll('{camera_id}', cameraSegment || 'default')
      .replace(/--+/g, '-')
      .replace(/-_+/g, '-');

    if (!cameraSegment) {
      resolved = resolved.replace(/-default(?=-\d{4}-\d{2}-\d{2}T\d{6}\.mp4$)/i, '');
    }

    return resolved;
  }

  private buildTrackCameraLookup(
    participants: Awaited<ReturnType<RoomServiceClient['listParticipants']>>,
  ): Map<string, string | null> {
    const lookup = new Map<string, string | null>();
    for (const participant of participants) {
      const cameraId = this.cameraIdFromParticipantIdentity(participant.identity);
      for (const track of participant.tracks) {
        const trackId = track.sid?.trim();
        if (!trackId) {
          continue;
        }
        lookup.set(trackId, cameraId);
      }
    }
    return lookup;
  }

  private collectRecordingTargets(
    participants: Awaited<ReturnType<RoomServiceClient['listParticipants']>>,
  ): RecordingTrackTarget[] {
    const audioTrackId =
      participants
        .flatMap((participant) => participant.tracks)
        .find((track) => track.type === TrackType.AUDIO && track.muted !== true)?.sid ?? null;

    const targets = participants
      .flatMap((participant) => {
        const cameraId = this.cameraIdFromParticipantIdentity(participant.identity);
        return participant.tracks
          .filter((track) => track.type === TrackType.VIDEO && track.muted !== true && Boolean(track.sid))
          .map((track) => ({
            cameraId,
            videoTrackId: track.sid,
            audioTrackId,
          }));
      })
      .sort((left, right) => (left.cameraId ?? '').localeCompare(right.cameraId ?? ''));

    return targets;
  }

  private toRecordingStatus(
    roomName: string,
    egressItems: EgressInfo[],
    roomActiveRecording: boolean,
    trackCameraLookup: Map<string, string | null>,
  ): RecordingStatus {
    const sessions = egressItems
      .map((entry) => {
        const egressId = entry.egressId?.trim();
        if (!egressId) {
          return null;
        }

        const videoTrackId = entry.request?.case === 'trackComposite' ? entry.request.value?.videoTrackId?.trim() || null : null;
        const audioTrackId = entry.request?.case === 'trackComposite' ? entry.request.value?.audioTrackId?.trim() || null : null;
        return {
          egressId,
          cameraId: videoTrackId ? (trackCameraLookup.get(videoTrackId) ?? null) : null,
          videoTrackId,
          audioTrackId,
          startedAt: this.toIsoTimestamp(entry.startedAt),
        } satisfies ActiveRecordingSession;
      })
      .filter((entry): entry is ActiveRecordingSession => Boolean(entry))
      .sort((left, right) => (left.cameraId ?? '').localeCompare(right.cameraId ?? ''));

    const current = sessions[0] ?? null;
    return {
      roomName,
      active: roomActiveRecording || sessions.length > 0,
      activeCount: sessions.length,
      egressId: current?.egressId ?? null,
      startedAt: current?.startedAt ?? null,
      sessions,
    };
  }

  private getTrackCompositeVideoTrackId(entry: EgressInfo): string | null {
    if (entry.request?.case !== 'trackComposite') {
      return null;
    }

    const trackId = entry.request.value?.videoTrackId?.trim();
    return trackId || null;
  }

  private cameraIdFromParticipantIdentity(identity?: string | null): string | null {
    const normalized = identity?.trim();
    if (!normalized) {
      return null;
    }

    const prefixed = normalized.match(/^robot-media:[0-9a-f-]{36}:(.+)$/i);
    if (prefixed?.[1]) {
      return prefixed[1];
    }

    return normalized === 'robot-media' || normalized.startsWith('robot-') ? null : normalized;
  }

  private sanitizePathSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^[-_.]+|[-_.]+$/g, '') || 'camera';
  }

  private async waitForActiveEgressCount(roomName: string, expectedCount: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.egressStopWaitMs) {
      const activeEgress = await this.withTimeout(
        this.egressService.listEgress({ roomName, active: true }),
        'wait for egress shutdown',
      );
      if (activeEgress.length === expectedCount) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for ${expectedCount} active recording egresses in ${roomName}`);
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
