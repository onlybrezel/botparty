// Types, constants, and helpers for the robot view component

export interface ControlButton {
  id: string;
  label: string;
  command: string;
  hotKey: string | null;
  icon: string | null;
  cooldownMs: number;
  costCredits: number;
  access: string;
  position: number;
  color: string | null;
}

export interface ChatMsg {
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
  clientMessageId?: string;
}

export interface Viewer {
  userId: string;
  username: string;
  joinedAt: number;
}

export interface QueueEntry {
  userId: string;
  username: string;
  position: number;
  votes?: number;
}

export type SliderWidgetConfig = {
  kind: 'slider';
  min: number;
  max: number;
  start: number;
  step: number;
  direction: 'horizontal' | 'vertical';
  returnMode: 'center' | 'none';
  resetOnQueueLoss: boolean;
  resetOnOffline: boolean;
  resetAfterMs: number | null;
};

export type XYWidgetConfig = {
  kind: 'xy';
  xMin: number;
  xMax: number;
  xStart: number;
  yMin: number;
  yMax: number;
  yStart: number;
  returnMode: 'center' | 'none';
  resetOnQueueLoss: boolean;
  resetOnOffline: boolean;
  resetAfterMs: number | null;
};

export type WidgetConfig = SliderWidgetConfig | XYWidgetConfig;

export type QueueEntryWire = {
  userId: string;
  username?: string;
  position: number;
  votes?: number;
  user?: {
    username?: string;
    displayName?: string | null;
  };
};

export interface ActiveSessionState {
  sessionId: string;
  userId: string;
  username: string;
  startedAt: number;
  expiresAt: number | null;
}

export interface ReconnectNotice {
  message: string;
  reason: string;
  retryAt: number;
}

export type FocusMode = 'controls' | 'chat';

export function resolveWsUrl(): string {
  const configured = process.env['NEXT_PUBLIC_API_URL'];

  if (!configured) {
    return `${window.location.origin.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))}/ws`;
  }

  try {
    const url = new URL(configured);
    const isConfiguredLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isCurrentHostLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    const base = isConfiguredLocalhost && !isCurrentHostLocalhost
      ? window.location.origin
      : configured;

    return `${base.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))}/ws`;
  } catch {
    return `${window.location.origin.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))}/ws`;
  }
}

export const WASD: Record<string, string> = {
  w: 'forward', arrowup: 'forward',
  s: 'backward', arrowdown: 'backward',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};

export function getOrCreateGuestSessionId(): string {
  if (typeof window === 'undefined') {
    return crypto.randomUUID();
  }

  const storageKey = 'botparty.guestSessionId.v1';

  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      return existing;
    }

    const next = crypto.randomUUID();
    window.localStorage.setItem(storageKey, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

export function normalizeQueueEntries(rows: QueueEntryWire[] | undefined): QueueEntry[] {
  if (!rows?.length) {
    return [];
  }

  return rows.map((row) => ({
    userId: row.userId,
    username: row.username ?? row.user?.displayName ?? row.user?.username ?? row.userId.slice(0, 8),
    position: row.position,
    votes: typeof row.votes === 'number' ? row.votes : 0,
  }));
}

export function buildGuestMessageId() {
  return crypto.randomUUID();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseWidgetConfig(icon: string | null): WidgetConfig | null {
  if (!icon) return null;

  const raw = icon.trim();
  if (!raw.startsWith('widget:')) return null;

  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const kind = parts[1]?.toLowerCase();
  const kv = new Map<string, string>();
  for (const segment of parts.slice(2)) {
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    kv.set(segment.slice(0, eq).trim().toLowerCase(), segment.slice(eq + 1).trim());
  }

  const num = (keys: string[], fallback: number) => {
    for (const key of keys) {
      const value = kv.get(key);
      if (value === undefined) continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  const bool = (keys: string[], fallback: boolean) => {
    for (const key of keys) {
      const value = kv.get(key);
      if (value === undefined) continue;
      const normalized = value.toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return fallback;
  };

  const returnRaw = (kv.get('r') ?? kv.get('return') ?? kv.get('mode') ?? 'c').toLowerCase();
  const returnMode: 'center' | 'none' = returnRaw === 'n' || returnRaw === 'none' ? 'none' : 'center';
  const resetOnQueueLoss = bool(['rq', 'resetqueue', 'reset_on_queue'], false);
  const resetOnOffline = bool(['ro', 'resetoffline', 'reset_on_offline'], true);
  const resetAfterRaw = num(['ttl', 'resetafter', 'reset_after_ms'], -1);
  const resetAfterMs = resetAfterRaw >= 100 ? Math.round(resetAfterRaw) : null;

  if (kind === 's' || kind === 'slider') {
    const min = num(['min', 'n'], -100);
    const max = num(['max', 'x'], 100);
    if (max <= min) return null;
    const start = clamp(num(['start', 'v0', 'center', 'c'], 0), min, max);
    const step = Math.max(0.01, num(['step', 'st'], 1));
    const dirRaw = (kv.get('dir') ?? kv.get('d') ?? 'h').toLowerCase();
    const direction: 'horizontal' | 'vertical' = dirRaw === 'v' || dirRaw === 'vertical' ? 'vertical' : 'horizontal';
    return { kind: 'slider', min, max, start, step, direction, returnMode, resetOnQueueLoss, resetOnOffline, resetAfterMs };
  }

  if (kind === 'xy' || kind === 'xypad') {
    const xMin = num(['xmin', 'xn'], -100);
    const xMax = num(['xmax', 'xx'], 100);
    const yMin = num(['ymin', 'yn'], -100);
    const yMax = num(['ymax', 'yx'], 100);
    if (xMax <= xMin || yMax <= yMin) return null;
    const xStart = clamp(num(['xstart', 'x0'], 0), xMin, xMax);
    const yStart = clamp(num(['ystart', 'y0'], 0), yMin, yMax);
    return { kind: 'xy', xMin, xMax, xStart, yMin, yMax, yStart, returnMode, resetOnQueueLoss, resetOnOffline, resetAfterMs };
  }

  return null;
}
