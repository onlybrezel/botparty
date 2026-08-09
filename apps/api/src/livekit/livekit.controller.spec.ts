import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type JwtPayload } from '@botparty/shared';
import { LivekitController } from './livekit.controller';

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
type AccessMode = 'OPEN' | 'PASSWORD' | 'ALLOWED_USERS' | 'LINK_ONLY';
type VideoAccess = 'ALL' | 'AUTHENTICATED' | 'DISABLED';

const VISIBILITIES: readonly Visibility[] = ['PUBLIC', 'UNLISTED', 'PRIVATE'];
const ACCESS_MODES: readonly AccessMode[] = ['OPEN', 'PASSWORD', 'ALLOWED_USERS', 'LINK_ONLY'];
const RESTRICTED_ACCESS_MODES: readonly AccessMode[] = ['PASSWORD', 'ALLOWED_USERS', 'LINK_ONLY'];
const VIDEO_ACCESS_POLICIES: readonly VideoAccess[] = ['ALL', 'AUTHENTICATED', 'DISABLED'];

const user: JwtPayload = {
  sub: 'user-1',
  username: 'viewer',
  role: Role.USER,
  tokenVersion: 0,
};

function buildController() {
  const livekit = {
    generateViewerToken: jest.fn().mockResolvedValue('viewer-token'),
    generateRobotToken: jest.fn().mockResolvedValue('robot-token'),
    getLivekitUrl: jest.fn().mockReturnValue('wss://livekit.example.test'),
  };
  const robots = {
    findById: jest.fn(),
    validateRoomAccess: jest.fn().mockResolvedValue(true),
    resolveRoomAccessActorId: jest.fn().mockResolvedValue(null),
    resolveGuestActorId: jest.fn().mockReturnValue(null),
    getAccessPolicy: jest.fn().mockResolvedValue({ control: 'AUTHENTICATED' }),
  };
  const queue = {
    getCurrentControllerUserId: jest.fn().mockResolvedValue(null),
  };
  const controller = new LivekitController(livekit, robots, queue);
  return { controller, livekit, robots, queue };
}

function robot(
  visibility: Visibility = 'PUBLIC',
  accessMode: AccessMode = 'OPEN',
  video: VideoAccess = 'ALL',
) {
  return {
    id: 'robot-1',
    name: 'Robot One',
    ownerId: 'owner-1',
    visibility,
    accessMode,
    queueMode: 'ENABLED',
    metadata: { access: { video } },
  };
}

