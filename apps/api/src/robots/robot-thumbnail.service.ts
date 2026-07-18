import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { isStaffRole } from '../common/robot-access';
import { StorageDeletionService } from '../storage/storage-deletion.service';
import { Prisma } from '@botparty/prisma';
import { randomUUID } from 'node:crypto';

type ThumbnailObjectStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
};

const MAX_INPUT_PIXELS = 4_096 * 4_096;

@Injectable()
export class RobotThumbnailService {
  private readonly logger = new Logger(RobotThumbnailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageDeletion: StorageDeletionService,
  ) {}

  async save(robotId: string, ownerId: string, dataUrl: string) {
    const parsed = this._parseDataUrl(dataUrl);
    const normalizedBuffer = await this._normalizeImage(parsed.buffer);
    const objectStorage = this._requireObjectStorageConfig();
    const objectKey = this._objectKey(robotId);
    const thumbnailUrl = this._buildProxyUrl(robotId);
    let uploaded = false;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${robotId}::uuid FOR UPDATE`);
        const robot = await tx.robot.findUnique({
          where: { id: robotId },
          select: { ownerId: true },
        });
        if (!robot || robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

        const previousKeys = await this._listObjectKeys(objectStorage, robotId);
        await this._putObject(objectStorage, objectKey, normalizedBuffer);
        uploaded = true;
        const updated = await tx.robot.update({
          where: { id: robotId },
          data: { thumbnailUrl },
          include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        });
        await this.storageDeletion.enqueue(
          tx,
          objectStorage.bucket,
          previousKeys.filter((key) => key !== objectKey),
        );
        return updated;
      }, { timeout: 30_000 });
      this.logger.debug(`Stored thumbnail for ${robotId} in object storage`);
      return result;
    } catch (error) {
      if (uploaded) {
        try {
          await this._deleteObjectKeys(objectStorage, [objectKey]);
        } catch (cleanupError) {
          this.logger.warn(`Failed to remove uncommitted thumbnail ${objectKey}: ${(cleanupError as Error).message}`);
        }
      }
      throw error;
    }
  }

  async clear(robotId: string, ownerId: string) {
    const objectStorage = this._requireObjectStorageConfig();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${robotId}::uuid FOR UPDATE`);
      const robot = await tx.robot.findUnique({ where: { id: robotId }, select: { ownerId: true } });
      if (!robot || robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');
      const previousKeys = await this._listObjectKeys(objectStorage, robotId);
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: { thumbnailUrl: null },
        include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      });
      await this.storageDeletion.enqueue(tx, objectStorage.bucket, previousKeys);
      return updated;
    }, { timeout: 30_000 });
  }

  async read(
    robotId: string,
    requesterId: string | null,
  ): Promise<{ buffer: Buffer; contentType: string; cacheControl: string }> {
    const objectStorage = this._requireObjectStorageConfig();
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, ownerId: true, visibility: true, thumbnailUrl: true },
    });
    if (!robot) throw new NotFoundException('Thumbnail not found');
    if (!robot.thumbnailUrl) throw new NotFoundException('Thumbnail not found');

    if (robot.visibility === 'PRIVATE' && robot.ownerId !== requesterId) {
      const requester = requesterId
        ? await this.prisma.user.findUnique({ where: { id: requesterId }, select: { role: true } })
        : null;
      if (!isStaffRole(requester?.role)) throw new NotFoundException('Thumbnail not found');
    }

    const objectKey =
      this._objectKeyFromUrl(objectStorage, robot?.thumbnailUrl ?? null)
      ?? await this._findLatestObjectKey(objectStorage, robotId);
    if (!objectKey) {
      throw new NotFoundException('Thumbnail not found');
    }

    return {
      ...(await this._readObject(objectStorage, objectKey)),
      cacheControl:
        robot.visibility === 'PRIVATE'
          ? 'private, no-store'
          : 'public, max-age=3600, stale-while-revalidate=86400',
    };
  }

  private _objectKey(robotId: string) {
    return `${this._objectPrefix(robotId)}${randomUUID()}.webp`;
  }

  private _objectPrefix(robotId: string) {
    return `robot-thumbnails/${robotId}/`;
  }

  private _buildProxyUrl(robotId: string) {
    return `/api/v1/robots/${encodeURIComponent(robotId)}/thumbnail-image`;
  }

  private _objectStorageConfig(): ThumbnailObjectStorageConfig | null {
    const bucket = process.env.THUMBNAIL_S3_BUCKET?.trim();
    const region = process.env.THUMBNAIL_S3_REGION?.trim();
    const accessKeyId = process.env.THUMBNAIL_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.THUMBNAIL_S3_SECRET_ACCESS_KEY?.trim();
    const publicBaseUrl = process.env.THUMBNAIL_PUBLIC_BASE_URL?.trim();

    if (!bucket || !region || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
      return null;
    }

    const endpoint = process.env.THUMBNAIL_S3_ENDPOINT?.trim();
    return {
      bucket,
      region,
      endpoint: endpoint && endpoint.length > 0 ? endpoint : undefined,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl,
      forcePathStyle: this._envFlag('THUMBNAIL_S3_FORCE_PATH_STYLE'),
    };
  }

  private _requireObjectStorageConfig(): ThumbnailObjectStorageConfig {
    const config = this._objectStorageConfig();
    if (!config) {
      throw new InternalServerErrorException('Thumbnail object storage is not configured');
    }
    return config;
  }

  private _envFlag(name: string): boolean {
    const value = process.env[name]?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private _createObjectStorageClient(config: ThumbnailObjectStorageConfig): S3Client {
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private _normalizePublicBaseUrl(value: string): string {
    return value.replace(/\/+$/, '');
  }

  private _objectKeyFromUrl(config: ThumbnailObjectStorageConfig, thumbnailUrl: string | null): string | null {
    if (!thumbnailUrl) {
      return null;
    }

    const normalizedBaseUrl = this._normalizePublicBaseUrl(config.publicBaseUrl);
    const cleanUrl = thumbnailUrl.split('?')[0]?.split('#')[0] ?? thumbnailUrl;
    if (!cleanUrl.startsWith(`${normalizedBaseUrl}/`)) {
      return null;
    }

    return decodeURIComponent(cleanUrl.slice(normalizedBaseUrl.length + 1));
  }

  private async _putObject(config: ThumbnailObjectStorageConfig, objectKey: string, buffer: Buffer): Promise<void> {
    const client = this._createObjectStorageClient(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'private, no-store',
      }),
    );
  }

  private async _listObjectKeys(config: ThumbnailObjectStorageConfig, robotId: string): Promise<string[]> {
    const client = this._createObjectStorageClient(config);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: this._objectPrefix(robotId),
        ContinuationToken: continuationToken,
      }));
      keys.push(...(listed.Contents ?? []).flatMap((entry) => entry.Key ? [entry.Key] : []));
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  private async _deleteObjectKeys(config: ThumbnailObjectStorageConfig, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const client = this._createObjectStorageClient(config);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  private async _findLatestObjectKey(config: ThumbnailObjectStorageConfig, robotId: string): Promise<string | null> {
    const client = this._createObjectStorageClient(config);
    let latest: { key: string; modifiedAt: number } | null = null;
    let continuationToken: string | undefined;
    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: this._objectPrefix(robotId),
        ContinuationToken: continuationToken,
      }));
      for (const entry of listed.Contents ?? []) {
        const key = entry.Key?.trim();
        if (!key) continue;
        const modifiedAt = entry.LastModified?.getTime() ?? 0;
        if (!latest || modifiedAt >= latest.modifiedAt) {
          latest = { key, modifiedAt };
        }
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);

    return latest?.key ?? null;
  }

  private async _readObject(
    config: ThumbnailObjectStorageConfig,
    objectKey: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const client = this._createObjectStorageClient(config);
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }),
    );

    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) {
      throw new NotFoundException('Thumbnail not found');
    }

    return {
      buffer: Buffer.from(bytes),
      contentType: response.ContentType || 'image/webp',
    };
  }

  private _parseDataUrl(dataUrl: string): { buffer: Buffer } {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl.trim());
    if (!match) {
      throw new BadRequestException('Thumbnail must be a PNG, JPEG, or WebP image');
    }

    const mime = match[1]!.toLowerCase();
    const buffer = Buffer.from(match[2] ?? '', 'base64');
    if (!buffer.length) throw new BadRequestException('Thumbnail image is empty');
    if (buffer.length > 3 * 1024 * 1024) throw new BadRequestException('Thumbnail image must be 3 MB or smaller');

    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    if (mime === 'image/png' && !isPng) throw new BadRequestException('Thumbnail content does not match declared type');
    if (mime === 'image/jpeg' && !isJpeg) throw new BadRequestException('Thumbnail content does not match declared type');
    if (mime === 'image/webp' && !isWebp) throw new BadRequestException('Thumbnail content does not match declared type');

    return { buffer };
  }

  private async _normalizeImage(buffer: Buffer) {
    try {
      return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({
          width: 1280,
          height: 1280,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality: 82,
          effort: 4,
        })
        .toBuffer();
    } catch {
      throw new BadRequestException('Thumbnail image could not be processed');
    }
  }

}
