import { NotFoundException } from '@nestjs/common';

/**
 * Returns true when the given role is staff-level (admin or moderator).
 * Centralizes the role check that was previously duplicated across services.
 */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'MOD' || role === 'MODERATOR';
}

/**
 * Conceals both missing and foreign robots behind the same response.
 */
export function assertRobotOwner(
  robot: { id: string; ownerId: string } | null | undefined,
  userId: string,
) {
  if (!robot) throw new NotFoundException('Robot not found');
  if (robot.ownerId !== userId) throw new NotFoundException('Robot not found');
}

/**
 * Conceals foreign robots unless the user is the owner or site staff.
 */
export function assertStaffOrRobotOwner(
  robot: { id: string; ownerId: string } | null | undefined,
  user: { id: string; role: string } | null | undefined,
) {
  if (!robot) throw new NotFoundException('Robot not found');
  if (!user) throw new NotFoundException('User not found');
  if (robot.ownerId !== user.id && !isStaffRole(user.role)) {
    throw new NotFoundException('Robot not found');
  }
}
