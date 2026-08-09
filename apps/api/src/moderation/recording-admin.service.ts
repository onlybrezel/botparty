import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { LivekitService } from '../livekit/livekit.service';
import {
  createS3CompatibleStorageClient,
  resolveS3CompatibleStorageConfig,
  type S3CompatibleStorageConfig,
  type S3CompatibleStorageClient,
} from '../common/s3-compatible-storage';

@Injectable()
export class RecordingAdminService {
  private readonly playbackSigningKey: string;
  private readonly playbackTtlSec: number;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: {
      recording: Pick<PrismaService['recording'], 'findMany' | 'findUnique'>;
      session: Pick<PrismaService['session'], 'findFirst'>;
      user: Pick<PrismaService['user'], 'findUnique'>;
    },
    @Inject(LivekitService)
    private readonly livekit: Pick<LivekitService, 'getRoomRecordingStatus' | 'startRoomRecording' | 'stopRoomRecording'>,
    @Inject(ConfigService)
    private readonly config: { get(key: string): unknown; getOrThrow(key: string): unknown },
  ) {
    const signingSecret = this.config.get('RECORDING_SIGNING_SECRET');
    const jwtSecret = this.config.getOrThrow('JWT_SECRET');
    if (typeof jwtSecret !== 'string') throw new Error('JWT_SECRET must be a string');
    this.playbackSigningKey =
      (typeof signingSecret === 'string' ? signingSecret.trim() : '') || jwtSecret.trim();
    const ttl = this.config.get('RECORDING_SIGNED_URL_TTL_SEC');
    this.playbackTtlSec = Number(typeof ttl === 'string' ? ttl : '300');
  }

  async getAdminRobotRecordingStatus(robotId: string, requesterId: string) {
    await this._assertAdmin(requesterId);

    return {
      ...(await this.livekit.getRoomRecordingStatus(robotId)),
      updatedAt: new Date().toISOString(),
    };
  }

  async startAdminRobotRecording(robotId: string, requesterId: string) {
    await this._assertAdmin(requesterId);
    const activeSession = await this.prisma.session.findFirst({
      where: { robotId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
    if (!activeSession) throw new BadRequestException('No active control session to record');

    try {
      return {
        ...(await this.livekit.startRoomRecording(robotId, activeSession.id)),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start recording';
      throw new BadRequestException(message);
    }
  }

  async stopAdminRobotRecording(robotId: string, requesterId: string) {
    await this._assertAdmin(requesterId);

    try {
      return {
        ...(await this.livekit.stopRoomRecording(robotId)),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop recording';
      throw new BadRequestException(message);
    }
  }

  async listAdminRecordings(requesterId: string) {
    await this._assertAdmin(requesterId);
    const recordings = await this.prisma.recording.findMany({
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
    return recordings.map((recording) => ({
      fileName: basename(recording.objectKey),
      sizeBytes: 0,
      modifiedAt: (recording.endedAt ?? recording.startedAt).toISOString(),
      robotId: recording.robotId,
      cameraId: recording.cameraId,
      recordedAt: recording.startedAt.toISOString(),
      ...this._buildSignedPlaybackMetadata(recording.id),
    }));
  }

  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> {
    await this._assertAdmin(requesterId);

    const objectFile = await this._readObjectRecording(fileName);
    if (objectFile) {
      return objectFile;
    }

    throw new NotFoundException('Recording not found');
  }

  async streamSignedAdminRecording(
    fileName: string,
    expiresRaw: string | undefined,
    signature: string | undefined,
  ): Promise<StreamableFile> {
    this._assertSignedPlaybackAccess(fileName, expiresRaw, signature);

    const objectFile = await this._readObjectRecording(fileName);
    if (objectFile) {
      return objectFile;
    }

    throw new NotFoundException('Recording not found');
  }

  async findReplayCandidatesForSession(input: {
    sessionId: string;
    limit?: number;
  }) {
    if (!this._objectStorageConfig()) {
      return [];
    }
    const recordings = await this.prisma.recording.findMany({
      where: { sessionId: input.sessionId },
      orderBy: { startedAt: 'asc' },
      take: Math.max(1, Math.min(input.limit ?? 8, 16)),
    });
    return recordings.map((recording) => ({
      fileName: basename(recording.objectKey),
      sizeBytes: 0,
      modifiedAt: (recording.endedAt ?? recording.startedAt).toISOString(),
      robotId: recording.robotId,
      cameraId: recording.cameraId,
      recordedAt: recording.startedAt.toISOString(),
      ...this._buildSignedPlaybackMetadata(recording.id),
    }));
  }

  private async _assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Access denied');
    }
  }

  private _objectStorageConfig(): S3CompatibleStorageConfig | null {
    return resolveS3CompatibleStorageConfig(this.config, 'LIVEKIT_RECORDINGS_S3_');
  }

  private _requireObjectStorageConfig(): S3CompatibleStorageConfig {
    const config = this._objectStorageConfig();
    if (!config) {
      throw new InternalServerErrorException('Recording object storage is not configured');
    }
    return config;
  }

  createObjectStorageClient(config: S3CompatibleStorageConfig): S3CompatibleStorageClient {
    return createS3CompatibleStorageClient(config);
  }

  private async _readObjectRecording(recordingId: string): Promise<StreamableFile | null> {
    const config = this._requireObjectStorageConfig();
    const client = this.createObjectStorageClient(config);
    const recording = await this.prisma.recording.findUnique({ where: { id: recordingId } });
    if (!recording) return null;
    return this._readObjectRecordingByKey(client, config, recording.objectKey);
  }

  private async _readObjectRecordingByKey(
    client: S3CompatibleStorageClient,
    config: S3CompatibleStorageConfig,
    key: string,
  ): Promise<StreamableFile | null> {
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );

      const stream = await this._bodyToReadable(response.Body);
      if (!stream) {
        throw new NotFoundException('Recording not found');
      }

      return new StreamableFile(stream, {
        type: response.ContentType || 'video/mp4',
        disposition: `inline; filename="${basename(key)}"`,
      });
    } catch (error) {
      if (this._isMissingObjectError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async _bodyToReadable(body: unknown): Promise<Readable | null> {
    if (!body) {
      return null;
    }

    if (body instanceof Readable) {
      return body;
    }

    if (typeof body === 'object' && 'pipe' in body && typeof body.pipe === 'function') {
      return body as Readable;
    }

    if (typeof body === 'object' && 'transformToWebStream' in body && typeof body.transformToWebStream === 'function') {
      const webStream = await body.transformToWebStream();
      return Readable.fromWeb(webStream as globalThis.ReadableStream);
    }

    if (typeof body === 'object' && 'transformToByteArray' in body && typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray();
      return Readable.from(Buffer.from(bytes));
    }

    return null;
  }

  private _isMissingObjectError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const name = 'name' in error && typeof error.name === 'string' ? error.name : null;
    return name === 'NoSuchKey' || name === 'NotFound';
  }

  private _buildSignedPlaybackMetadata(fileName: string) {
    const safeName = basename(fileName);
    const expires = Math.floor(Date.now() / 1000) + this.playbackTtlSec;
    const signature = this._signPlaybackAccess(safeName, expires);

    return {
      playbackPath:
        `/api/v1/moderation/admin/recordings/${encodeURIComponent(safeName)}/signed`
        + `?expires=${expires}&signature=${signature}`,
      playbackExpiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  private _assertSignedPlaybackAccess(
    fileName: string,
    expiresRaw: string | undefined,
    signature: string | undefined,
  ) {
    const expires = Number(expiresRaw);
    if (!Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('Recording link expired');
    }
    if (!signature?.trim()) {
      throw new ForbiddenException('Recording signature missing');
    }

    const expected = this._signPlaybackAccess(fileName, expires);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');
    const valid =
      actualBuffer.length === expectedBuffer.length
      && timingSafeEqual(actualBuffer, expectedBuffer);

    if (!valid) {
      throw new ForbiddenException('Recording signature invalid');
    }
  }

  private _signPlaybackAccess(fileName: string, expires: number) {
    return createHmac('sha256', this.playbackSigningKey)
      .update(`${fileName}:${expires}`)
      .digest('hex');
  }
}
