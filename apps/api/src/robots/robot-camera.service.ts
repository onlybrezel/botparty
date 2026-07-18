import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { RobotAccessService } from './robot-access.service';
import { mergeRobotMetadata } from './robot-metadata.schema';
import { readNonNegativeIntegerEnv } from '../common/config-number';
import type { RobotStreamCameraDescriptor } from './robots.types';

@Injectable()
export class RobotCameraService {
  private readonly maxExternalCamerasPerRobot: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RobotAccessService,
    private readonly config: ConfigService,
  ) {
    this.maxExternalCamerasPerRobot = readNonNegativeIntegerEnv(
      this.config,
      'MAX_EXTERNAL_CAMERAS_PER_ROBOT',
      6,
    );
  }

  async upsertExternalStreamCamera(
    robotId: string,
    ownerId: string,
    camera: {
      id: string;
      label?: string;
      role?: string;
      enabled?: boolean;
      publishMode?: string;
    },
  ) {
    const cameraId = camera.id.trim();
    if (!cameraId) {
      throw new BadRequestException('camera id is required');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${robotId}::uuid FOR UPDATE`);
      const robot = await this.findCameraRobot(robotId, tx);
      if (robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');

      const stream = this.access.parseStreamFromMetadata(robot.metadata);
      const currentCameras = stream.cameras ?? [];
      if (
        this.maxExternalCamerasPerRobot > 0 &&
        !currentCameras.some((entry) => entry.id === cameraId) &&
        currentCameras.length >= this.maxExternalCamerasPerRobot
      ) {
        throw new BadRequestException(
          `Maximum of ${this.maxExternalCamerasPerRobot} external cameras allowed per robot`,
        );
      }
      const withoutCamera = currentCameras.filter((entry) => entry.id !== cameraId);
      const nextCamera: RobotStreamCameraDescriptor = {
        id: cameraId,
        label: camera.label?.trim() || undefined,
        role: camera.role?.trim() || undefined,
        enabled: camera.enabled ?? true,
        publishMode: camera.publishMode?.trim() || 'always_on',
      };
      const existingIndex = currentCameras.findIndex((entry) => entry.id === cameraId);
      const nextCameras = [...withoutCamera];
      if (existingIndex >= 0) nextCameras.splice(Math.min(existingIndex, nextCameras.length), 0, nextCamera);
      else nextCameras.push(nextCamera);

      const metadata = mergeRobotMetadata(robot.metadata, {
        stream: {
          targetBitrateKbps: stream.targetBitrateKbps,
          activeCameraId: stream.activeCameraId || nextCameras[0]?.id,
          cameras: nextCameras,
        },
      });
      return tx.robot.update({
        where: { id: robotId },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.access.invalidateCache(robotId);
    return updated;
  }

  async removeExternalStreamCamera(robotId: string, ownerId: string, cameraId: string) {
    const normalizedCameraId = cameraId.trim();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "robots" WHERE id = ${robotId}::uuid FOR UPDATE`);
      const robot = await this.findCameraRobot(robotId, tx);
      if (robot.ownerId !== ownerId) throw new NotFoundException('Robot not found');
      if (!normalizedCameraId) return robot;

      const stream = this.access.parseStreamFromMetadata(robot.metadata);
      const currentCameras = stream.cameras ?? [];
      const nextCameras = currentCameras.filter((entry) => entry.id !== normalizedCameraId);
      const metadata = mergeRobotMetadata(robot.metadata, {
        stream: {
          targetBitrateKbps: stream.targetBitrateKbps,
          activeCameraId:
            stream.activeCameraId && stream.activeCameraId !== normalizedCameraId
              ? stream.activeCameraId
              : nextCameras[0]?.id,
          cameras: nextCameras.length ? nextCameras : undefined,
        },
      });
      return tx.robot.update({
        where: { id: robotId },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.access.invalidateCache(robotId);
    return updated;
  }

  private async findCameraRobot(
    robotId: string,
    client: Pick<Prisma.TransactionClient, 'robot'> = this.prisma,
  ) {
    const robot = await client.robot.findUnique({
      where: { id: robotId },
      select: {
        id: true,
        ownerId: true,
        metadata: true,
      },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    return robot;
  }
}
