'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { NotificationRecord } from '@/lib/api/notifications';
import { useVisibilityPolling } from '@/lib/use-visibility-polling';

export function NotificationCenter({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const result = await api.notifications.list();
    setItems(result.items);
    setUnread(result.unreadCount);
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const item of result.items) {
      if (!item.browserRequested || item.readAt) continue;
      const key = `botparty.notification.shown.${item.id}`;
      if (sessionStorage.getItem(key)) continue;
      new Notification(item.title, { body: item.body, tag: item.id });
      sessionStorage.setItem(key, '1');
    }
  }, [enabled]);

  useVisibilityPolling(load, { enabled, intervalMs: 30_000, hiddenIntervalMs: null });

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => void load().catch((error: unknown) => {
      console.error('Failed to refresh notifications', error);
    });
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, load]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', closeWithEscape);
    return () => document.removeEventListener('keydown', closeWithEscape);
  }, [open]);

  const markRead = async (item: NotificationRecord) => {
    if (!item.readAt) {
      try {
        await api.notifications.markRead(item.id);
      } catch (error) {
        console.error('Failed to mark notification as read', error);
        return;
      }
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
      setUnread((current) => Math.max(0, current - 1));
    }
    setOpen(false);
  };

  if (!enabled) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold text-white">
            {Math.min(unread, 99)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                className="text-xs text-violet-300"
                onClick={() => void api.notifications.markAllRead().then(() => {
                  setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
                  setUnread(0);
                }).catch((error: unknown) => {
                  console.error('Failed to mark notifications as read', error);
                })}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">No notifications yet.</p>
            ) : items.map((item) => (
              <Link
                key={item.id}
                href={item.actionUrl ?? '/'}
                onClick={() => void markRead(item)}
                className={`block border-b border-[var(--border)] px-4 py-3 last:border-0 ${item.readAt ? 'opacity-65' : 'bg-violet-500/5'}`}
              >
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.body}</p>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
