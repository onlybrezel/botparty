import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeRobotMetadata } from './robot-metadata.schema';

type RobotAuthMetadata = {
  auth?: {
    boundDeviceHash?: string;
  };
};

@Injectable()
export class RobotDeviceService {
  private readonly logger = new Logger(RobotDeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async validateOrBindRobotDevice(robotId: string, deviceKey?: string | null) {
    const normalizedDeviceKey = deviceKey?.trim() ?? '';
    if (normalizedDeviceKey.length < 32) {
      throw new ForbiddenException('Valid robot device key required');
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, metadata: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    const deviceHash = this.hashDeviceKey(normalizedDeviceKey);
    const currentHash = this.readBoundDeviceHash(robot.metadata);
    if (currentHash && currentHash !== deviceHash) {
      throw new ForbiddenException('Claim token is bound to a different robot device');
    }

    if (!currentHash) {
      await this.prisma.robot.update({
        where: { id: robotId },
        data: {
          metadata: this.setBoundDeviceMetadata(robot.metadata, deviceHash) as Prisma.InputJsonValue,
        },
      });
    }

    return { robotId, deviceHash };
  }

  async findByClaimToken(claimToken: string) {
    const claimTokenHash = createHash('sha256').update(claimToken).digest('hex');
    const robot = await this.prisma.robot.findUnique({ where: { claimTokenHash } });
    if (!robot) {
      return null;
    }

    const maxAgeDays = Number(this.configService.get<string>('ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS', '90'));
    if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
      return robot;
    }

    const tokenIssuedAt = this.readClaimTokenIssuedAt(robot.metadata) ?? robot.createdAt;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    if (Date.now() - tokenIssuedAt.getTime() > maxAgeMs) {
      this.logger.warn(`Rejected expired claim token for robot ${robot.id}`);
      return null;
    }

    return robot;
  }

  async validateRobotAuth(robotId: string, deviceHash: string, tokenVersion: number) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { id: true, metadata: true, deviceTokenVersion: true },
    });
    if (!robot || robot.deviceTokenVersion !== tokenVersion) return false;
    return this.readBoundDeviceHash(robot.metadata) === deviceHash;
  }

  /** Stamps the current time as claimTokenIssuedAt into a metadata object. */
  withClaimTokenIssuedAt(metadata: unknown): Record<string, unknown> {
    const base = { ...normalizeRobotMetadata(metadata) };
    base.claimTokenIssuedAt = new Date().toISOString();
    return base;
  }

  /** Removes the bound device hash from a metadata object (used when rotating claim token). */
  clearBoundDeviceMetadata(metadata: unknown): Record<string, unknown> {
    const existing = { ...normalizeRobotMetadata(metadata) };
    if (!existing.auth || typeof existing.auth !== 'object' || Array.isArray(existing.auth)) {
      return existing;
    }

    const auth = { ...(existing.auth as Record<string, unknown>) };
    delete auth.boundDeviceHash;
    existing.auth = auth;
    return existing;
  }

  readClaimTokenIssuedAt(metadata: unknown): Date | null {
    const raw = normalizeRobotMetadata(metadata).claimTokenIssuedAt;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return null;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  hashDeviceKey(deviceKey: string) {
    return createHash('sha256').update(deviceKey).digest('hex');
  }

  private readBoundDeviceHash(metadata: unknown): string | null {
    const auth = (normalizeRobotMetadata(metadata) as RobotAuthMetadata).auth;
    return typeof auth?.boundDeviceHash === 'string' && auth.boundDeviceHash.trim()
      ? auth.boundDeviceHash.trim()
      : null;
  }

  private setBoundDeviceMetadata(metadata: unknown, deviceHash: string): Record<string, unknown> {
    const existing = { ...normalizeRobotMetadata(metadata) };
    const auth =
      existing.auth && typeof existing.auth === 'object' && !Array.isArray(existing.auth)
        ? { ...(existing.auth as Record<string, unknown>) }
        : {};
    auth.boundDeviceHash = deviceHash;
    existing.auth = auth;
    return existing;
  }
}
