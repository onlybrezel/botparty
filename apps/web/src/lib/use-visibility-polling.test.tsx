import { act, renderHook } from '@testing-library/react';
import { useVisibilityPolling } from './use-visibility-polling';

describe('useVisibilityPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately, avoids overlap, and pauses while the document is hidden', async () => {
    let release: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    const { unmount } = renderHook(() =>
      useVisibilityPolling(task, { intervalMs: 1_000, hiddenIntervalMs: null }),
    );

    expect(task).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(task).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(task).toHaveBeenCalledTimes(2);
    unmount();
  });
});
