'use client';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastMessage = {
  id: string;
  message: string;
  kind: ToastKind;
  durationMs: number;
};

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
const pendingToasts: ToastMessage[] = [];

export function pushToast(
  message: string,
  kind: ToastKind = 'info',
  durationMs = 2600,
) {
  const toast: ToastMessage = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    kind,
    durationMs,
  };

  if (listeners.size === 0) {
    pendingToasts.push(toast);
    return;
  }

  for (const listener of listeners) {
    listener(toast);
  }
}

export function subscribeToToasts(listener: Listener) {
  listeners.add(listener);
  if (pendingToasts.length > 0) {
    for (const toast of pendingToasts.splice(0, pendingToasts.length)) {
      listener(toast);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
