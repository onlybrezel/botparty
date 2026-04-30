import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { LivekitService } from '../livekit/livekit.service';
import { isStaffRole } from '../common/robot-access';
import {
  createS3CompatibleStorageClient,
  resolveS3CompatibleStorageConfig,
  type S3CompatibleStorageConfig,
} from '../common/s3-compatible-storage';

type RecordingFileSummary = {
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  robotId: string | null;
  cameraId: string | null;
  recordedAt: string | null;
  playbackPath: string;
  playbackExpiresAt: string;
};

@Injectable()
export class RecordingAdminService {
  private readonly logger = new Logger(RecordingAdminService.name);
  private readonly playbackSigningKey: string;
  private readonly playbackTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
    private readonly config: ConfigService,
  ) {
    this.playbackSigningKey =
      this.config.get<string>('RECORDING_SIGNING_SECRET')?.trim()
      || this.config.get<string>('JWT_SECRET')?.trim()
      || 'botparty-recording-signing-fallback';
    this.playbackTtlSec = Number(this.config.get<string>('RECORDING_SIGNED_URL_TTL_SEC') ?? '300');
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

    try {
      return {
        ...(await this.livekit.startRoomRecording(robotId)),
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

    return await this._listObjectStorageRecordings();
  }

  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> {
    await this._assertAdmin(requesterId);

    const safeName = basename(fileName);
    if (!safeName.endsWith('.mp4')) {
      throw new BadRequestException('Only .mp4 recordings are supported');
    }

    const objectFile = await this._readObjectRecording(safeName);
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
    const safeName = basename(fileName);
    if (!safeName.endsWith('.mp4')) {
      throw new BadRequestException('Only .mp4 recordings are supported');
    }

    this._assertSignedPlaybackAccess(safeName, expiresRaw, signature);

    const objectFile = await this._readObjectRecording(safeName);
    if (objectFile) {
      return objectFile;
    }

    throw new NotFoundException('Recording not found');
  }

  async findReplayCandidatesForSession(input: {
    robotId: string;
    startedAt: Date;
    endedAt?: Date | null;
    recordingUrl?: string | null;
    limit?: number;
  }) {
    if (!this._objectStorageConfig()) {
      return [];
    }

    const explicitFileName = input.recordingUrl ? basename(input.recordingUrl) : null;
    const timeWindowStart = input.startedAt.getTime() - 15 * 60 * 1000;
    const timeWindowEnd = (input.endedAt?.getTime() ?? input.startedAt.getTime() + 4 * 60 * 60 * 1000) + 15 * 60 * 1000;
    const files = await this._listObjectStorageRecordings();

    return files
      .filter((file) => {
        if (explicitFileName && file.fileName === explicitFileName) {
          return true;
        }
        if (file.robotId !== input.robotId) {
          return false;
        }
        if (!file.recordedAt) {
          return false;
        }
        const recordedAtMs = Date.parse(file.recordedAt);
        return Number.isFinite(recordedAtMs) && recordedAtMs >= timeWindowStart && recordedAtMs <= timeWindowEnd;
      })
      .sort((left, right) => {
        if (explicitFileName) {
          if (left.fileName === explicitFileName) return -1;
          if (right.fileName === explicitFileName) return 1;
        }
        const leftDelta = left.recordedAt ? Math.abs(Date.parse(left.recordedAt) - input.startedAt.getTime()) : Number.MAX_SAFE_INTEGER;
        const rightDelta = right.recordedAt ? Math.abs(Date.parse(right.recordedAt) - input.startedAt.getTime()) : Number.MAX_SAFE_INTEGER;
        return leftDelta - rightDelta;
      })
      .slice(0, Math.max(1, Math.min(input.limit ?? 3, 5)));
  }

  private async _assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !isStaffRole(user.role)) {
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

  private _createObjectStorageClient(config: S3CompatibleStorageConfig): S3Client {
    return createS3CompatibleStorageClient(config);
  }

  private async _listObjectStorageRecordings(): Promise<RecordingFileSummary[]> {
    const config = this._requireObjectStorageConfig();

    const client = this._createObjectStorageClient(config);
    const files = new Map<string, RecordingFileSummary>();
    let continuationToken: string | undefined;

    try {
      do {
        const listed = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            ContinuationToken: continuationToken,
          }),
        );

        for (const entry of listed.Contents ?? []) {
          const key = entry.Key?.trim();
          if (!key || !key.toLowerCase().endsWith('.mp4')) {
            continue;
          }

          const fileName = basename(key);
          const parsed = this._parseRecordingFileName(fileName);
          const file: RecordingFileSummary = {
            fileName,
            sizeBytes: entry.Size ?? 0,
            modifiedAt: entry.LastModified?.toISOString() ?? new Date(0).toISOString(),
            robotId: parsed.robotId,
            cameraId: parsed.cameraId,
            recordedAt: parsed.recordedAt,
            ...this._buildSignedPlaybackMetadata(fileName),
          };

          const current = files.get(fileName);
          if (!current || Date.parse(file.modifiedAt) >= Date.parse(current.modifiedAt)) {
            files.set(fileName, file);
          }
        }

        continuationToken = listed.IsTruncated ? listed.NextContinuationToken ?? undefined : undefined;
      } while (continuationToken);
    } catch (error) {
      this.logger.warn(`Failed to list recording objects from ${config.bucket}: ${(error as Error).message}`);
      return [];
    }

    return Array.from(files.values());
  }

  private async _readObjectRecording(fileName: string): Promise<StreamableFile | null> {
    const config = this._requireObjectStorageConfig();

    const client = this._createObjectStorageClient(config);
    const direct = await this._readObjectRecordingByKey(client, config, fileName);
    if (direct) {
      return direct;
    }

    const matchedKey = await this._findObjectKeyByFileName(client, config, fileName);
    if (!matchedKey) {
      return null;
    }

    return this._readObjectRecordingByKey(client, config, matchedKey);
  }

  private async _readObjectRecordingByKey(
    client: S3Client,
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

  private async _findObjectKeyByFileName(
    client: S3Client,
    config: S3CompatibleStorageConfig,
    fileName: string,
  ): Promise<string | null> {
    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          ContinuationToken: continuationToken,
        }),
      );

      const matched = (listed.Contents ?? []).find((entry) => basename(entry.Key?.trim() || '') === fileName);
      if (matched?.Key) {
        return matched.Key;
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken ?? undefined : undefined;
    } while (continuationToken);

    return null;
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

  private _parseRecordingFileName(fileName: string): {
    robotId: string | null;
    cameraId: string | null;
    recordedAt: string | null;
  } {
    const trimmed = basename(fileName).trim();
    const nameWithoutExt = trimmed.replace(/\.mp4$/i, '');
    const strict = nameWithoutExt.match(/^robot-([0-9a-f-]{36})(?:-([a-zA-Z0-9._-]+))?-(\d{4}-\d{2}-\d{2}T\d{6})$/i);
    if (strict) {
      const [, robotId, cameraIdRaw, compactTime] = strict;
      return {
        robotId: robotId ?? null,
        cameraId: cameraIdRaw ? cameraIdRaw.replace(/^camera[-_]?/i, '') : null,
        recordedAt: compactTime ? this._compactRecordingTimeToIso(compactTime) : null,
      };
    }

    const fallbackTimeMatch = nameWithoutExt.match(/(\d{4}-\d{2}-\d{2}T\d{6})(?!.*\d{4}-\d{2}-\d{2}T\d{6})/);
    const cameraMatch = nameWithoutExt.match(/(?:^|[-_])(camera|cam|stream)[-_]?([a-zA-Z0-9._-]+)/i);
    return {
      robotId: nameWithoutExt.match(/robot-([0-9a-f-]{36})/i)?.[1] ?? null,
      cameraId: cameraMatch?.[2] ?? null,
      recordedAt: fallbackTimeMatch?.[1] ? this._compactRecordingTimeToIso(fallbackTimeMatch[1]) : null,
    };
  }

  private _compactRecordingTimeToIso(value: string): string | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
