import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RobotThumbnailService {
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
    await this._ensureStorageDir();
    await this._removeExisting(robotId);

    const filePath = this._filePath(robotId, 'webp');
    await writeFile(filePath, normalizedBuffer);

    return await this.prisma.robot.update({
      where: { id: robotId },
      data: { thumbnailUrl: this._buildUrl(robotId) },
      include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
  }

  async clear(robotId: string, ownerId: string) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.ownerId !== ownerId) throw new ForbiddenException('Not your robot');

    await this._removeExisting(robotId);
    return await this.prisma.robot.update({
      where: { id: robotId },
      data: { thumbnailUrl: null },
      include: { owner: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
  }

  async read(robotId: string): Promise<{ buffer: Buffer; contentType: string }> {
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
    throw new NotFoundException('Thumbnail not found');
  }

  private _storageDir() {
    const configured = process.env.THUMBNAIL_STORAGE_DIR?.trim();
    return configured ? resolve(configured) : resolve(process.cwd(), 'data', 'robot-thumbnails');
  }

  private _filePath(robotId: string, extension: string) {
    return join(this._storageDir(), `${robotId}.${extension}`);
  }

  private _buildUrl(robotId: string) {
    return `/api/v1/robots/${robotId}/thumbnail-image?v=${Date.now()}`;
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
      // storage dir may not exist yet
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

    // Verify actual image magic bytes to prevent MIME spoofing.
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
