import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { LivekitService } from '../livekit/livekit.service';

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

    const dir = this._recordingsDir();
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return [] as Array<{
        fileName: string;
        sizeBytes: number;
        modifiedAt: string;
        robotId: string | null;
      }>;
    }

    const files = await Promise.all(
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

    return files.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
  }

  async streamAdminRecording(fileName: string, requesterId: string): Promise<StreamableFile> {
    await this._assertAdmin(requesterId);

    const safeName = basename(fileName);
    if (!safeName.endsWith('.mp4')) {
      throw new BadRequestException('Only .mp4 recordings are supported');
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

  private async _assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Access denied');
    }
  }

  private _recordingsDir(): string {
    return this.config.get<string>('LIVEKIT_RECORDINGS_DIR')?.trim() || '/recordings';
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
