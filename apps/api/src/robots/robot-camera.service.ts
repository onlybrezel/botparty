import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@botparty/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { RobotAccessService } from './robot-access.service';
import { mergeRobotMetadata } from './robot-metadata.schema';

type RobotStreamCameraDescriptor = {
  id: string;
  label?: string;
  role?: string;
  enabled?: boolean;
  publishMode?: string;
};

@Injectable()
export class RobotCameraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RobotAccessService,
  ) {}

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
    const robot = await this.findCameraRobot(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const cameraId = camera.id.trim();
    if (!cameraId) {
      throw new BadRequestException('camera id is required');
    }

    const stream = this.access.parseStreamFromMetadata(robot.metadata);
    const currentCameras = stream.cameras ?? [];
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
    if (existingIndex >= 0) {
      nextCameras.splice(Math.min(existingIndex, nextCameras.length), 0, nextCamera);
    } else {
      nextCameras.push(nextCamera);
    }

    const metadata = mergeRobotMetadata(robot.metadata, {
      stream: {
        targetBitrateKbps: stream.targetBitrateKbps,
        activeCameraId: stream.activeCameraId || nextCameras[0]?.id,
        cameras: nextCameras,
      },
    });

    this.access.invalidateCache(robotId);
    return this.prisma.robot.update({
      where: { id: robotId },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async removeExternalStreamCamera(robotId: string, ownerId: string, cameraId: string) {
    const robot = await this.findCameraRobot(robotId);
    if (robot.ownerId !== ownerId) {
      throw new ForbiddenException('Not your robot');
    }

    const normalizedCameraId = cameraId.trim();
    if (!normalizedCameraId) {
      return robot;
    }

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

    this.access.invalidateCache(robotId);
    return this.prisma.robot.update({
      where: { id: robotId },
      data: {
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async findCameraRobot(robotId: string) {
    const robot = await this.prisma.robot.findUnique({
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