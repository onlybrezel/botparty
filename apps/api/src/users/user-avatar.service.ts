import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Prisma } from '@botparty/prisma';
import {
  createS3CompatibleStorageClient,
  resolveS3CompatibleStorageConfig,
  type S3CompatibleStorageConfig,
} from '../common/s3-compatible-storage';
import { PrismaService } from '../prisma/prisma.service';
import { StorageDeletionService } from '../storage/storage-deletion.service';

const MAX_INPUT_PIXELS = 4_096 * 4_096;

@Injectable()
export class UserAvatarService {
  private readonly logger = new Logger(UserAvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storageDeletion: StorageDeletionService,
  ) {}

  async save(userId: string, dataUrl: string) {
    const storage = this.requireStorage();
    const normalized = await this.normalize(dataUrl);
    const objectKey = `avatars/${userId}/${randomUUID()}.webp`;
    let uploaded = false;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR UPDATE`);
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
        if (!user?.isActive) throw new NotFoundException('User not found');
        const previous = await this.listObjects(storage, `avatars/${userId}/`);
        const client = createS3CompatibleStorageClient(storage);
        await client.send(new PutObjectCommand({
          Bucket: storage.bucket,
          Key: objectKey,
          Body: normalized,
          ContentType: 'image/webp',
          CacheControl: 'private, no-store',
        }));
        uploaded = true;
        const updated = await tx.user.update({
          where: { id: userId },
          data: { avatarUrl: `/api/v1/users/${encodeURIComponent(userId)}/avatar-image` },
          select: this.publicProfileSelect(),
        });
        await this.storageDeletion.enqueue(
          tx,
          storage.bucket,
          previous.map((entry) => entry.key).filter((key) => key !== objectKey),
        );
        return updated;
      }, { timeout: 30_000 });
    } catch (error) {
      if (uploaded) {
        try {
          await this.deleteObjectKeys(storage, [objectKey]);
        } catch (cleanupError) {
          this.logger.warn(`Failed to remove uncommitted avatar ${objectKey}: ${(cleanupError as Error).message}`);
        }
      }
      throw error;
    }
  }

  async clear(userId: string) {
    const storage = this.requireStorage();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR UPDATE`);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
      if (!user?.isActive) throw new NotFoundException('User not found');
      const previous = await this.listObjects(storage, `avatars/${userId}/`);
      const updated = await tx.user.update({
        where: { id: userId },
        data: { avatarUrl: null },
        select: this.publicProfileSelect(),
      });
      await this.storageDeletion.enqueue(tx, storage.bucket, previous.map((entry) => entry.key));
      return updated;
    }, { timeout: 30_000 });
  }

  async read(userId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const storage = this.requireStorage();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, isActive: true },
    });
    if (!user?.isActive || !user.avatarUrl) throw new NotFoundException('Avatar not found');
    const objects = await this.listObjects(storage, `avatars/${userId}/`);
    const latest = objects.reduce<(typeof objects)[number] | null>(
      (current, candidate) => !current || candidate.modifiedAt >= current.modifiedAt ? candidate : current,
      null,
    );
    if (!latest) throw new NotFoundException('Avatar not found');
    const response = await createS3CompatibleStorageClient(storage).send(new GetObjectCommand({
      Bucket: storage.bucket,
      Key: latest.key,
    }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new NotFoundException('Avatar not found');
    return { buffer: Buffer.from(bytes), contentType: response.ContentType || 'image/webp' };
  }

  private requireStorage(): S3CompatibleStorageConfig {
    const storage = resolveS3CompatibleStorageConfig(this.config, 'THUMBNAIL_S3_');
    if (!storage) throw new InternalServerErrorException('Avatar storage is not configured');
    return storage;
  }

  private async normalize(dataUrl: string): Promise<Buffer> {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl.trim());
    if (!match) throw new BadRequestException('Avatar must be a PNG, JPEG, or WebP image');
    const buffer = Buffer.from(match[2] ?? '', 'base64');
    if (buffer.length === 0 || buffer.length > 750 * 1024) {
      throw new BadRequestException('Avatar image must be 750 KB or smaller');
    }
    try {
      return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Avatar image could not be processed');
    }
  }

  private async listObjects(storage: S3CompatibleStorageConfig, prefix: string) {
    const client = createS3CompatibleStorageClient(storage);
    const objects: Array<{ key: string; modifiedAt: number }> = [];
    let continuationToken: string | undefined;
    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: storage.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const entry of listed.Contents ?? []) {
        if (entry.Key) objects.push({ key: entry.Key, modifiedAt: entry.LastModified?.getTime() ?? 0 });
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  private async deleteObjectKeys(storage: S3CompatibleStorageConfig, keys: string[]) {
    if (keys.length === 0) return;
    const client: S3Client = createS3CompatibleStorageClient(storage);
    await client.send(new DeleteObjectsCommand({
      Bucket: storage.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
  }

  private publicProfileSelect() {
    return {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      balance: true,
      credits: true,
      createdAt: true,
    } as const;
  }
}
