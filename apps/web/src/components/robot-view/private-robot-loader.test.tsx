import { render, screen, waitFor } from '@testing-library/react';
import type { RobotPublic } from '@botparty/shared';
import { PrivateRobotLoader } from './private-robot-loader';

const mocks = vi.hoisted(() => ({
  auth: { accessToken: 'token' as string | null, hasHydrated: true },
  replace: vi.fn(),
  setToken: vi.fn(),
  getPrivateRobot: vi.fn(),
  getPrivateRobotBySlug: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/store', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/api', () => ({
  api: {
    setToken: mocks.setToken,
    robots: {
      getPrivateRobot: mocks.getPrivateRobot,
      getPrivateRobotBySlug: mocks.getPrivateRobotBySlug,
    },
  },
}));
vi.mock('./offline-robot-view', () => ({
  OfflineRobotView: ({ robot }: { robot: RobotPublic }) => (
    <div data-testid="offline-room">{robot.slug}</div>
  ),
}));
vi.mock('./online-robot-view-loader', () => ({
  OnlineRobotViewLoader: ({ robot }: { robot: RobotPublic }) => (
    <div data-testid="online-room">{robot.slug}</div>
  ),
}));
vi.mock('./robot-room-skeleton', () => ({
  RobotRoomSkeleton: () => <div data-testid="room-skeleton" />,
}));

const privateRobot = {
  slug: 'private-bot',
  status: 'OFFLINE',
  owner: { username: 'owner' },
} as RobotPublic;

describe('PrivateRobotLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.accessToken = 'token';
    mocks.auth.hasHydrated = true;
    mocks.getPrivateRobot.mockResolvedValue(privateRobot);
    mocks.getPrivateRobotBySlug.mockResolvedValue(privateRobot);
  });

  it('waits for auth hydration before requesting the private room', () => {
    mocks.auth.hasHydrated = false;
    render(<PrivateRobotLoader slug="private-bot" />);
    expect(screen.getByTestId('room-skeleton')).toBeInTheDocument();
    expect(mocks.getPrivateRobotBySlug).not.toHaveBeenCalled();
  });

  it('offers sign-in without requesting a private room for guests', async () => {
    mocks.auth.accessToken = null;
    render(<PrivateRobotLoader slug="private-bot" />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(mocks.getPrivateRobotBySlug).not.toHaveBeenCalled();
  });

  it('uses the lightweight view for an offline private robot', async () => {
    render(<PrivateRobotLoader slug="private-bot" username="owner" />);
    expect(await screen.findByTestId('offline-room')).toHaveTextContent('private-bot');
    expect(mocks.setToken).toHaveBeenCalledWith('token');
    expect(mocks.getPrivateRobot).toHaveBeenCalledWith('owner', 'private-bot');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('loads the interactive view only for connected robots and repairs legacy paths', async () => {
    mocks.getPrivateRobotBySlug.mockResolvedValue({ ...privateRobot, status: 'ONLINE' });
    render(<PrivateRobotLoader slug="legacy-slug" />);
    expect(await screen.findByTestId('online-room')).toHaveTextContent('private-bot');
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith('/robot/owner/private-bot');
    });
  });
});
