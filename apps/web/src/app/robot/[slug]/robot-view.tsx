'use client';

import { useEffect, useRef, useCallback, useState, useLayoutEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { RobotPublic } from '@botparty/shared';
import { AlertTriangle, Bot, Radio, Video, Gamepad2 } from 'lucide-react';
import { api, type AdminRobotRecordingStatus } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { LiveKitPlayer } from '@/components/livekit-player';
import { pushToast } from '@/lib/toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ControlButton {
  id: string;
  label: string;
  command: string;
  hotKey: string | null;
  icon: string | null;
  cooldownMs: number;
  access: string;
  position: number;
  color: string | null;
}

interface ChatMsg {
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
  clientMessageId?: string;
}

interface Viewer {
  userId: string;
  username: string;
  joinedAt: number;
}

interface QueueEntry {
  userId: string;
  username: string;
  position: number;
  votes?: number;
}

type SliderWidgetConfig = {
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

type XYWidgetConfig = {
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

type WidgetConfig = SliderWidgetConfig | XYWidgetConfig;

type QueueEntryWire = {
  userId: string;
  username?: string;
  position: number;
  votes?: number;
  user?: {
    username?: string;
    displayName?: string | null;
  };
};

interface ActiveSessionState {
  sessionId: string;
  userId: string;
  username: string;
  startedAt: number;
  expiresAt: number | null;
}

interface ReconnectNotice {
  message: string;
  reason: string;
  retryAt: number;
}

type FocusMode = 'controls' | 'chat';

function resolveWsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;

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

// ─── WASD Keys ────────────────────────────────────────────────────────────────

const WASD: Record<string, string> = {
  w: 'forward', arrowup: 'forward',
  s: 'backward', arrowdown: 'backward',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};

function getOrCreateGuestSessionId(): string {
  const fallback = Math.random().toString(36).slice(2, 14);
  if (typeof window === 'undefined') return fallback;

  try {
    const key = 'botparty.guestSessionId.v1';
    const stored = window.localStorage.getItem(key);
    const normalized = (stored ?? '').trim().toLowerCase();
    if (/^[a-z0-9_-]{6,64}$/.test(normalized)) {
      return normalized;
    }

    window.localStorage.setItem(key, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

function normalizeQueueEntries(rows: QueueEntryWire[] | undefined): QueueEntry[] {
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

function buildGuestMessageId() {
  return `guest-msg-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseWidgetConfig(icon: string | null): WidgetConfig | null {
  if (!icon) {
    return null;
  }

  const raw = icon.trim();
  if (!raw.startsWith('widget:')) {
    return null;
  }

  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const kind = parts[1]?.toLowerCase();
  const kv = new Map<string, string>();
  for (const segment of parts.slice(2)) {
    const eq = segment.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    kv.set(segment.slice(0, eq).trim().toLowerCase(), segment.slice(eq + 1).trim());
  }

  const num = (keys: string[], fallback: number) => {
    for (const key of keys) {
      const value = kv.get(key);
      if (value === undefined) {
        continue;
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  };

  const bool = (keys: string[], fallback: boolean) => {
    for (const key of keys) {
      const value = kv.get(key);
      if (value === undefined) {
        continue;
      }
      const normalized = value.toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
      }
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
    if (max <= min) {
      return null;
    }
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
    if (xMax <= xMin || yMax <= yMin) {
      return null;
    }
    const xStart = clamp(num(['xstart', 'x0'], 0), xMin, xMax);
    const yStart = clamp(num(['ystart', 'y0'], 0), yMin, yMax);
    return { kind: 'xy', xMin, xMax, xStart, yMin, yMax, yStart, returnMode, resetOnQueueLoss, resetOnOffline, resetAfterMs };
  }

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  robot: RobotPublic;
}

export default function RobotView({ robot }: Props) {
  const searchParams = useSearchParams();
  const { accessToken, userId, username, role, hasHydrated } = useAuth();

  const [focusMode, setFocusMode] = useState<FocusMode>('controls');
  const [controlButtons, setControlButtons] = useState<ControlButton[]>([]);
  const [, setActiveKeys] = useState<Set<string>>(new Set());
  const [activeCommands, setActiveCommands] = useState<Set<string>>(new Set());
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [crowdInputs, setCrowdInputs] = useState<Map<string, number>>(new Map());
  const [messages, setMessages] = useState<ChatMsg[]>([
    { userId: 'system', username: 'system', content: `Welcome to ${robot.name}!`, timestamp: Date.now(), isSystem: true },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [inQueue, setInQueue] = useState(false);
  const [livekitCreds, setLivekitCreds] = useState<{ token: string; url: string } | null>(null);
  const [livekitVersion, setLivekitVersion] = useState(0);
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [moderatingUserId, setModeratingUserId] = useState<string | null>(null);
  const [robotStatus, setRobotStatus] = useState(robot.status);
  const [chatRestriction, setChatRestriction] = useState<string | null>(null);
  const [votingForUserId, setVotingForUserId] = useState<string | null>(null);
  const [tabSwitchOnlyWhenEmpty, setTabSwitchOnlyWhenEmpty] = useState(true);
  const [guestSessionId] = useState<string>(() => getOrCreateGuestSessionId());
  const currentViewerId = userId ? userId : `guest:${guestSessionId}`;
  const inviteCodeFromUrl =
    searchParams.get('invite')?.trim()
    ?? searchParams.get('code')?.trim()
    ?? '';
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null);
  const [accessPasswordInput, setAccessPasswordInput] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [turnCountdownMs, setTurnCountdownMs] = useState<number | null>(null);
  const [reconnectNotice, setReconnectNotice] = useState<ReconnectNotice | null>(null);
  const [reconnectCountdownMs, setReconnectCountdownMs] = useState<number | null>(null);
  const [widgetQueueResetEpoch, setWidgetQueueResetEpoch] = useState(0);
  const [widgetOfflineResetEpoch, setWidgetOfflineResetEpoch] = useState(0);
  const [recordingState, setRecordingState] = useState<AdminRobotRecordingStatus | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingAction, setRecordingAction] = useState<'start' | 'stop' | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const controlsPanelRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const cooldownMap = useRef<Map<string, number>>(new Map());
  const lastErrorToastRef = useRef<{ message: string; timestamp: number } | null>(null);
  const activeMotionKeysRef = useRef<Set<string>>(new Set());
  const livekitRefreshInFlightRef = useRef(false);
  const allowListAccessAttemptedRef = useRef(false);
  const linkOnlyAccessAttemptedRef = useRef(false);
  const previousRobotStatusRef = useRef(robot.status);
  const initialChatScrollDoneRef = useRef(false);
  const chatShouldStickRef = useRef(true);
  const shutdownNoticeAtRef = useRef(0);
  const reconnectRetryAfterRef = useRef<number | null>(null);
  const wasMyTurnRef = useRef(false);
  const wasOnlineRef = useRef(robot.status === 'ONLINE' || robot.status === 'BUSY');

  // ─── Fetch controls ────────────────────────────────────────────────────────

  const isAuthenticated = Boolean(accessToken && userId);
  const robotAccess = (robot as RobotPublic & {
    metadata?: {
      access?: {
        video?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
        estop?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      };
    };
  }).metadata?.access;
  const canUseAccess = (mode: 'ALL' | 'AUTHENTICATED' | 'DISABLED' | undefined) => {
    if (mode === 'DISABLED') return false;
    if (mode === 'ALL') return true;
    return isAuthenticated;
  };
  const guestVideoAllowed = robotAccess?.video === 'ALL';
  const estopAccess = robotAccess?.estop;
  const canUseEStop = canUseAccess(estopAccess);
  const canModerate = Boolean(userId && (userId === robot.owner.id || role === 'ADMIN' || role === 'MOD'));
  const isAdmin = role === 'ADMIN';
  const resolveUserLabel = useCallback(
    (targetUserId: string, preferredName?: string | null) => {
      if (preferredName?.trim()) {
        return preferredName.trim();
      }

      if (targetUserId === currentViewerId) {
        return 'you';
      }

      const chatMatch = [...messages].reverse().find((entry) => entry.userId === targetUserId && !entry.isSystem);
      if (chatMatch?.username) {
        return chatMatch.username;
      }

      const viewerMatch = viewers.find((entry) => entry.userId === targetUserId);
      if (viewerMatch?.username) {
        return viewerMatch.username;
      }

      const queueMatch = queue.find((entry) => entry.userId === targetUserId);
      if (queueMatch?.username) {
        return queueMatch.username;
      }

      if (activeSession?.userId === targetUserId && activeSession.username) {
        return activeSession.username;
      }

      return targetUserId.slice(0, 8);
    },
    [activeSession, currentViewerId, messages, queue, viewers],
  );

  useEffect(() => {
    let active = true;

    const sameButton = (a: ControlButton, b: ControlButton) =>
      a.id === b.id &&
      a.label === b.label &&
      a.command === b.command &&
      a.hotKey === b.hotKey &&
      a.icon === b.icon &&
      a.cooldownMs === b.cooldownMs &&
      a.access === b.access &&
      a.position === b.position &&
      a.color === b.color;

    const syncControls = () => {
      api.getControls(robot.id)
        .then((next) => {
          if (!active) return;
          setControlButtons((prev) => {
            if (prev.length === next.length && prev.every((entry, index) => sameButton(entry, next[index]!))) {
              return prev;
            }
            return next;
          });
        })
        .catch(() => {
          // Keep last known buttons when refresh fails.
        });
    };

    syncControls();
    const timer = setInterval(syncControls, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [accessToken, robot.id, roomAccessToken]);

  useEffect(() => {
    initialChatScrollDoneRef.current = false;
    chatShouldStickRef.current = true;
    
    // Load chat history from localStorage
    try {
      const key = `botparty.chat.${robot.id}`;
      const saved = window.localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMsg[];
        // Only restore if not older than 7 days
        const oldest = parsed[0];
        if (oldest && Date.now() - oldest.timestamp < 7 * 24 * 60 * 60 * 1000) {
          setMessages(parsed);
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [robot.id]);

  useEffect(() => {
    if (robot.accessMode === 'OPEN') {
      setRoomAccessToken(null);
      setAccessError(null);
      allowListAccessAttemptedRef.current = false;
      linkOnlyAccessAttemptedRef.current = false;
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(`botparty.room-access.${robot.id}`);
      setRoomAccessToken(stored);
      allowListAccessAttemptedRef.current = robot.accessMode === 'ALLOWED_USERS' && Boolean(stored);
      linkOnlyAccessAttemptedRef.current = robot.accessMode === 'LINK_ONLY' && Boolean(stored);
    } catch {
      setRoomAccessToken(null);
      allowListAccessAttemptedRef.current = false;
      linkOnlyAccessAttemptedRef.current = false;
    }
  }, [robot.accessMode, robot.id]);

  useEffect(() => {
    if (
      robot.accessMode !== 'ALLOWED_USERS' ||
      !accessToken ||
      roomAccessToken ||
      accessLoading ||
      allowListAccessAttemptedRef.current
    ) {
      return;
    }

    let active = true;
    setAccessLoading(true);
    allowListAccessAttemptedRef.current = true;
    api.setToken(accessToken);
    api.verifyRobotAccess(robot.id, { guestSessionId })
      .then((grant) => {
        if (!active) return;
        setRoomAccessToken(grant.token);
        setAccessError(null);
        window.sessionStorage.setItem(`botparty.room-access.${robot.id}`, grant.token);
      })
      .catch((err) => {
        if (!active) return;
        setAccessError(err instanceof Error ? err.message : 'Access denied');
      })
      .finally(() => {
        if (active) {
          setAccessLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessLoading, accessToken, guestSessionId, robot.accessMode, robot.id, roomAccessToken]);

  useEffect(() => {
    if (robot.accessMode !== 'LINK_ONLY' || roomAccessToken || linkOnlyAccessAttemptedRef.current) {
      return;
    }

    if (!inviteCodeFromUrl) {
      setAccessError('This room requires a valid invite link.');
      return;
    }

    linkOnlyAccessAttemptedRef.current = true;
    let active = true;
    setAccessLoading(true);
    setAccessError(null);
    api.setToken(accessToken);
    api.verifyRobotAccess(robot.id, {
      guestSessionId,
      inviteCode: inviteCodeFromUrl,
    })
      .then((grant) => {
        if (!active) return;
        setRoomAccessToken(grant.token);
        window.sessionStorage.setItem(`botparty.room-access.${robot.id}`, grant.token);
      })
      .catch((err) => {
        if (!active) return;
        linkOnlyAccessAttemptedRef.current = false;
        setAccessError(err instanceof Error ? err.message : 'Invite access denied');
      })
      .finally(() => {
        if (active) {
          setAccessLoading(false);
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, guestSessionId, inviteCodeFromUrl, robot.accessMode, robot.id, roomAccessToken]);

  // ─── Fetch LiveKit token (auth required) ──────────────────────────────────

  const refreshViewerToken = useCallback(async (forceRemount = false) => {
    if (!hasHydrated) {
      return;
    }

    const passwordGateMissing = robot.accessMode === 'PASSWORD' && !roomAccessToken;
    const allowlistGateMissing = robot.accessMode === 'ALLOWED_USERS' && !roomAccessToken && !accessToken;
    const linkGateMissing = robot.accessMode === 'LINK_ONLY' && !roomAccessToken;
    if (linkGateMissing || ((passwordGateMissing || allowlistGateMissing) && !guestVideoAllowed)) {
      setLivekitCreds(null);
      setVideoState('idle');
      return;
    }

    if (livekitRefreshInFlightRef.current) {
      return;
    }

    livekitRefreshInFlightRef.current = true;
    setVideoState('loading');
    try {
      const publicUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      api.setToken(accessToken);
      if (accessToken) {
        try {
          const { token, livekitUrl } = await api.getViewerToken(robot.id, false);
          setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
          setVideoState('ready');
          if (forceRemount) {
            setLivekitVersion((value) => value + 1);
          }
          return;
        } catch {
          // Fall back to guest viewer token.
        }
      }

      api.setToken(null);
      const { token, livekitUrl } = await api.getPublicViewerToken(robot.id);
      setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
      setVideoState('ready');
      if (forceRemount) {
        setLivekitVersion((value) => value + 1);
      }
    } catch {
      setLivekitCreds(null);
      setVideoState('error');
    } finally {
      livekitRefreshInFlightRef.current = false;
    }
  }, [accessToken, guestVideoAllowed, hasHydrated, robot.accessMode, robot.id, roomAccessToken]);

  useEffect(() => {
    void refreshViewerToken(false);
  }, [refreshViewerToken]);

  useEffect(() => {
    const currentlyOnline = robotStatus === 'ONLINE' || robotStatus === 'BUSY';
    if (!currentlyOnline || livekitCreds || livekitRefreshInFlightRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshViewerToken(true);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [livekitCreds, refreshViewerToken, robotStatus]);

  useEffect(() => {
    const previousStatus = previousRobotStatusRef.current;
    previousRobotStatusRef.current = robotStatus;

    const robotCameBackOnline =
      (previousStatus === 'OFFLINE' || previousStatus === 'MAINTENANCE') &&
      (robotStatus === 'ONLINE' || robotStatus === 'BUSY');

    if (!robotCameBackOnline) {
      return;
    }

    void refreshViewerToken(true);
  }, [refreshViewerToken, robotStatus]);

  // ─── Fetch queue ──────────────────────────────────────────────────────────

  useEffect(() => {
    api.setToken(accessToken);
    api.getQueue(robot.id).then((rows) => setQueue(normalizeQueueEntries(rows as QueueEntryWire[]))).catch(() => {});
  }, [accessToken, robot.id, roomAccessToken]);

  useEffect(() => {
    let active = true;
    api.getActiveSession(robot.id)
      .then((session) => {
        if (!active || !session) return;
        setActiveSession({
          sessionId: session.id,
          userId: session.user.id,
          username: session.user.displayName ?? session.user.username,
          startedAt: Date.parse(session.startedAt),
          expiresAt: null,
        });
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [robot.id]);

  useEffect(() => {
    if (!activeSession?.expiresAt) {
      setTurnCountdownMs(null);
      return;
    }

    const tick = () => {
      setTurnCountdownMs(Math.max(0, activeSession.expiresAt! - Date.now()));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.expiresAt]);

  useEffect(() => {
    setRobotStatus(robot.status);
  }, [robot.status]);

  useEffect(() => {
    if (!reconnectNotice) {
      setReconnectCountdownMs(null);
      return;
    }

    const tick = () => {
      setReconnectCountdownMs(Math.max(0, reconnectNotice.retryAt - Date.now()));
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [reconnectNotice]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('botparty.settings.v1');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { keyboardTabSwitchOnlyWhenEmpty?: boolean };
      setTabSwitchOnlyWhenEmpty(parsed.keyboardTabSwitchOnlyWhenEmpty !== false);
    } catch {
      setTabSwitchOnlyWhenEmpty(true);
    }
  }, []);

  // ─── WebSocket ────────────────────────────────────────────────────────────

  useEffect(() => {
    const passwordGateMissing = robot.accessMode === 'PASSWORD' && !roomAccessToken;
    const allowlistGateMissing = robot.accessMode === 'ALLOWED_USERS' && !roomAccessToken && !accessToken;
    const linkGateMissing = robot.accessMode === 'LINK_ONLY' && !roomAccessToken;
    if (passwordGateMissing || allowlistGateMissing || linkGateMissing) {
      setConnected(false);
      wsRef.current?.close();
      return;
    }

    let active = true;
    let reconnectDelayMs = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!active) return;

      const ws = new WebSocket(resolveWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        reconnectDelayMs = 1000;
        reconnectRetryAfterRef.current = null;
        setConnected(true);
        setReconnectNotice(null);
        setReconnectCountdownMs(null);
        ws.send(
          JSON.stringify({
            event: 'room:join',
            data: {
              robotId: robot.id,
              guestSessionId: userId ? undefined : guestSessionId || undefined,
              roomAccessToken: roomAccessToken ?? undefined,
            },
          }),
        );
      };

      ws.onclose = (closeEvent) => {
        if (!active) return;
        setConnected(false);
        if (closeEvent.code === 1012) {
          const now = Date.now();
          if (now - shutdownNoticeAtRef.current > 3000) {
            pushToast('Server restart detected. Reconnecting...', 'error', 2500);
            shutdownNoticeAtRef.current = now;
          }
        }
        const nextDelayMs = Math.max(reconnectDelayMs, reconnectRetryAfterRef.current ?? 0);
        reconnectTimer = setTimeout(connect, nextDelayMs);
        setReconnectNotice((prev) => {
          if (!prev) {
            return prev;
          }

          return {
            ...prev,
            retryAt: Date.now() + nextDelayMs,
          };
        });
        reconnectRetryAfterRef.current = null;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 8000);
      };

      ws.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data as string) as { event: string; data: Record<string, unknown> };
          handleWsEvent(event, data);
        } catch {
          //
        }
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [accessToken, guestSessionId, robot.accessMode, robot.id, roomAccessToken, userId]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const interval = window.setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        return;
      }

      wsRef.current.send(JSON.stringify({
        event: 'room:ping',
        data: { robotId: robot.id },
      }));
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [connected, robot.id]);

  const refreshRecordingStatus = useCallback(async () => {
    if (!isAdmin || !accessToken) {
      return;
    }

    const currentlyOnline = robotStatus === 'ONLINE' || robotStatus === 'BUSY';
    if (!currentlyOnline) {
      setRecordingState((prev) =>
        prev?.active
          ? { ...prev, active: false, activeCount: 0, egressId: null, startedAt: null, sessions: [] }
          : prev,
      );
      return;
    }

    api.setToken(accessToken);
    try {
      const next = await api.getAdminRobotRecordingStatus(robot.id);
      setRecordingState((prev) => {
        if (
          prev &&
          prev.active === next.active &&
          prev.activeCount === next.activeCount &&
          prev.egressId === next.egressId &&
          prev.startedAt === next.startedAt &&
          JSON.stringify(prev.sessions) === JSON.stringify(next.sessions)
        ) {
          return prev;
        }
        return next;
      });
      setRecordingError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recording status unavailable';
      setRecordingError(message);
    }
  }, [accessToken, isAdmin, robot.id, robotStatus]);

  useEffect(() => {
    if (!isAdmin || !accessToken) {
      setRecordingState(null);
      setRecordingError(null);
      return;
    }

    setRecordingLoading(true);
    void refreshRecordingStatus().finally(() => setRecordingLoading(false));

    const interval = window.setInterval(() => {
      void refreshRecordingStatus();
    }, 7000);

    return () => {
      window.clearInterval(interval);
    };
  }, [accessToken, isAdmin, refreshRecordingStatus]);

  const toggleRecording = useCallback(async () => {
    if (!isAdmin || !accessToken || recordingAction) {
      return;
    }

    const shouldStart = !recordingState?.active;
    setRecordingAction(shouldStart ? 'start' : 'stop');
    setRecordingError(null);
    api.setToken(accessToken);

    try {
      const actionPromise = shouldStart
        ? api.startAdminRobotRecording(robot.id)
        : api.stopAdminRobotRecording(robot.id);
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('Recording request timed out. Please try again.')), 15000);
      });
      const next = await Promise.race([actionPromise, timeoutPromise]);
      setRecordingState(next);
      pushToast(shouldStart ? 'Recording started.' : 'Recording stopped.', 'success', 1800);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recording action failed';
      setRecordingError(message);
      pushToast(message, 'error', 2600);
    } finally {
      setRecordingAction(null);
      void refreshRecordingStatus();
    }
  }, [accessToken, isAdmin, recordingAction, recordingState?.active, refreshRecordingStatus, robot.id]);

  const recordingCameraSummary = useMemo(() => {
    const cameraIds = (recordingState?.sessions ?? [])
      .map((session) => session.cameraId)
      .filter((cameraId): cameraId is string => Boolean(cameraId));
    if (cameraIds.length === 0) {
      return recordingState?.active ? 'default camera' : null;
    }

    return cameraIds.join(', ');
  }, [recordingState]);

  const handleWsEvent = useCallback((event: string, data: Record<string, unknown>) => {
    switch (event) {
      case 'presence:update':
        setViewers((data.viewers as Viewer[]) ?? []);
        break;
      case 'presence:join':
        setViewers((v) => {
          if (v.some((x) => x.userId === data.userId)) return v;
          return [...v, { userId: data.userId as string, username: data.username as string, joinedAt: Date.now() }];
        });
        break;
      case 'presence:leave':
        setViewers((v) => v.filter((x) => x.userId !== data.userId));
        break;
      case 'crowd:input':
        setCrowdInputs((prev) => new Map(prev).set(data.command as string, Date.now()));
        break;
      case 'chat:message':
        setMessages((prev) => {
          const nextMessage: ChatMsg = {
            userId: data.userId as string,
            username: data.username as string,
            content: data.content as string,
            timestamp: data.timestamp as number,
            clientMessageId:
              typeof data.clientMessageId === 'string' ? data.clientMessageId : undefined,
          };

          if (nextMessage.clientMessageId) {
            const existingIndex = prev.findIndex((entry) => entry.clientMessageId === nextMessage.clientMessageId);
            if (existingIndex >= 0) {
              const next = [...prev];
              next[existingIndex] = {
                ...next[existingIndex],
                ...nextMessage,
              };
              return next.slice(-200);
            }
          }

          return [...prev.slice(-200), nextMessage];
        });
        break;
      case 'chat:system':
        setMessages((prev) => [
          ...prev.slice(-200),
          {
            userId: 'system',
            username: 'system',
            content: data.message as string,
            timestamp:
              typeof data.timestamp === 'number' && Number.isFinite(data.timestamp)
                ? data.timestamp
                : Date.now(),
            isSystem: true,
          },
        ]);
        break;
      case 'queue:update':
        setQueue(normalizeQueueEntries(data.queue as QueueEntryWire[] | undefined));
        break;
      case 'session:start':
      case 'queue:turn-start': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (!targetUserId) break;
        const usernameValue =
          typeof data.username === 'string' ? data.username : targetUserId.slice(0, 8);
        const expiresAtValue =
          typeof data.expiresAt === 'number'
            ? data.expiresAt
            : typeof data.expiresAt === 'string'
              ? Date.parse(data.expiresAt)
              : null;
        setActiveSession({
          sessionId:
            typeof data.sessionId === 'string' ? data.sessionId : `session-${targetUserId}`,
          userId: targetUserId,
          username: usernameValue,
          startedAt: Date.now(),
          expiresAt: Number.isFinite(expiresAtValue) ? expiresAtValue : null,
        });
        break;
      }
      case 'session:end':
      case 'queue:turn-end':
        setActiveSession((prev) => {
          const targetUserId = typeof data.userId === 'string' ? data.userId : null;
          if (targetUserId && prev && prev.userId !== targetUserId) {
            return prev;
          }
          if (targetUserId && targetUserId === currentViewerId) {
            activeMotionKeysRef.current.clear();
            setActiveKeys(new Set());
            setActiveCommands(new Set());
          }
          return null;
        });
        break;
      case 'mod:timeout':
      case 'mod:ban': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (targetUserId && targetUserId === currentViewerId) {
          const action = event === 'mod:ban' ? 'BAN' : 'TIMEOUT';
          const expiresAt =
            typeof data.expiresAt === 'string' && data.expiresAt.length > 0 ? data.expiresAt : null;
          const until = expiresAt ? ` Until ${new Date(expiresAt).toLocaleTimeString()}.` : '';
          setChatRestriction(
            action === 'BAN'
              ? 'You are banned from this room. Your turn ended immediately and you were removed from the control queue.'
              : `You are temporarily restricted in this room. Your turn ended immediately and you were removed from the control queue.${until}`,
          );
        }
        break;
      }
      case 'mod:kick': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (!targetUserId || targetUserId !== currentViewerId) {
          break;
        }

        setChatRestriction(null);
        pushToast('You were removed from control and from the queue.', 'error', 2600);
        break;
      }
      case 'mod:unban': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (!targetUserId || targetUserId !== currentViewerId) {
          break;
        }

        setChatRestriction(null);
        pushToast('Restriction removed. You can chat again.', 'success', 2200);
        break;
      }
      case 'robot:status': {
        const status = typeof data.status === 'string' ? data.status : robot.status;
        setRobotStatus(status as RobotPublic['status']);
        if (status === 'OFFLINE') {
          setLivekitCreds(null);
          setVideoState('idle');
          setQueue([]);
          setActiveSession(null);
          setInQueue(false);
        } else if (status === 'ONLINE' || status === 'BUSY') {
          void refreshViewerToken(true);
        }
        break;
      }
      case 'server:shutdown': {
        const retryAfterMs =
          typeof data.retryAfterMs === 'number' && Number.isFinite(data.retryAfterMs)
            ? Math.max(1000, data.retryAfterMs)
            : 12000;
        const reason = typeof data.reason === 'string' ? data.reason : 'restart';
        const message =
          typeof data.message === 'string' ? data.message : 'Realtime connection is restarting. Reconnecting soon...';
        reconnectRetryAfterRef.current = retryAfterMs;
        setReconnectNotice({
          message,
          reason,
          retryAt: Date.now() + retryAfterMs,
        });
        const now = Date.now();
        if (now - shutdownNoticeAtRef.current > 3000) {
          pushToast(message, 'error', 2500);
          shutdownNoticeAtRef.current = now;
        }
        break;
      }
      case 'error': {
        const message = typeof data.message === 'string' ? data.message : 'Unknown websocket error';
        if (message === 'Invalid session token') {
          void api.restoreSession().finally(() => {
            api.syncTokenFromStore();
            wsRef.current?.close();
          });
          break;
        }
        if (message.includes('restricted')) {
          const restriction = (data.restriction as { action?: string; expiresAt?: string | null } | undefined) ?? {};
          const action = restriction.action;
          const text =
            action === 'BAN'
              ? 'You are banned from this room.'
              : action === 'KICK'
                ? 'You were removed from control and from the control queue.'
                : action === 'TIMEOUT'
                  ? 'You are temporarily restricted from chat and control in this room.'
                  : 'You are currently restricted.';
          setChatRestriction(text);
        } else {
          // Debounce error toasts - only show if message changed or 5+ seconds since last error
          const now = Date.now();
          const lastError = lastErrorToastRef.current;
          if (!lastError || lastError.message !== message || now - lastError.timestamp > 5000) {
            pushToast(message, 'error');
            lastErrorToastRef.current = { message, timestamp: now };
          }
        }
        break;
      }
    }
  }, [currentViewerId, refreshViewerToken, robot.status]);

  // ─── Controls ─────────────────────────────────────────────────────────────

  const sendCommand = useCallback(
    (
      command: string,
      options?: { cooldownMs?: number; access?: ControlButton['access']; value?: unknown },
    ) => {
      const cooldownMs = options?.cooldownMs ?? 150;
      const buttonAccess = options?.access ?? 'QUEUE_TURN';

      if (robot.queueMode !== 'DISABLED' && buttonAccess === 'QUEUE_TURN') {
        const myPos = queue.findIndex((entry) => entry.userId === currentViewerId) + 1;
        const myTurn = myPos > 0 && myPos === 1;
        if (!myTurn) {
          const now = Date.now();
          const lastError = lastErrorToastRef.current;
          if (!lastError || now - lastError.timestamp > 3000) {
            pushToast(
              myPos > 0
                ? `Queue position #${myPos}. Wait until you are #1.`
                : 'Join the queue to control this robot.',
              'error',
              2200,
            );
            lastErrorToastRef.current = { message: 'control-queue-blocked', timestamp: now };
          }
          return;
        }
      }

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        // Show warning only once per 3 seconds if not connected
        const now = Date.now();
        const lastError = lastErrorToastRef.current;
        if (!lastError || now - lastError.timestamp > 3000) {
          pushToast('Waiting for connection to robot...', 'error', 2000);
          lastErrorToastRef.current = { message: 'disconnected', timestamp: now };
        }
        return;
      }
      const lastAt = cooldownMap.current.get(command) ?? 0;
      if (Date.now() - lastAt < cooldownMs) return;
      cooldownMap.current.set(command, Date.now());
      wsRef.current.send(
        JSON.stringify({
          event: 'control:command',
          data: {
            robotId: robot.id,
            command,
            value: options?.value,
            timestamp: Date.now(),
          },
        }),
      );
    },
    [currentViewerId, queue, robot.id, robot.queueMode],
  );

  const sendImmediateStop = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        event: 'control:command',
        data: { robotId: robot.id, command: 'stop', timestamp: Date.now() },
      }),
    );
  }, [robot.id]);

  useEffect(() => {
    const heldMotionCommands = [...activeCommands].filter((command) =>
      ['forward', 'backward', 'left', 'right'].includes(command),
    );

    if (heldMotionCommands.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      for (const command of heldMotionCommands) {
        sendCommand(command, { cooldownMs: 0, access: 'QUEUE_TURN' });
      }
    }, 400);

    return () => window.clearInterval(interval);
  }, [activeCommands, sendCommand]);

  const releaseLocalControls = useCallback(
    (sendStop = false) => {
      activeMotionKeysRef.current.clear();
      setActiveKeys(new Set());
      setActiveCommands(new Set());
      if (sendStop) {
        sendImmediateStop();
      }
    },
    [sendImmediateStop],
  );

  const triggerEStop = useCallback(() => {
    if (!canUseEStop) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ event: 'control:emergency-stop', data: { robotId: robot.id } }));
  }, [canUseEStop, robot.id]);

  const scrollToPanel = useCallback((target: 'controls' | 'chat') => {
    const element = target === 'controls' ? controlsPanelRef.current : chatPanelRef.current;
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const activateControlsPanel = useCallback(() => {
    setFocusMode('controls');
    scrollToPanel('controls');
  }, [scrollToPanel]);

  const activateChatPanel = useCallback(() => {
    setFocusMode('chat');
    scrollToPanel('chat');
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }, [scrollToPanel]);

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const keyToBtn = new Map<string, ControlButton>(
      controlButtons.filter((b) => b.hotKey).map((b) => [b.hotKey!.toLowerCase(), b]),
    );

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = ['INPUT', 'TEXTAREA'].includes(target.tagName);
      const inContentEditable = target.isContentEditable;
      const inChatInput = target === chatInputRef.current;

      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (e.key === 'Tab') {
        if (inInput) {
          const value =
            (e.target as HTMLInputElement | HTMLTextAreaElement | null)?.value?.trim() ?? '';
          if (tabSwitchOnlyWhenEmpty && value.length > 0) {
            return;
          }
        }
        e.preventDefault();
        setFocusMode((m) => {
          const next = m === 'controls' ? 'chat' : 'controls';
          if (next === 'chat') setTimeout(() => chatInputRef.current?.focus(), 50);
          return next;
        });
        return;
      }

      if (e.key === 'Escape' && canUseEStop) { triggerEStop(); return; }
      // Prevent controls if in ANY input field or in chat focus mode
      if (inInput || inContentEditable || focusMode === 'chat' || inChatInput) return;

      const key = e.key.toLowerCase();
      if (WASD[key] && !e.repeat) {
        e.preventDefault();
        const btn = keyToBtn.get(key) ?? null;
        const command = btn?.command ?? WASD[key];
        setActiveKeys((s) => new Set(s).add(key));
        setActiveCommands((s) => new Set(s).add(command));
        activeMotionKeysRef.current.add(key);
        sendCommand(command, {
          cooldownMs: btn?.cooldownMs,
          access: btn?.access ?? 'QUEUE_TURN',
        });
      }
      else if (keyToBtn.has(key) && !e.repeat) {
        e.preventDefault();
        const btn = keyToBtn.get(key)!;
        setActiveKeys((s) => new Set(s).add(key));
        sendCommand(btn.command, { cooldownMs: btn.cooldownMs, access: btn.access });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = ['INPUT', 'TEXTAREA'].includes(target.tagName);
      const inContentEditable = target.isContentEditable;
      const inChatInput = target === chatInputRef.current;
      if (inInput || inContentEditable || focusMode === 'chat' || inChatInput) return;

      const key = e.key.toLowerCase();
      setActiveKeys((s) => { const n = new Set(s); n.delete(key); return n; });
      if (WASD[key]) {
        const command = WASD[key];
        setActiveCommands((s) => {
          const n = new Set(s);
          n.delete(command);
          return n;
        });
        activeMotionKeysRef.current.delete(key);
        if (activeMotionKeysRef.current.size === 0) {
          sendCommand('stop', { cooldownMs: 0, access: 'QUEUE_TURN' });
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      releaseLocalControls(false);
    };
  }, [focusMode, controlButtons, sendCommand, triggerEStop, canUseEStop, releaseLocalControls, tabSwitchOnlyWhenEmpty]);

  // ─── Chat ─────────────────────────────────────────────────────────────────

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  useLayoutEffect(() => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    if (!initialChatScrollDoneRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollChatToBottom('auto');
          initialChatScrollDoneRef.current = true;
        });
      });
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldStickToBottom = chatShouldStickRef.current || distanceFromBottom < 80;

    if (!shouldStickToBottom) {
      return;
    }

    requestAnimationFrame(() => {
      scrollChatToBottom('auto');
    });
  }, [messages, scrollChatToBottom]);

  // Save chat history to localStorage (debounced - max once per second)
  const saveChatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveChatTimerRef.current) clearTimeout(saveChatTimerRef.current);
    saveChatTimerRef.current = setTimeout(() => {
      try {
        const key = `botparty.chat.${robot.id}`;
        window.localStorage.setItem(key, JSON.stringify(messages));
      } catch {
        // Ignore localStorage errors (quota full, etc)
      }
    }, 1000);
    return () => {
      if (saveChatTimerRef.current) clearTimeout(saveChatTimerRef.current);
    };
  }, [messages, robot.id]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      // Show warning only once per 3 seconds if not connected
      const now = Date.now();
      const lastError = lastErrorToastRef.current;
      if (!lastError || now - lastError.timestamp > 3000) {
        pushToast('Waiting for connection to robot...', 'error', 2000);
        lastErrorToastRef.current = { message: 'disconnected', timestamp: now };
      }
      return;
    }
    const clientMessageId = buildGuestMessageId();
    setMessages((prev) => [
      ...prev.slice(-200),
      {
        userId: currentViewerId,
        username: userId ? (username ?? 'You') : `Guest-${guestSessionId.slice(0, 6)}`,
        content: text,
        timestamp: Date.now(),
        clientMessageId,
      },
    ]);
    wsRef.current.send(JSON.stringify({
      event: 'chat:message',
      data: { robotId: robot.id, content: text, clientMessageId },
    }));
    setChatInput('');
  }, [chatInput, currentViewerId, guestSessionId, robot.id, userId, username]);

  const requestRoomAccess = useCallback(async () => {
    setAccessLoading(true);
    setAccessError(null);
    try {
      api.setToken(accessToken);
      const grant = await api.verifyRobotAccess(robot.id, {
        password: accessPasswordInput.trim() || undefined,
        guestSessionId,
        inviteCode: inviteCodeFromUrl || undefined,
      });
      setRoomAccessToken(grant.token);
      window.sessionStorage.setItem(`botparty.room-access.${robot.id}`, grant.token);
      pushToast('Room access granted.', 'success', 1800);
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : 'Access denied');
    } finally {
      setAccessLoading(false);
    }
  }, [accessPasswordInput, accessToken, guestSessionId, inviteCodeFromUrl, robot.id]);

  const moderateChatUser = useCallback(
    async (targetUserId: string, action: 'TIMEOUT' | 'BAN' | 'UNBAN', preferredName?: string | null) => {
      if (!canModerate || !accessToken) return;
      setModeratingUserId(targetUserId);
      const targetLabel = resolveUserLabel(targetUserId, preferredName);

      try {
        api.setToken(accessToken);
        await api.moderateRobotUser(robot.id, {
          targetUserId,
          action,
          reason: 'Chat moderation',
          durationSec: action === 'TIMEOUT' ? 300 : undefined,
        });
        pushToast(
          action === 'TIMEOUT'
            ? 'Timeout applied.'
            : action === 'BAN'
              ? 'User banned.'
              : 'User unbanned.',
          'success',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Moderation action failed.';
        pushToast(message, 'error');
      } finally {
        setModeratingUserId(null);
      }
    },
    [accessToken, canModerate, resolveUserLabel, robot.id],
  );

  // ─── Queue ─────────────────────────────────────────────────────────────────

  const toggleQueue = useCallback(async () => {
    if (!accessToken) return;
    api.setToken(accessToken);
    try {
      if (inQueue) {
        releaseLocalControls(true);
        await api.leaveQueue(robot.id);
        setInQueue(false);
        pushToast('Left the queue.', 'info');
      } else {
        await api.joinQueue(robot.id, roomAccessToken);
        setInQueue(true);
        pushToast('Joined the queue.', 'success');
      }
      const updated = await api.getQueue(robot.id);
      setQueue(updated);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Queue update failed.', 'error', 2200);
    }
  }, [accessToken, inQueue, releaseLocalControls, robot.id, roomAccessToken]);

  const voteForQueueUser = useCallback(async (targetUserId: string) => {
    if (!accessToken) {
      pushToast('Sign in to vote in queue mode.', 'error', 2200);
      return;
    }

    setVotingForUserId(targetUserId);
    try {
      api.setToken(accessToken);
      await api.voteQueue(robot.id, targetUserId, roomAccessToken);
      const updated = await api.getQueue(robot.id);
      setQueue(updated);
      pushToast('Vote submitted.', 'success', 1400);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Vote failed.', 'error', 2200);
    } finally {
      setVotingForUserId(null);
    }
  }, [accessToken, robot.id, roomAccessToken]);

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isCrowdActive = (command: string) => Date.now() - (crowdInputs.get(command) ?? 0) < 600;

  const buttons = controlButtons;

  const isOnline = robotStatus === 'ONLINE' || robotStatus === 'BUSY';
  const queueEnabled = robot.queueMode !== 'DISABLED';
  const myQueuePosition = queue.findIndex((entry) => entry.userId === currentViewerId) + 1;
  const isMyTurn = !queueEnabled || (myQueuePosition > 0 && myQueuePosition === 1);
  const reconnectSeconds = reconnectCountdownMs !== null ? Math.max(1, Math.ceil(reconnectCountdownMs / 1000)) : null;
  const viewerLabel = connected
    ? `${viewers.length} viewer${viewers.length !== 1 ? 's' : ''}`
    : reconnectSeconds !== null
      ? `Reconnecting in ${reconnectSeconds}s`
      : 'Disconnected';
  const queueSummary = queueEnabled
    ? inQueue
      ? isMyTurn
        ? 'Your turn is live'
        : `Queue #${Math.max(myQueuePosition, 1)}`
      : 'Join queue'
    : 'Open controls';
  const canUseButton = useCallback((button: ControlButton) => {
    if (button.access === 'EVERYONE') return true;
    if (button.access === 'QUEUE_TURN') return isMyTurn;
    if (button.access === 'MODERATOR') return canModerate;
    return Boolean(userId && userId === robot.owner.id);
  }, [canModerate, isMyTurn, robot.owner.id, userId]);
  const extraControls = useMemo(
    () =>
      buttons
        .filter((button) => !['w', 'a', 's', 'd'].includes((button.hotKey ?? '').toLowerCase())),
    [buttons],
  );
  const extraButtonControls = useMemo(
    () => extraControls.filter((button) => parseWidgetConfig(button.icon ?? null) === null),
    [extraControls],
  );
  const sliderControls = useMemo(
    () =>
      extraControls
        .map((button) => ({ button, widget: parseWidgetConfig(button.icon ?? null) }))
        .filter((entry): entry is { button: ControlButton; widget: SliderWidgetConfig } => entry.widget?.kind === 'slider'),
    [extraControls],
  );
  const xyControls = useMemo(
    () =>
      extraControls
        .map((button) => ({ button, widget: parseWidgetConfig(button.icon ?? null) }))
        .filter((entry): entry is { button: ControlButton; widget: XYWidgetConfig } => entry.widget?.kind === 'xy'),
    [extraControls],
  );

  useEffect(() => {
    if (!userId) {
      setInQueue(false);
      return;
    }
    setInQueue(queue.some((entry) => entry.userId === currentViewerId));
  }, [currentViewerId, queue]);

  useEffect(() => {
    if (!isMyTurn && activeMotionKeysRef.current.size > 0) {
      releaseLocalControls(true);
    }
  }, [isMyTurn, releaseLocalControls]);

  useEffect(() => {
    const wasMyTurn = wasMyTurnRef.current;
    if (wasMyTurn && !isMyTurn) {
      setWidgetQueueResetEpoch((value) => value + 1);
    }
    wasMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    if (wasOnline && !isOnline) {
      setWidgetOfflineResetEpoch((value) => value + 1);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  // ─── UI ───────────────────────────────────────────────────────────────────

  return (
    <div className="safe-pb mx-auto max-w-7xl px-4 py-4 pb-24 sm:py-6 lg:pb-6">
      {/* Breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Link href="/explore" className="hover:text-[var(--foreground)] transition-colors">Explore</Link>
        <span>/</span>
        <span className="max-w-full truncate text-[var(--foreground)]">{robot.name}</span>
        <div className="ml-0 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 sm:ml-auto">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-[var(--online)]' : 'bg-zinc-600'}`} />
          <span className="text-xs">
            {viewerLabel}
          </span>
        </div>
      </div>

      {reconnectNotice && !connected && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">
            {reconnectNotice.reason === 'maintenance'
              ? 'Maintenance window'
              : reconnectNotice.reason === 'update' || reconnectNotice.reason === 'deploy'
                ? 'Update in progress'
                : 'Realtime restart'}
          </p>
          <p className="mt-1 text-amber-100/85">
            {reconnectNotice.message}
            {reconnectSeconds !== null ? ` Trying again in about ${reconnectSeconds}s.` : ''}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:hidden">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Status</p>
          <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
            {robotStatus.charAt(0) + robotStatus.slice(1).toLowerCase()}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Queue</p>
          <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">{queueSummary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ─── Left column: video + controls ─── */}
        <div className="space-y-4 lg:col-span-2">
          {/* Video */}
          <div className="relative aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-black lg:shadow-none">
            {(robot.accessMode === 'PASSWORD' || robot.accessMode === 'ALLOWED_USERS' || robot.accessMode === 'LINK_ONLY') &&
            !roomAccessToken &&
            (robot.accessMode === 'LINK_ONLY' || !guestVideoAllowed) ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-[var(--muted-foreground)]">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                  <Video className="h-7 w-7 text-sky-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {robot.accessMode === 'PASSWORD'
                      ? 'This room is password protected.'
                      : robot.accessMode === 'ALLOWED_USERS'
                        ? 'This room is allow-list only.'
                        : 'This room is invite-only.'}
                  </p>
                  <p className="mt-1 text-sm">
                    {robot.accessMode === 'PASSWORD'
                      ? 'Enter the room password to unlock video, chat, and controls.'
                      : robot.accessMode === 'ALLOWED_USERS'
                        ? accessToken
                          ? 'Verifying your room access...'
                          : 'Sign in with an allowed account to enter this room.'
                        : inviteCodeFromUrl
                          ? 'Verifying your invite link...'
                          : 'Open the full invite link to enter this room.'}
                  </p>
                </div>
                {robot.accessMode === 'PASSWORD' && (
                  <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={accessPasswordInput}
                      onChange={(event) => setAccessPasswordInput(event.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm text-[var(--foreground)]"
                      placeholder="Room password"
                    />
                    <button
                      type="button"
                      onClick={() => void requestRoomAccess()}
                      disabled={accessLoading}
                      className="rounded-lg bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {accessLoading ? 'Checking...' : 'Unlock'}
                    </button>
                  </div>
                )}
                {robot.accessMode === 'ALLOWED_USERS' && !accessToken && (
                  <Link
                    href="/login"
                    className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-hover)]"
                  >
                    Sign in
                  </Link>
                )}
                {accessError && <p className="text-xs text-red-300">{accessError}</p>}
              </div>
            ) : isOnline && livekitCreds ? (
              <LiveKitPlayer
                key={`${robot.id}-${livekitVersion}`}
                token={livekitCreds.token}
                livekitUrl={livekitCreds.url}
                streamConfig={robot.metadata?.stream}
                volumeStorageKey={`botparty:robot:${robot.id}:stream-volume`}
                onStreamStalled={() => {
                  void refreshViewerToken(true);
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
                {isOnline ? (
                  <>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                      <Radio className="h-7 w-7 text-violet-300" />
                    </div>
                    {videoState === 'loading' || videoState === 'idle' ? (
                      <p className="text-sm">Connecting to video stream...</p>
                    ) : (
                      <>
                        <p className="text-sm font-medium">Live video is unavailable right now.</p>
                        <Link
                          href="/login"
                          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-hover)]"
                        >
                          Sign in
                        </Link>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                      <Bot className="h-7 w-7 text-[var(--muted-foreground)]" />
                    </div>
                    <p className="text-sm">Robot is offline</p>
                  </>
                )}
              </div>
            )}

            {/* Live badge */}
            {isOnline && livekitCreds && (
              <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-[var(--live)]/90 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" />
                LIVE
              </div>
            )}
          </div>

          {(robot.accessMode === 'PASSWORD' || robot.accessMode === 'ALLOWED_USERS') && !roomAccessToken && guestVideoAllowed ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
              Video is public for guests. Room access is still required for chat, queue, and controls.
            </div>
          ) : null}

          {/* Focus toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={activateControlsPanel}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                focusMode === 'controls'
                  ? 'bg-[var(--primary)] text-white'
                  : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <Gamepad2 className="h-3.5 w-3.5" />
                Controls
              </span>
            </button>
            <button
              onClick={activateChatPanel}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                focusMode === 'chat'
                  ? 'bg-[var(--primary)] text-white'
                  : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50'
              }`}
            >
              Chat
            </button>
            <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">Tab to switch &middot; ESC = E-STOP</span>
          </div>

          {/* Controls panel */}
          <div
            ref={controlsPanelRef}
            className={`rounded-xl border p-4 sm:p-5 transition-colors ${
              focusMode === 'controls'
                ? 'border-[var(--primary)]/50 bg-[var(--card)]'
                : 'border-[var(--border)] bg-[var(--card)] opacity-70'
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Controls
              </span>
              {focusMode !== 'controls' && (
                <span className="text-xs text-[var(--muted-foreground)]">Tab to focus</span>
              )}
            </div>

            <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start">
              {/* D-pad layout */}
              <div className="mx-auto grid grid-cols-3 grid-rows-3 gap-2 sm:mx-0">
                {/* Row 1: top-center = W */}
                <div />
                {(['w'] as const).map((k) => {
                  const btn = buttons.find((b) => b.hotKey === k);
                  if (!btn) {
                    return <div key={`${k}-placeholder`} />;
                  }

                  const cmd = btn.command;
                  const isDown = activeCommands.has(cmd);
                  return (
                    <ControlKey
                      key={k}
                      label={btn.icon ?? k.toUpperCase()}
                      hotKey={k}
                      command={cmd}
                      isDown={isDown}
                      isCrowd={isCrowdActive(cmd)}
                      disabled={!canUseButton(btn)}
                      onPress={() => {
                        setActiveCommands((s) => new Set(s).add(cmd));
                        sendCommand(cmd, { cooldownMs: btn.cooldownMs, access: btn.access });
                      }}
                      onRelease={() => {
                        setActiveCommands((s) => {
                          const next = new Set(s);
                          next.delete(cmd);
                          return next;
                        });
                        sendImmediateStop();
                      }}
                    />
                  );
                })}
                <div />
                {/* Row 2: A S D */}
                {(['a', 's', 'd'] as const).map((k) => {
                  const btn = buttons.find((b) => b.hotKey === k);
                  if (!btn) {
                    return <div key={`${k}-placeholder`} />;
                  }

                  const cmd = btn.command;
                  const isDown = activeCommands.has(cmd);
                  return (
                    <ControlKey
                      key={k}
                      label={btn.icon ?? k.toUpperCase()}
                      hotKey={k}
                      command={cmd}
                      isDown={isDown}
                      isCrowd={isCrowdActive(cmd)}
                      disabled={!canUseButton(btn)}
                      onPress={() => {
                        setActiveCommands((s) => new Set(s).add(cmd));
                        sendCommand(cmd, { cooldownMs: btn.cooldownMs, access: btn.access });
                      }}
                      onRelease={() => {
                        setActiveCommands((s) => {
                          const next = new Set(s);
                          next.delete(cmd);
                          return next;
                        });
                        sendImmediateStop();
                      }}
                    />
                  );
                })}
                {/* Row 3: empty */}
                <div /><div /><div />
              </div>

              {/* Extra controls */}
              <div className="flex flex-wrap items-start gap-3">
                {buttons.length === 0 && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    No controls are available for your current access level.
                  </div>
                )}

                {extraButtonControls.map((btn) => (
                  <button
                    key={btn.id}
                    onPointerDown={() => sendCommand(btn.command, { cooldownMs: btn.cooldownMs, access: btn.access })}
                    disabled={!canUseButton(btn)}
                    style={btn.color ? { borderColor: btn.color, color: btn.color } : undefined}
                    className={`flex min-h-12 min-w-[3.25rem] items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold transition select-none lg:min-h-11 lg:min-w-[2.75rem] ${
                      isCrowdActive(btn.command)
                        ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                        : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:border-[var(--primary)] hover:text-white'
                    }`}
                  >
                    {btn.icon && !btn.icon.startsWith('widget:') && <span>{btn.icon}</span>}
                    {btn.label}
                    {btn.hotKey && <span className="ml-1 text-xs opacity-40">[{btn.hotKey}]</span>}
                  </button>
                ))}

                {sliderControls.map(({ button, widget }) => (
                  <SliderControl
                    key={button.id}
                    label={button.label}
                    command={button.command}
                    config={widget}
                    color={button.color ?? null}
                    cooldownMs={button.cooldownMs}
                    access={button.access}
                    isCrowd={isCrowdActive(button.command)}
                    disabled={!canUseButton(button)}
                    queueResetEpoch={widgetQueueResetEpoch}
                    offlineResetEpoch={widgetOfflineResetEpoch}
                    onSendValue={(value) => sendCommand(button.command, {
                      cooldownMs: button.cooldownMs,
                      access: button.access,
                      value,
                    })}
                  />
                ))}

                {xyControls.map(({ button, widget }) => (
                  <XYPadControl
                    key={button.id}
                    label={button.label}
                    command={button.command}
                    config={widget}
                    color={button.color ?? null}
                    cooldownMs={button.cooldownMs}
                    access={button.access}
                    isCrowd={isCrowdActive(button.command)}
                    disabled={!canUseButton(button)}
                    queueResetEpoch={widgetQueueResetEpoch}
                    offlineResetEpoch={widgetOfflineResetEpoch}
                    onSendValue={(value) => sendCommand(button.command, {
                      cooldownMs: button.cooldownMs,
                      access: button.access,
                      value,
                    })}
                  />
                ))}
              </div>

              <div className="hidden h-11 w-px self-center bg-[var(--border)] sm:block" />

              {/* E-STOP */}
              {canUseEStop && (
                <button
                  onPointerDown={triggerEStop}
                  className="flex h-14 w-full max-w-[12rem] flex-col items-center justify-center rounded-xl bg-[var(--destructive)] text-xs font-black text-white shadow-lg shadow-red-500/20 transition hover:brightness-110 active:scale-95 select-none sm:w-28 lg:max-w-[10rem] lg:rounded-xl lg:shadow-lg"
                >
                    <AlertTriangle className="h-4 w-4" />
                  E-STOP
                </button>
              )}
            </div>

            <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
              WASD or arrow keys &middot; <span className="text-amber-400">amber</span> = another player just pressed
              {canUseEStop ? ' · ESC = emergency stop' : ''}
            </p>
            {queueEnabled && !isMyTurn && (
              <p className="mt-2 text-center text-xs text-amber-300">
                {myQueuePosition > 0
                  ? `Queue position #${myQueuePosition}. Controls unlock when you reach #1.`
                  : 'Join the queue to control this robot.'}
              </p>
            )}
          </div>
        </div>

        {/* ─── Right column: info, queue, chat ─── */}
        <div className="space-y-4">
          {/* Robot info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-lg font-bold leading-tight">{robot.name}</h1>
                <p className="text-sm text-[var(--muted-foreground)]">
                  by{' '}
                  <span className="text-[var(--foreground)]/80">
                    {robot.owner.displayName ?? robot.owner.username}
                  </span>
                </p>
              </div>
              <span
                className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  robotStatus === 'ONLINE'
                    ? 'bg-[var(--online)]/15 text-[var(--online)]'
                    : robotStatus === 'BUSY'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-zinc-700/50 text-zinc-400'
                }`}
              >
                {robotStatus.charAt(0) + robotStatus.slice(1).toLowerCase()}
              </span>
            </div>

            {robot.description && (
              <p className="mt-3 text-sm text-[var(--muted-foreground)] leading-relaxed">
                {robot.description}
              </p>
            )}

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-lg bg-[var(--background)] px-2 py-1.5 text-[var(--muted-foreground)]">
                <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
                  <Video className="h-3.5 w-3.5 text-violet-300" />
                  Live stream
                </span>
              </div>
              <div className="rounded-lg bg-[var(--background)] px-2 py-1.5 text-[var(--muted-foreground)]">
                <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
                  <Gamepad2 className="h-3.5 w-3.5 text-violet-300" />
                  Queue control
                </span>
              </div>
            </div>

            {activeSession && (
              <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  Current controller
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{activeSession.username}</p>
                  {turnCountdownMs !== null && (
                    <p className="text-xs text-amber-300">
                      {formatCountdown(turnCountdownMs)} left
                    </p>
                  )}
                </div>
              </div>
            )}

            {robot.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {robot.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/explore?tag=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--secondary-foreground)]/80 transition hover:bg-[var(--primary)]/20"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Viewers */}
          {viewers.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Watching ({viewers.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {viewers.slice(0, 15).map((v) => (
                  <span
                    key={v.userId}
                    className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]"
                    title={v.username}
                  >
                    {v.username.slice(0, 14)}
                  </span>
                ))}
                {viewers.length > 15 && (
                  <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                    +{viewers.length - 15}
                  </span>
                )}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Recording (Admin)
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    recordingState?.active
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                  }`}
                >
                  {recordingState?.active ? 'Recording' : recordingLoading ? 'Checking' : 'Idle'}
                </span>
              </div>

              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                {recordingState?.startedAt
                  ? `Started at ${new Date(recordingState.startedAt).toLocaleString()}${recordingState.activeCount > 1 ? ` · ${recordingState.activeCount} cameras` : ''}`
                  : 'Capture this robot room directly from LiveKit.'}
              </p>

              {recordingState?.active && recordingCameraSummary && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Active cameras: {recordingCameraSummary}
                </p>
              )}

              <button
                type="button"
                disabled={recordingLoading || Boolean(recordingAction)}
                onClick={() => void toggleRecording()}
                className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
                  recordingState?.active
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)]'
                }`}
              >
                {recordingAction === 'start'
                  ? 'Starting recording...'
                  : recordingAction === 'stop'
                    ? 'Stopping recording...'
                    : recordingState?.active
                      ? 'Stop recording'
                      : 'Start recording'}
              </button>

              {recordingError && (
                <p className="mt-2 text-xs text-red-300">{recordingError}</p>
              )}
            </div>
          )}

          {/* Queue */}
          {queueEnabled && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Control queue
            </p>

            {accessToken ? (
              <button
                onClick={toggleQueue}
                className={`w-full rounded-lg py-2 text-sm font-semibold transition ${
                  inQueue
                    ? 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-red-500 hover:text-red-400'
                    : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'
                }`}
              >
                {inQueue ? 'Leave queue' : 'Join queue'}
              </button>
            ) : (
              <Link
                href="/login"
                className="block w-full rounded-lg border border-[var(--border)] py-2 text-center text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
              >
                Sign in to join queue
              </Link>
            )}

            {queue.length > 0 && (
              <div className="mt-3 space-y-2">
                {queue.slice(0, 5).map((entry, i) => (
                  <div key={entry.userId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${i === 0 ? 'font-medium' : 'text-[var(--muted-foreground)]'}`}>
                      {entry.username}
                    </span>
                    {robot.queueMode === 'VOTING' && (
                      <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {entry.votes ?? 0} votes
                      </span>
                    )}
                    {i === 0 && (
                      <span className="ml-auto text-xs text-[var(--online)]">Controlling</span>
                    )}
                    {userId && entry.userId === userId && i > 0 && (
                      <span className="ml-auto text-xs text-amber-300">You</span>
                    )}
                    {robot.queueMode === 'VOTING' && accessToken && userId && entry.userId !== userId && i > 0 && (
                      <button
                        type="button"
                        disabled={votingForUserId === entry.userId}
                        onClick={() => void voteForQueueUser(entry.userId)}
                        className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-60"
                      >
                        {votingForUserId === entry.userId ? 'Voting...' : 'Vote'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Chat */}
          <div
            ref={chatPanelRef}
            className={`rounded-xl border p-4 transition-colors ${
              focusMode === 'chat' ? 'border-[var(--primary)]/50 bg-[var(--card)]' : 'border-[var(--border)] bg-[var(--card)]'
            }`}
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Chat
            </p>

            <div
              ref={chatScrollRef}
              onScroll={(event) => {
                const container = event.currentTarget;
                const distanceFromBottom =
                  container.scrollHeight - container.scrollTop - container.clientHeight;
                chatShouldStickRef.current = distanceFromBottom < 80;
              }}
                className="mb-2 h-64 overflow-y-auto rounded-lg bg-[var(--background)] px-2 py-1.5 text-sm sm:h-52 lg:h-44"
            >
              <div className="flex min-h-full flex-col justify-end gap-1.5">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`animate-fade-in rounded-md border px-2.5 py-1.5 ${
                      msg.isSystem
                        ? 'border-[var(--border)] bg-[var(--muted)]/30'
                        : msg.userId === currentViewerId
                          ? 'border-violet-500/25 bg-violet-500/7'
                          : 'border-[var(--border)] bg-[var(--card)]/70'
                    }`}
                  >
                  {msg.isSystem ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                          System
                        </span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs italic text-[var(--muted-foreground)]">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-violet-400">{msg.username}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-xs text-[var(--foreground)]/90">{msg.content}</p>
                      {canModerate &&
                        msg.userId !== 'system' &&
                        msg.userId !== currentViewerId && (
                          <div className="inline-flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void moderateChatUser(msg.userId, 'TIMEOUT', msg.username)}
                              disabled={moderatingUserId === msg.userId}
                              className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 transition-all hover:border-amber-500/80 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Timeout
                            </button>
                            <button
                              type="button"
                              onClick={() => void moderateChatUser(msg.userId, 'BAN', msg.username)}
                              disabled={moderatingUserId === msg.userId}
                              className="rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-300 transition-all hover:border-red-500/80 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Ban
                            </button>
                            <button
                              type="button"
                              onClick={() => void moderateChatUser(msg.userId, 'UNBAN', msg.username)}
                              disabled={moderatingUserId === msg.userId}
                              className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-300 transition-all hover:border-emerald-500/80 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Unban
                            </button>
                          </div>
                        )}
                    </div>
                  )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
                  if (e.key === 'Tab') {
                    if (!tabSwitchOnlyWhenEmpty || chatInput.trim().length === 0) {
                      e.preventDefault();
                      setFocusMode('controls');
                    }
                  }
                }}
                placeholder={focusMode === 'chat' ? 'Say something...' : 'Tab to chat...'}
                maxLength={300}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--primary)]"
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim()}
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--primary-hover)] active:scale-95 disabled:opacity-50"
              >
                Send
              </button>
            </div>
            <p className="mt-1 text-right text-[10px] text-[var(--muted-foreground)]">
              {chatInput.length}/300
            </p>
            {chatRestriction && (
              <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                {chatRestriction}
              </p>
            )}
          </div>
        </div>

      </div>

      <div className="safe-bottom fixed inset-x-4 z-40 mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)]/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-md lg:hidden landscape:max-w-2xl landscape:px-3 landscape:py-1.5">
        <button
          type="button"
          onClick={activateControlsPanel}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            focusMode === 'controls' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--card)] text-[var(--foreground)]'
          }`}
        >
          Controls
        </button>
        <button
          type="button"
          onClick={activateChatPanel}
          className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
            focusMode === 'chat' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--card)] text-[var(--foreground)]'
          }`}
        >
          Chat
        </button>
        {queueEnabled && (
          accessToken ? (
            <button
              type="button"
              onClick={() => void toggleQueue()}
              className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                inQueue ? 'bg-[var(--card)] text-amber-300' : 'bg-[var(--card)] text-[var(--foreground)]'
              }`}
            >
              {inQueue ? `#${myQueuePosition || 1}` : 'Queue'}
            </button>
          ) : (
            <Link
              href="/login"
              className="flex-1 rounded-xl bg-[var(--card)] px-3 py-2 text-center text-xs font-semibold text-[var(--foreground)]"
            >
              Sign in
            </Link>
          )
        )}
        {canUseEStop && (
          <button
            type="button"
            onPointerDown={triggerEStop}
            className="rounded-xl bg-[var(--destructive)] px-3 py-2 text-xs font-black text-white"
          >
            STOP
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Advanced controls ───────────────────────────────────────────────────────

function SliderControl({
  label,
  command,
  config,
  color,
  cooldownMs,
  access,
  isCrowd,
  disabled,
  queueResetEpoch,
  offlineResetEpoch,
  onSendValue,
}: {
  label: string;
  command: string;
  config: SliderWidgetConfig;
  color: string | null;
  cooldownMs: number;
  access: ControlButton['access'];
  isCrowd: boolean;
  disabled: boolean;
  queueResetEpoch: number;
  offlineResetEpoch: number;
  onSendValue: (value: number) => void;
}) {
  const [value, setValue] = useState<number>(config.start);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(config.start);
  }, [config.start, config.min, config.max, command]);

  useEffect(() => {
    if (!config.resetOnQueueLoss || queueResetEpoch === 0) {
      return;
    }
    setValue(config.start);
    onSendValue(config.start);
  }, [config.resetOnQueueLoss, config.start, onSendValue, queueResetEpoch]);

  useEffect(() => {
    if (!config.resetOnOffline || offlineResetEpoch === 0) {
      return;
    }
    setValue(config.start);
    onSendValue(config.start);
  }, [config.resetOnOffline, config.start, onSendValue, offlineResetEpoch]);

  useEffect(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    if (config.resetAfterMs === null || value === config.start) {
      return;
    }

    resetTimerRef.current = setTimeout(() => {
      setValue(config.start);
      onSendValue(config.start);
      resetTimerRef.current = null;
    }, config.resetAfterMs);

    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [config.resetAfterMs, config.start, onSendValue, value]);

  const emit = useCallback(
    (nextValue: number) => {
      onSendValue(nextValue);
    },
    [onSendValue],
  );

  return (
    <div
      className={`min-w-[14rem] rounded-lg border px-3 py-2 ${
        isCrowd ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--border)] bg-[var(--muted)]'
      }`}
      style={color ? { borderColor: color } : undefined}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{label}</p>
        <span className="text-[10px] text-[var(--muted-foreground)]">{value.toFixed(0)}</span>
      </div>
      <input
        type="range"
        min={config.min}
        max={config.max}
        step={config.step}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          setValue(next);
          emit(next);
        }}
        onPointerUp={() => {
          if (config.returnMode !== 'center') {
            return;
          }
          setValue(config.start);
          emit(config.start);
        }}
        className={`accent-[var(--primary)] ${config.direction === 'vertical' ? 'h-28 w-6 [writing-mode:vertical-lr] [-webkit-appearance:slider-vertical]' : 'w-full'}`}
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
        <span>{config.min}</span>
        <span className="opacity-80">
          {command} · {access} · {cooldownMs}ms{config.resetAfterMs ? ` · reset ${config.resetAfterMs}ms` : ''}
        </span>
        <span>{config.max}</span>
      </div>
    </div>
  );
}