describe('LivekitController access policy', () => {
  const matrix = VISIBILITIES.flatMap((visibility) =>
    ACCESS_MODES.flatMap((accessMode) =>
      VIDEO_ACCESS_POLICIES.map((video) => ({
        visibility,
        accessMode,
        video,
      })),
    ),
  );

  it.each(matrix)(
    'enforces guest video for $visibility/$accessMode/$video without a grant',
    async ({ visibility, accessMode, video }) => {
      const { controller, robots, livekit } = buildController();
      robots.findById.mockResolvedValue(robot(visibility, accessMode, video));
      const expectedAllowed = visibility !== 'PRIVATE' && video === 'ALL' && accessMode === 'OPEN';
      robots.validateRoomAccess.mockResolvedValue(accessMode === 'OPEN');

      const request = controller.getPublicViewerToken('robot-1');
      if (expectedAllowed) {
        await expect(request).resolves.toEqual({
          token: 'viewer-token',
          livekitUrl: 'wss://livekit.example.test',
        });
        expect(livekit.generateViewerToken).toHaveBeenCalledWith(
          'robot-1',
          expect.stringMatching(/^guest-/),
          'Guest',
          false,
        );
      } else {
        await expect(request).rejects.toBeInstanceOf(
          visibility === 'PRIVATE' ? NotFoundException : ForbiddenException,
        );
        expect(livekit.generateViewerToken).not.toHaveBeenCalled();
      }

      if (visibility !== 'PRIVATE' && video === 'ALL') {
        expect(robots.validateRoomAccess).toHaveBeenCalledWith({
          robotId: 'robot-1',
          actorId: expect.stringMatching(/^guest:/),
          roomAccessToken: undefined,
        });
      } else {
        expect(robots.validateRoomAccess).not.toHaveBeenCalled();
      }
    },
  );

  it.each(RESTRICTED_ACCESS_MODES)(
    'accepts a verified guest grant for %s rooms',
    async (accessMode) => {
      const { controller, robots, livekit } = buildController();
      robots.findById.mockResolvedValue(robot('UNLISTED', accessMode, 'ALL'));
      robots.resolveRoomAccessActorId.mockResolvedValue('guest:grant-holder');

      await expect(
        controller.getPublicViewerToken('robot-1', 'browser-session', 'room-token'),
      ).resolves.toEqual({
        token: 'viewer-token',
        livekitUrl: 'wss://livekit.example.test',
      });
      expect(robots.validateRoomAccess).toHaveBeenCalledWith({
        robotId: 'robot-1',
        actorId: 'guest:grant-holder',
        roomAccessToken: 'room-token',
      });
      expect(livekit.generateViewerToken).toHaveBeenCalledWith(
        'robot-1',
        'guest-grant-holder',
        'Guest',
        false,
      );
    },
  );

  it('uses a validated browser guest session when no grant identity exists', async () => {
    const { controller, robots } = buildController();
    robots.findById.mockResolvedValue(robot());
    robots.resolveGuestActorId.mockReturnValue('guest:browser-session');

    await controller.getPublicViewerToken('robot-1', 'browser-session');

    expect(robots.validateRoomAccess).toHaveBeenCalledWith({
      robotId: 'robot-1',
      actorId: 'guest:browser-session',
      roomAccessToken: undefined,
    });
  });

  it.each([null, [], {}, { access: [] }, { access: { video: 'invalid' } }])(
    'defaults malformed metadata to authenticated video access',
    async (metadata) => {
      const { controller, robots } = buildController();
      robots.findById.mockResolvedValue({ ...robot(), metadata });

      await expect(controller.getPublicViewerToken('robot-1')).rejects.toThrow(
        'Guest video access is disabled',
      );
    },
  );

  it('requires room authorization for authenticated viewers', async () => {
    const { controller, robots, livekit } = buildController();
    robots.findById.mockResolvedValue(robot());
    robots.validateRoomAccess.mockResolvedValue(false);

    await expect(controller.getViewerToken('robot-1', user)).rejects.toThrow(
      'Room access verification required',
    );
    expect(livekit.generateViewerToken).not.toHaveBeenCalled();
  });

  it('does not disclose private rooms to unauthorized authenticated viewers', async () => {
    const { controller, robots, livekit } = buildController();
    robots.findById.mockResolvedValue(robot('PRIVATE'));
    robots.validateRoomAccess.mockResolvedValue(false);

    await expect(controller.getViewerToken('robot-1', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(livekit.generateViewerToken).not.toHaveBeenCalled();
  });

  it('rejects authenticated viewers when video is disabled', async () => {
    const { controller, robots } = buildController();
    robots.findById.mockResolvedValue(robot('PUBLIC', 'OPEN', 'DISABLED'));

    await expect(controller.getViewerToken('robot-1', user)).rejects.toThrow(
      'Video is disabled for this robot',
    );
    expect(robots.validateRoomAccess).toHaveBeenCalled();
  });

  it.each([
    ['not requested', user, 'ENABLED', 'AUTHENTICATED', null, undefined, false],
    ['control disabled', user, 'ENABLED', 'DISABLED', null, 'true', false],
    ['owner', { ...user, sub: 'owner-1' }, 'ENABLED', 'AUTHENTICATED', null, 'true', true],
    ['staff', { ...user, role: Role.MOD }, 'ENABLED', 'AUTHENTICATED', null, 'true', true],
    ['queue disabled', user, 'DISABLED', 'AUTHENTICATED', null, 'true', true],
    ['current controller', user, 'ENABLED', 'AUTHENTICATED', 'user-1', 'true', true],
    ['queued viewer', user, 'ENABLED', 'AUTHENTICATED', 'user-2', 'true', false],
  ] as const)(
    'issues the expected data grant when control is %s',
    async (_case, viewer, queueMode, controlPolicy, currentController, requested, expected) => {
      const { controller, robots, queue, livekit } = buildController();
      robots.findById.mockResolvedValue({ ...robot(), queueMode });
      robots.getAccessPolicy.mockResolvedValue({ control: controlPolicy });
      queue.getCurrentControllerUserId.mockResolvedValue(currentController);

      await controller.getViewerToken('robot-1', viewer, requested);

      expect(livekit.generateViewerToken).toHaveBeenCalledWith(
        'robot-1',
        viewer.sub,
        viewer.username,
        expected,
      );
    },
  );

  it('issues publisher tokens only to the robot owner', async () => {
    const allowed = buildController();
    allowed.robots.findById.mockResolvedValue(robot());
    await expect(
      allowed.controller.getRobotToken('robot-1', { ...user, sub: 'owner-1' }),
    ).resolves.toEqual({ token: 'robot-token', livekitUrl: 'wss://livekit.example.test' });

    const denied = buildController();
    denied.robots.findById.mockResolvedValue(robot());
    await expect(denied.controller.getRobotToken('robot-1', user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
