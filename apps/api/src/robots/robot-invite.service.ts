import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RobotInviteService {
  constructor(private readonly prisma: PrismaService) {}

  async generateUniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const inviteCode = randomBytes(12).toString('hex');
      const existing = await this.prisma.robot.findUnique({
        where: { inviteCode },
        select: { id: true },
      });

      if (!existing) {
        return inviteCode;
      }
    }

    throw new Error('Failed to generate unique invite code');
  }

  async resolveInviteCode(input: {
    currentAccessMode: string | null;
    currentInviteCode: string | null;
    nextAccessMode: string;
  }): Promise<string | null> {
    if (input.nextAccessMode !== 'LINK_ONLY') {
      return input.currentInviteCode ?? null;
    }

    if (input.currentAccessMode === 'LINK_ONLY' && input.currentInviteCode) {
      return input.currentInviteCode;
    }

    return this.generateUniqueInviteCode();
  }

  async ensureInviteCodeForManagedRobot<
    T extends { id: string; accessMode: string; inviteCode?: string | null },
  >(robot: T): Promise<T> {
    if (robot.accessMode !== 'LINK_ONLY' || robot.inviteCode) {
      return robot;
    }

    const inviteCode = await this.generateUniqueInviteCode();
    await this.prisma.robot.update({
      where: { id: robot.id },
      data: { inviteCode },
    });

    return { ...robot, inviteCode };
  }
}
