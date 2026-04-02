'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { subscribeToToasts, type ToastMessage } from '@/lib/toast';

const styles: Record<ToastMessage['kind'], { icon: typeof Info; cls: string }> = {
  success: {
    icon: CheckCircle2,
    cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100',
  },
  error: {
    icon: AlertCircle,
    cls: 'border-red-500/40 bg-red-500/15 text-red-100',
  },
  info: {
    icon: Info,
    cls: 'border-sky-500/40 bg-sky-500/15 text-sky-100',
  },
};

export function ToastStack() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToToasts((toast) => {
      setToasts((prev) => [...prev, toast]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== toast.id));
      }, toast.durationMs);
    });
  }, []);

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const config = styles[toast.kind];
        const Icon = config.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg shadow-black/30 backdrop-blur-sm ${config.cls}`}
          >
            <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p className="flex-1 leading-5">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
              className="rounded p-0.5 opacity-70 transition hover:bg-black/20 hover:opacity-100"
              aria-label="Close notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
