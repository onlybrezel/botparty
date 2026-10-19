import { isRobotPublic, parseJsonArray } from './api-response-guards';

const publicRobot = {
  id: 'robot-id', name: 'Test Robot', slug: 'test-robot', description: null,
  thumbnailUrl: null, status: 'OFFLINE', visibility: 'PUBLIC', accessMode: 'OPEN',
  queueMode: 'FIRST_COME', maxTurnTime: 60000, maxViewers: 1000, maxControllers: 10,
  tags: ['test'], viewerCount: 0, createdAt: '2026-10-19T00:00:00.000Z',
  owner: { id: 'owner-id', username: 'admin', displayName: 'Administrator', avatarUrl: null },
};

describe('public robot API response contract', () => {
  it('accepts the public owner projection without account role or creation date', () => {
    expect(isRobotPublic(publicRobot)).toBe(true);
    expect(parseJsonArray([publicRobot], isRobotPublic)).toEqual([publicRobot]);
  });

  it('rejects malformed public owners and robot fields', () => {
    expect(isRobotPublic({ ...publicRobot, owner: { ...publicRobot.owner, username: null } })).toBe(false);
    expect(isRobotPublic({ ...publicRobot, owner: { ...publicRobot.owner, avatarUrl: 1 } })).toBe(false);
    expect(isRobotPublic({ ...publicRobot, status: 'INVALID' })).toBe(false);
  });
});
