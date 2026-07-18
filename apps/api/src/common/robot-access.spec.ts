import { NotFoundException } from '@nestjs/common';
import { assertRobotOwner, assertStaffOrRobotOwner, isStaffRole } from './robot-access';

describe('robot-access helpers', () => {
  it('identifies staff roles consistently', () => {
    expect(isStaffRole('ADMIN')).toBe(true);
    expect(isStaffRole('MOD')).toBe(true);
    expect(isStaffRole('MODERATOR')).toBe(true);
    expect(isStaffRole('USER')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });

  it('assertRobotOwner requires the robot to exist and belong to the requester', () => {
    expect(() => assertRobotOwner(null, 'user-1')).toThrow(NotFoundException);
    expect(() => assertRobotOwner({ id: 'robot-1', ownerId: 'owner-1' }, 'user-2')).toThrow(NotFoundException);
    expect(() => assertRobotOwner({ id: 'robot-1', ownerId: 'owner-1' }, 'owner-1')).not.toThrow();
  });

  it('assertStaffOrRobotOwner accepts owners and staff but rejects everyone else', () => {
    expect(() => assertStaffOrRobotOwner(null, { id: 'user-1', role: 'USER' })).toThrow(NotFoundException);
    expect(() => assertStaffOrRobotOwner({ id: 'robot-1', ownerId: 'owner-1' }, null)).toThrow(NotFoundException);
    expect(() =>
      assertStaffOrRobotOwner({ id: 'robot-1', ownerId: 'owner-1' }, { id: 'user-2', role: 'USER' }),
    ).toThrow(NotFoundException);
    expect(() =>
      assertStaffOrRobotOwner({ id: 'robot-1', ownerId: 'owner-1' }, { id: 'mod-1', role: 'MOD' }),
    ).not.toThrow();
    expect(() =>
      assertStaffOrRobotOwner({ id: 'robot-1', ownerId: 'owner-1' }, { id: 'owner-1', role: 'USER' }),
    ).not.toThrow();
  });
});