function XYPadControl({
  label,
  command,
  config,
  color,
  cooldownMs,
  access,
  isCrowd,
  disabled,
  queueResetEpoch,
  offlineResetEpoch,
  onSendValue,
}: {
  label: string;
  command: string;
  config: XYWidgetConfig;
  color: string | null;
  cooldownMs: number;
  access: ControlButton['access'];
  isCrowd: boolean;
  disabled: boolean;
  queueResetEpoch: number;
  offlineResetEpoch: number;
  onSendValue: (value: { x: number; y: number }) => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number }>({ x: config.xStart, y: config.yStart });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPoint({ x: config.xStart, y: config.yStart });
  }, [config.xStart, config.yStart, config.xMin, config.xMax, config.yMin, config.yMax, command]);

  useEffect(() => {
    if (!config.resetOnQueueLoss || queueResetEpoch === 0) {
      return;
    }
    const nextPoint = { x: config.xStart, y: config.yStart };
    setPoint(nextPoint);
    onSendValue(nextPoint);
  }, [config.resetOnQueueLoss, config.xStart, config.yStart, onSendValue, queueResetEpoch]);

  useEffect(() => {
    if (!config.resetOnOffline || offlineResetEpoch === 0) {
      return;
    }
    const nextPoint = { x: config.xStart, y: config.yStart };
    setPoint(nextPoint);
    onSendValue(nextPoint);
  }, [config.resetOnOffline, config.xStart, config.yStart, onSendValue, offlineResetEpoch]);

  useEffect(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    const isAtStart = point.x === config.xStart && point.y === config.yStart;
    if (config.resetAfterMs === null || isAtStart) {
      return;
    }

    resetTimerRef.current = setTimeout(() => {
      const nextPoint = { x: config.xStart, y: config.yStart };
      setPoint(nextPoint);
      onSendValue(nextPoint);
      resetTimerRef.current = null;
    }, config.resetAfterMs);

    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [config.resetAfterMs, config.xStart, config.yStart, onSendValue, point.x, point.y]);

  const toPercent = (value: number, min: number, max: number) => ((value - min) / (max - min)) * 100;

  const sendPoint = useCallback(
    (nextPoint: { x: number; y: number }) => {
      onSendValue(nextPoint);
    },
    [onSendValue],
  );

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = padRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
      const ny = clamp((clientY - rect.top) / rect.height, 0, 1);

      const x = config.xMin + nx * (config.xMax - config.xMin);
      const y = config.yMax - ny * (config.yMax - config.yMin);
      const nextPoint = {
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
      };

      setPoint(nextPoint);
      sendPoint(nextPoint);
    },
    [config.xMax, config.xMin, config.yMax, config.yMin, sendPoint],
  );

  const resetToStart = useCallback(() => {
    if (config.returnMode !== 'center') {
      return;
    }
    const nextPoint = { x: config.xStart, y: config.yStart };
    setPoint(nextPoint);
    sendPoint(nextPoint);
  }, [config.returnMode, config.xStart, config.yStart, sendPoint]);

  const cx = toPercent(point.x, config.xMin, config.xMax);
  const cy = 100 - toPercent(point.y, config.yMin, config.yMax);

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        isCrowd ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--border)] bg-[var(--muted)]'
      }`}
      style={color ? { borderColor: color } : undefined}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{label}</p>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          x {point.x.toFixed(0)} · y {point.y.toFixed(0)}
        </span>
      </div>
      <div
        ref={padRef}
        className="relative h-32 w-32 touch-none rounded border border-[var(--border)] bg-[var(--background)]"
        onPointerDown={(event) => {
          if (disabled) {
            return;
          }
          (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (disabled) {
            return;
          }
          if ((event.buttons & 1) === 0) {
            return;
          }
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={resetToStart}
        onPointerCancel={resetToStart}
      >
        <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-[var(--border)]" />
        <div className="absolute left-1/2 top-1/2 h-full w-px -translate-y-1/2 bg-[var(--border)]" />
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]"
          style={{ left: `${cx}%`, top: `${cy}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
        {command} · {access} · {cooldownMs}ms{config.resetAfterMs ? ` · reset ${config.resetAfterMs}ms` : ''}
      </div>
    </div>
  );
}

