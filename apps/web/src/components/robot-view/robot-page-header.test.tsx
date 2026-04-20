import type { AnchorHTMLAttributes } from 'react';
import { render, screen } from '@testing-library/react';
import { RobotPageHeader } from './robot-page-header';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('RobotPageHeader', () => {
  it('renders reconnect status notice when the socket is offline', () => {
    render(
      <RobotPageHeader
        robotName="Mars Rover"
        connected={false}
        viewerLabel="42 watching"
        reconnectNotice={{
          reason: 'update',
          message: 'Realtime services are restarting.',
          retryAt: Date.now() + 5000,
        }}
        reconnectSeconds={5}
        robotStatus="ONLINE"
        queueSummary="3 waiting"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Update in progress');
    expect(screen.getByRole('status')).toHaveTextContent('Trying again in about 5s.');
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore');
  });
});