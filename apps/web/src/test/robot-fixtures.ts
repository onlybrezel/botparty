import {
  QueueMode,
  RobotAccessMode,
  RobotStatus,
  RobotVisibility,
} from '@botparty/shared';
import type { RobotManaged } from '@/lib/api';
import type { RobotPublic } from '@botparty/shared';

export function createRobotPublic(overrides: Partial<RobotPublic> = {}): RobotPublic {
  return {
    id: 'robot-1',
    name: 'Test Robot',
    slug: 'test-robot',
    description: null,
    thumbnailUrl: null,
    status: RobotStatus.ONLINE,
    visibility: RobotVisibility.PUBLIC,
    accessMode: RobotAccessMode.OPEN,
    queueMode: QueueMode.FIRST_COME,
    maxTurnTime: 60_000,
    maxViewers: 100,
    maxControllers: 5,
    tags: [],
    viewerCount: 0,
    owner: {
      id: 'owner-1',
      username: 'owner',
      displayName: 'Owner',
      avatarUrl: null,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createRobotManaged(overrides: Partial<RobotManaged> = {}): RobotManaged {
  return {
    id: 'robot-1',
    name: 'Test Robot',
    slug: 'test-robot',
    description: null,
    thumbnailUrl: null,
    status: RobotStatus.ONLINE,
    visibility: RobotVisibility.PUBLIC,
    accessMode: RobotAccessMode.OPEN,
    queueMode: QueueMode.FIRST_COME,
    maxTurnTime: 60_000,
    maxViewers: 100,
    maxControllers: 5,
    tags: [],
    viewerCount: 0,
    owner: {
      id: 'owner-1',
      username: 'owner',
      displayName: 'Owner',
      avatarUrl: null,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    claimToken: null,
    inviteCode: null,
    streamKey: null,
    metadata: null,
    accessPassword: null,
    livekitRoom: null,
    isFeatured: false,
    recordSessions: false,
    aiAssistEnabled: false,
    ros2Enabled: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
