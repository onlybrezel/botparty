import type { ReactElement } from 'react';
import type { RobotPublic } from '@botparty/shared';
import { Role } from '@botparty/shared';

const notFound = vi.fn(() => {
  throw new Error('notFound');
});

const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});

vi.mock('next/navigation', () => ({
  notFound,
  permanentRedirect,
}));

vi.mock('@/lib/server-api-url', () => ({
  getServerApiUrl: () => 'https://api.example.com',
}));

vi.mock('@/components/robot-view/private-robot-loader', () => ({
  PrivateRobotLoader: ({ slug, username }: { slug: string; username?: string | null }) => (
    <div data-slug={slug} data-username={username ?? ''} />
  ),
}));

vi.mock('@/components/robot-view/online-robot-view-loader', () => ({
  OnlineRobotViewLoader: ({ robot }: { robot: RobotPublic }) => <div data-robot={robot.slug} />,
}));

vi.mock('@/components/robot-view/offline-robot-view', () => ({
  OfflineRobotView: ({ robot }: { robot: RobotPublic }) => <div data-offline-robot={robot.slug} />,
}));

function createResponse(robot: Partial<RobotPublic>, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(robot),
  } as Response;
}

describe('robot catch-all route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('redirects legacy slug routes to the canonical owner route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          createResponse({
            name: 'Mars Rover',
            slug: 'mars-rover',
            owner: {
              id: 'owner-1',
              username: 'julien',
              displayName: 'Julien',
              avatarUrl: null,
              role: Role.USER,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        ),
      ),
    );

    const { default: RobotPage } = await import('./page');

    await expect(RobotPage({ params: Promise.resolve({ parts: ['mars-rover'] }) })).rejects.toThrow(
      'redirect:/robot/julien/mars-rover',
    );
    expect(permanentRedirect).toHaveBeenCalledWith('/robot/julien/mars-rover');
  });

  it('renders the private loader when the public lookup misses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createResponse({}, 404))),
    );

    const { default: RobotPage } = await import('./page');
    const result = (await RobotPage({
      params: Promise.resolve({ parts: ['secret-bot'] }),
    })) as ReactElement<{ slug: string; username?: string | null }>;

    expect(result.props.slug).toBe('secret-bot');
    expect(result.props.username).toBeNull();
  });

  it('uses the lightweight room view while a public robot is offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createResponse({
        name: 'Mars Rover',
        slug: 'mars-rover',
        status: 'OFFLINE' as RobotPublic['status'],
        owner: {
          id: 'owner-1',
          username: 'julien',
          displayName: 'Julien',
          avatarUrl: null,
          role: Role.USER,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }))),
    );

    const { default: RobotPage } = await import('./page');
    const { OfflineRobotView } = await import('@/components/robot-view/offline-robot-view');
    const result = (await RobotPage({
      params: Promise.resolve({ parts: ['julien', 'mars-rover'] }),
    })) as ReactElement<{ robot: RobotPublic }>;

    expect(result.props.robot.status).toBe('OFFLINE');
    expect(result.type).toBe(OfflineRobotView);
  });

  it('loads the interactive room view for an online robot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(createResponse({
        name: 'Mars Rover',
        slug: 'mars-rover',
        status: 'ONLINE' as RobotPublic['status'],
        owner: {
          id: 'owner-1',
          username: 'julien',
          displayName: 'Julien',
          avatarUrl: null,
          role: Role.USER,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }))),
    );

    const { default: RobotPage } = await import('./page');
    const { OnlineRobotViewLoader } = await import(
      '@/components/robot-view/online-robot-view-loader'
    );
    const result = (await RobotPage({
      params: Promise.resolve({ parts: ['julien', 'mars-rover'] }),
    })) as ReactElement<{ robot: RobotPublic }>;

    expect(result.props.robot.status).toBe('ONLINE');
    expect(result.type).toBe(OnlineRobotViewLoader);
  });

  it('rejects routes with too many path segments', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { default: RobotPage } = await import('./page');

    await expect(
      RobotPage({ params: Promise.resolve({ parts: ['one', 'two', 'three'] }) }),
    ).rejects.toThrow('notFound');
    expect(notFound).toHaveBeenCalled();
  });
});
