import { render, screen } from '@testing-library/react';
import { RobotCardGridSkeleton } from './robot-card-grid-skeleton';

describe('RobotCardGridSkeleton', () => {
  it('announces robot card loading state', () => {
    render(<RobotCardGridSkeleton />);

    expect(screen.getByRole('status', { name: 'Loading robot cards' })).toBeInTheDocument();
  });
});