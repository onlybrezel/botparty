import { act, renderHook } from '@testing-library/react';
import { useVisibilityPolling } from './use-visibility-polling';

describe('useVisibilityPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
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

  it('does not report an in-flight refresh failure after page navigation starts', async () => {
    let rejectTask: ((reason: Error) => void) | undefined;
    const task = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectTask = reject;
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { unmount } = renderHook(() =>
      useVisibilityPolling(task, { intervalMs: 1_000 }),
    );

    act(() => window.dispatchEvent(new Event('pagehide')));
    await act(async () => {
      rejectTask?.(new Error('navigation aborted the request'));
    });

    expect(consoleError).not.toHaveBeenCalled();
    unmount();
    consoleError.mockRestore();
  });

  it('resumes polling when a page is restored from browser history', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useVisibilityPolling(task, { intervalMs: 1_000 }),
    );

    await act(async () => undefined);
    expect(task).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => window.dispatchEvent(new Event('pageshow')));
    await act(async () => undefined);

    expect(task).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('pauses while offline and refreshes once connectivity returns', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderHook(() =>
      useVisibilityPolling(task, { intervalMs: 1_000 }),
    );

    await act(async () => undefined);
    expect(task).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event('offline')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(task).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => undefined);
    expect(task).toHaveBeenCalledTimes(2);

    unmount();
    consoleError.mockRestore();
  });
});
