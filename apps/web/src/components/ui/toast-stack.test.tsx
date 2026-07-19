import { act, render, screen } from '@testing-library/react';
import { pushToast } from '@/lib/toast';
import { ToastStack } from './toast-stack';

describe('ToastStack', () => {
  it('announces errors urgently and other feedback politely', () => {
    vi.useFakeTimers();
    const view = render(<ToastStack />);

    act(() => {
      pushToast('Profile updated.', 'success');
      pushToast('Profile could not be saved.', 'error');
    });

    expect(screen.getByRole('status')).toHaveTextContent('Profile updated.');
    expect(screen.getByRole('alert')).toHaveTextContent('Profile could not be saved.');

    view.unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps repeated feedback from filling the screen', () => {
    vi.useFakeTimers();
    const view = render(<ToastStack />);

    act(() => {
      pushToast('Profile updated.', 'success');
      pushToast('Profile updated.', 'success');
    });

    expect(screen.getAllByRole('status')).toHaveLength(1);

    view.unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
