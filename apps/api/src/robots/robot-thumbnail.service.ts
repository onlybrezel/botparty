import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

type ThumbnailObjectStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
};

@Injectable()
export class RobotThumbnailService {
  private readonly logger = new Logger(RobotThumbnailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(robotId: string, ownerId: string, dataUrl: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });

    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new ForbiddenException('Not your robot');

    const parsed = this._parseDataUrl(dataUrl);
    const normalizedBuffer = await this._normalizeImage(parsed.buffer);
    await this._removeExisting(robotId);

    const objectStorage = this._objectStorageConfig();
    let thumbnailUrl: string;

    if (objectStorage) {
      await this._removeExistingObject(objectStorage, robotId);
      const objectKey = this._objectKey(robotId);
      await this._putObject(objectStorage, objectKey, normalizedBuffer);
      thumbnailUrl = this._buildObjectUrl(objectStorage, objectKey);
      this.logger.debug(`Stored thumbnail for ${robotId} in object storage`);
    } else {
      await this._ensureStorageDir();
      const filePath = this._filePath(robotId, 'webp');
      await writeFile(filePath, normalizedBuffer);
      thumbnailUrl = this._buildLocalUrl(robotId);
    }

    return await this.prisma.robot.update({
      where: { id: robotId },
      data: { thumbnailUrl },
      include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
  }

  async clear(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new ForbiddenException('Not your robot');

    await this._removeExisting(robotId);
    const objectStorage = this._objectStorageConfig();
    if (objectStorage) {
      await this._removeExistingObject(objectStorage, robotId);
    }

    return await this.prisma.robot.update({
      where: { id: robotId },
      data: { thumbnailUrl: null },
      include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
  }

  async read(robotId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const objectStorage = this._objectStorageConfig();
    if (objectStorage) {
      const robot = await this.prisma.robot.findUnique({
        where: { id: robotId },
        select: { thumbnailUrl: true },
      });

      const objectKey = this._objectKeyFromUrl(objectStorage, robot?.thumbnailUrl ?? null);
      if (objectKey) {
        return this._readObject(objectStorage, objectKey);
      }
    }

    const localFile = await this._readLocalFile(robotId);
    if (localFile) {
      if (objectStorage) {
        await this._migrateLegacyLocalThumbnail(objectStorage, robotId, localFile.buffer);
      }
      return localFile;
    }

    throw new NotFoundException('Thumbnail not found');
  }

  private _storageDir() {
    const configured = process.env.THUMBNAIL_STORAGE_DIR?.trim();
    return configured ? resolve(configured) : resolve(process.cwd(), 'data', 'robot-thumbnails');
  }

  private _filePath(robotId: string, extension: string) {
    return join(this._storageDir(), `${robotId}.${extension}`);
  }

  private _buildLocalUrl(robotId: string) {
    return `/api/v1/robots/${robotId}/thumbnail-image?v=${Date.now()}`;
  }

  private _objectKey(robotId: string) {
    return `${this._objectPrefix(robotId)}${Date.now()}.webp`;
  }

  private _objectPrefix(robotId: string) {
    return `robot-thumbnails/${robotId}/`;
  }

  private _buildObjectUrl(config: ThumbnailObjectStorageConfig, objectKey: string) {
    return `${this._normalizePublicBaseUrl(config.publicBaseUrl)}/${encodeURI(objectKey)}`;
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
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  private async _removeExistingObject(config: ThumbnailObjectStorageConfig, robotId: string): Promise<void> {
    const client = this._createObjectStorageClient(config);
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: this._objectPrefix(robotId),
      }),
    );

    const objects = listed.Contents?.flatMap((entry) => (entry.Key ? [{ Key: entry.Key }] : [])) ?? [];
    if (objects.length === 0) {
      return;
    }

    await client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: {
          Objects: objects,
          Quiet: true,
        },
      }),
    );
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

  private async _readLocalFile(robotId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    for (const extension of ['png', 'jpg', 'webp']) {
      const filePath = this._filePath(robotId, extension);
      try {
        await access(filePath, fsConstants.R_OK);
        return {
          buffer: await readFile(filePath),
          contentType: this._contentType(extension),
        };
      } catch {
        // try next
      }
    }

    return null;
  }

  private async _migrateLegacyLocalThumbnail(
    config: ThumbnailObjectStorageConfig,
    robotId: string,
    buffer: Buffer,
  ): Promise<void> {
    try {
      const normalizedBuffer = await this._normalizeImage(buffer);
      await this._removeExistingObject(config, robotId);

      const objectKey = this._objectKey(robotId);
      await this._putObject(config, objectKey, normalizedBuffer);
      await this.prisma.robot.update({
        where: { id: robotId },
        data: { thumbnailUrl: this._buildObjectUrl(config, objectKey) },
      });
      await this._removeExisting(robotId);
      this.logger.log(`Migrated legacy local thumbnail for ${robotId} to object storage`);
    } catch (err) {
      this.logger.warn(`Failed to migrate legacy local thumbnail for ${robotId}: ${(err as Error).message}`);
    }
  }

  private async _ensureStorageDir() {
    await mkdir(this._storageDir(), { recursive: true });
  }

  private async _removeExisting(robotId: string) {
    try {
      const files = await readdir(this._storageDir());
      await Promise.all(
        files
          .filter((f) => f.startsWith(`${robotId}.`))
          .map((f) => rm(join(this._storageDir(), f), { force: true })),
      );
    } catch {
      // storage dir may not exist yet or cleanup may run in object-storage mode.
    }
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
      return await sharp(buffer)
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

  private _contentType(extension: string) {
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
}
