/* eslint-disable @next/next/no-img-element */
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import { render, screen } from '@testing-library/react';
import { QueueMode, RobotAccessMode, RobotStatus, RobotVisibility, Role } from '@botparty/shared';
import RobotCard from './robot-card';

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

describe('RobotCard', () => {
  it('renders key room details and room link', () => {
    render(
      <RobotCard
        robot={{
          id: 'robot-1',
          name: 'Mars Rover',
          slug: 'mars-rover',
          description: 'Explore rocks with a queue-based rover.',
          thumbnailUrl: null,
          status: RobotStatus.ONLINE,
          visibility: RobotVisibility.PUBLIC,
          accessMode: RobotAccessMode.OPEN,
          queueMode: QueueMode.FIRST_COME,
          maxTurnTime: 60000,
          maxViewers: 100,
          maxControllers: 10,
          metadata: null,
          tags: ['rover', 'camera'],
          viewerCount: 42,
          owner: {
            id: 'user-1',
            username: 'julien',
            displayName: 'Julien',
            avatarUrl: null,
            role: Role.USER,
            createdAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        }}
      />,
    );

    expect(screen.getByText('Mars Rover')).toBeInTheDocument();
    expect(screen.getByText('42 watching')).toBeInTheDocument();
    expect(screen.getByText('Turn queue')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/robot/julien/mars-rover');
  });
});
