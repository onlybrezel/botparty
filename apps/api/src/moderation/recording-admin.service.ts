import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
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
};

@Injectable()
export class RecordingAdminService {
  private readonly logger = new Logger(RecordingAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LivekitService,
    private readonly config: ConfigService,
  ) {}

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

    const [objectStorageFiles, localFiles] = await Promise.all([
      this._listObjectStorageRecordings(),
      this._listLocalRecordings(),
    ]);

    const merged = new Map<string, RecordingFileSummary>();
    for (const file of [...localFiles, ...objectStorageFiles]) {
      const current = merged.get(file.fileName);
      if (!current) {
        merged.set(file.fileName, file);
        continue;
      }

      const currentTs = Date.parse(current.modifiedAt);
      const nextTs = Date.parse(file.modifiedAt);
      if (Number.isNaN(currentTs) || nextTs >= currentTs) {
        merged.set(file.fileName, file);
      }
    }

    return Array.from(merged.values()).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
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

    const fullPath = this._resolveRecordingPath(safeName);
    try {
      await stat(fullPath);
    } catch {
      throw new NotFoundException('Recording not found');
    }

    return new StreamableFile(createReadStream(fullPath), {
      type: 'video/mp4',
      disposition: `inline; filename="${safeName}"`,
    });
  }

  private async _listLocalRecordings(): Promise<RecordingFileSummary[]> {
    const dir = this._recordingsDir();
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    return await Promise.all(
      entries
        .filter((name) => name.endsWith('.mp4'))
        .map(async (fileName) => {
          const fullPath = this._resolveRecordingPath(fileName);
          const fileStat = await stat(fullPath);
          const parsed = this._parseRecordingFileName(fileName);
          return {
            fileName,
            sizeBytes: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
            robotId: parsed.robotId,
            cameraId: parsed.cameraId,
            recordedAt: parsed.recordedAt,
          };
        }),
    );
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

  private _recordingsDir(): string {
    return this.config.get<string>('LIVEKIT_RECORDINGS_DIR')?.trim() || '/recordings';
  }

  private _objectStorageConfig(): S3CompatibleStorageConfig | null {
    return resolveS3CompatibleStorageConfig(this.config, 'LIVEKIT_RECORDINGS_S3_');
  }

  private _createObjectStorageClient(config: S3CompatibleStorageConfig): S3Client {
    return createS3CompatibleStorageClient(config);
  }

  private async _listObjectStorageRecordings(): Promise<RecordingFileSummary[]> {
    const config = this._objectStorageConfig();
    if (!config) {
      return [];
    }

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
    const config = this._objectStorageConfig();
    if (!config) {
      return null;
    }

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

  private _resolveRecordingPath(fileName: string): string {
    const dir = this._recordingsDir();
    const resolvedDir = resolve(dir);
    const resolvedFile = resolve(join(resolvedDir, fileName));
    if (!resolvedFile.startsWith(`${resolvedDir}/`) && resolvedFile !== resolvedDir) {
      throw new BadRequestException('Invalid recording file path');
    }
    return resolvedFile;
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
}
