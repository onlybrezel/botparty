import { fireEvent, render, screen } from '@testing-library/react';
import { RoomOnboardingOverlay } from './room-onboarding-overlay';

describe('RoomOnboardingOverlay', () => {
  it('renders the first-time guidance and dismisses it', () => {
    const onDismiss = vi.fn();

    render(<RoomOnboardingOverlay queueEnabled signedIn={false} onDismiss={onDismiss} />);

    expect(screen.getByRole('dialog', { name: 'Room onboarding' })).toBeInTheDocument();
    expect(screen.getByText('Sign in and join the queue')).toBeInTheDocument();
    expect(screen.getByText('Take your turn')).toBeInTheDocument();
    expect(screen.getByText('Watch the robot move')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss room onboarding' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});