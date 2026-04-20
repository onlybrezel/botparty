import { render, screen } from '@testing-library/react';
import { RobotRoomSkeleton } from './robot-room-skeleton';

describe('RobotRoomSkeleton', () => {
  it('announces robot room loading state', () => {
    render(<RobotRoomSkeleton />);

    expect(screen.getByRole('status', { name: 'Loading robot room' })).toBeInTheDocument();
  });
});