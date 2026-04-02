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

  for (const listener of listeners) {
    listener(toast);
  }
}

export function subscribeToToasts(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
