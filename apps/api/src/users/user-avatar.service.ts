import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { createS3CompatibleStorageClient, resolveS3CompatibleStorageConfig } from '../common/s3-compatible-storage';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserAvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async save(userId: string, dataUrl: string) {
    const storage = resolveS3CompatibleStorageConfig(this.config, 'THUMBNAIL_S3_');
    const publicBaseUrl = this.config.get<string>('THUMBNAIL_PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '');
    if (!storage || !publicBaseUrl) {
      throw new InternalServerErrorException('Avatar storage is not configured');
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl.trim());
    if (!match) throw new BadRequestException('Avatar must be a PNG, JPEG, or WebP image');
    const buffer = Buffer.from(match[2] ?? '', 'base64');
    if (buffer.length === 0 || buffer.length > 750 * 1024) {
      throw new BadRequestException('Avatar image must be 750 KB or smaller');
    }
    let normalized: Buffer;
    try {
      normalized = await sharp(buffer)
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Avatar image could not be processed');
    }

    const client = createS3CompatibleStorageClient(storage);
    const prefix = `avatars/${userId}/`;
    const listed = await client.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix }));
    const oldObjects = listed.Contents?.flatMap((entry) => entry.Key ? [{ Key: entry.Key }] : []) ?? [];
    if (oldObjects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: oldObjects, Quiet: true } }));
    }
    const objectKey = `${prefix}${Date.now()}.webp`;
    await client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: normalized,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: `${publicBaseUrl}/${objectKey}` },
      select: { id: true, username: true, displayName: true, avatarUrl: true, role: true, balance: true, credits: true, createdAt: true },
    });
  }

  async clear(userId: string) {
    const storage = resolveS3CompatibleStorageConfig(this.config, 'THUMBNAIL_S3_');
    if (storage) {
      const client = createS3CompatibleStorageClient(storage);
      const listed = await client.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: `avatars/${userId}/` }));
      const objects = listed.Contents?.flatMap((entry) => entry.Key ? [{ Key: entry.Key }] : []) ?? [];
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({ Bucket: storage.bucket, Delete: { Objects: objects, Quiet: true } }));
      }
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: { id: true, username: true, displayName: true, avatarUrl: true, role: true, balance: true, credits: true, createdAt: true },
    });
  }
}
