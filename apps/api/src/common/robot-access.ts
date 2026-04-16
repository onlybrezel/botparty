import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Returns true when the given role is staff-level (admin or moderator).
 * Centralizes the role check that was previously duplicated across services.
 */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'MOD' || role === 'MODERATOR';
}

/**
 * Throws ForbiddenException unless the user is the robot owner.
 */
export function assertRobotOwner(
  robot: { id: string; ownerId: string } | null | undefined,
  userId: string,
) {
  if (!robot) throw new NotFoundException('Robot not found');
  if (robot.ownerId !== userId) throw new ForbiddenException('Not your robot');
}

/**
 * Throws ForbiddenException unless the user is the robot owner OR has a staff role.
 */
export function assertStaffOrRobotOwner(
  robot: { id: string; ownerId: string } | null | undefined,
  user: { id: string; role: string } | null | undefined,
) {
  if (!robot) throw new NotFoundException('Robot not found');
  if (!user) throw new NotFoundException('User not found');
  if (robot.ownerId !== user.id && !isStaffRole(user.role)) {
    throw new ForbiddenException('Access denied');
  }
}