// ─── ControlKey helper ────────────────────────────────────────────────────────

function ControlKey({
  label,
  hotKey,
  command,
  isDown,
  isCrowd,
  disabled,
  onPress,
  onRelease,
}: {
  label: string;
  hotKey: string;
  command: string;
  isDown: boolean;
  isCrowd: boolean;
  disabled?: boolean;
  onPress: () => void;
  onRelease?: () => void;
}) {
  const isMotionKey = ['forward', 'backward', 'left', 'right'].includes(command);

  return (
    <button
      onPointerDown={disabled ? undefined : onPress}
      onPointerUp={disabled || !isMotionKey ? undefined : onRelease}
      onPointerCancel={disabled || !isMotionKey ? undefined : onRelease}
      onPointerLeave={disabled || !isMotionKey ? undefined : onRelease}
      title={hotKey.toUpperCase()}
      disabled={disabled}
      className={`flex h-16 w-16 touch-none items-center justify-center rounded-2xl border text-base font-bold transition select-none sm:h-14 sm:w-14 sm:rounded-xl sm:text-sm lg:h-11 lg:w-11 lg:rounded-lg lg:text-sm ${
        disabled
          ? 'cursor-not-allowed border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] opacity-50'
          : isDown
          ? 'border-[var(--primary)] bg-[var(--primary)] text-white scale-95'
          : isCrowd
          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
          : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:border-[var(--primary)] hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function formatCountdown(valueMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
