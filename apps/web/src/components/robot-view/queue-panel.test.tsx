import type { AnchorHTMLAttributes } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueueMode, RobotAccessMode, RobotStatus, RobotVisibility, Role } from '@botparty/shared';
import { RobotQueuePanel } from './queue-panel';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const robot = {
  id: 'robot-1',
  name: 'Queue Bot',
  slug: 'queue-bot',
  description: null,
  thumbnailUrl: null,
  status: RobotStatus.ONLINE,
  visibility: RobotVisibility.PUBLIC,
  accessMode: RobotAccessMode.OPEN,
  queueMode: QueueMode.VOTING,
  maxTurnTime: 60000,
  maxViewers: 50,
  maxControllers: 10,
  metadata: null,
  tags: [] as string[],
  viewerCount: 0,
  owner: {
    id: 'owner-1',
    username: 'owner',
    displayName: null,
    avatarUrl: null,
    role: Role.USER,
    createdAt: new Date().toISOString(),
  },
  createdAt: new Date().toISOString(),
};

describe('RobotQueuePanel', () => {
  it('shows queue entries and lets signed-in users vote', () => {
    const onVoteForUser = vi.fn();

    render(
      <RobotQueuePanel
        queue={[
          { userId: 'u1', username: 'alpha', position: 1, votes: 4 },
          { userId: 'u2', username: 'beta', position: 2, votes: 2 },
        ]}
        queueEnabled
        accessToken="token"
        userId="viewer-1"
        inQueue={false}
        queueAction={null}
        activeSession={null}
        votingForUserId={null}
        robot={robot}
        onToggleQueue={vi.fn()}
        onVoteForUser={onVoteForUser}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
    expect(onVoteForUser).toHaveBeenCalledWith('u2');
    expect(screen.getByText('4 votes')).toBeInTheDocument();
  });
});
