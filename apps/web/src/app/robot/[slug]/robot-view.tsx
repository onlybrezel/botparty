'use client';

import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import Link from 'next/link';
import type { RobotPublic } from '@botparty/shared';
import { AlertTriangle, Bot, Radio, Video, Gamepad2 } from 'lucide-react';
import { api } from '@/lib/api';
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

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  robot: RobotPublic;
}

export default function RobotView({ robot }: Props) {
  const { accessToken, userId, role } = useAuth();

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
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null);
  const [accessPasswordInput, setAccessPasswordInput] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [turnCountdownMs, setTurnCountdownMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const cooldownMap = useRef<Map<string, number>>(new Map());
  const lastErrorToastRef = useRef<{ message: string; timestamp: number } | null>(null);
  const activeMotionKeysRef = useRef<Set<string>>(new Set());
  const livekitRefreshInFlightRef = useRef(false);
  const allowListAccessAttemptedRef = useRef(false);
  const previousRobotStatusRef = useRef(robot.status);
  const initialChatScrollDoneRef = useRef(false);
  const chatShouldStickRef = useRef(true);

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
  const resolveUserLabel = useCallback(
    (targetUserId: string, preferredName?: string | null) => {
      if (preferredName?.trim()) {
        return preferredName.trim();
      }

      if (targetUserId === userId) {
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
    [activeSession, messages, queue, userId, viewers],
  );

  useEffect(() => {
    api.getControls(robot.id).then(setControlButtons).catch(() => {});
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
    if (robot.accessMode === 'OPEN' || robot.accessMode === 'LINK_ONLY') {
      setRoomAccessToken(null);
      setAccessError(null);
      allowListAccessAttemptedRef.current = false;
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(`botparty.room-access.${robot.id}`);
      setRoomAccessToken(stored);
      allowListAccessAttemptedRef.current = Boolean(stored);
    } catch {
      setRoomAccessToken(null);
      allowListAccessAttemptedRef.current = false;
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

  // ─── Fetch LiveKit token (auth required) ──────────────────────────────────

  const refreshViewerToken = useCallback(async (forceRemount = false) => {
    if (
      (robot.accessMode === 'PASSWORD' || robot.accessMode === 'ALLOWED_USERS') &&
      !roomAccessToken &&
      !guestVideoAllowed
    ) {
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
  }, [accessToken, guestVideoAllowed, robot.accessMode, robot.id, roomAccessToken]);

  useEffect(() => {
    void refreshViewerToken(false);
  }, [refreshViewerToken]);

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
    api.getQueue(robot.id).then((rows) => setQueue(normalizeQueueEntries(rows as QueueEntryWire[]))).catch(() => {});
  }, [robot.id]);

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
    if ((robot.accessMode === 'PASSWORD' || robot.accessMode === 'ALLOWED_USERS') && !roomAccessToken) {
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
        setConnected(true);
        ws.send(
          JSON.stringify({
            event: 'room:join',
            data: {
              robotId: robot.id,
              accessToken: accessToken ?? undefined,
              guestSessionId: userId ? undefined : guestSessionId || undefined,
              roomAccessToken: roomAccessToken ?? undefined,
            },
          }),
        );
      };

      ws.onclose = () => {
        if (!active) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, reconnectDelayMs);
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
        setMessages((prev) => [
          ...prev.slice(-200),
          { userId: data.userId as string, username: data.username as string, content: data.content as string, timestamp: data.timestamp as number },
        ]);
        break;
      case 'chat:system':
        setMessages((prev) => [
          ...prev.slice(-200),
          { userId: 'system', username: 'system', content: data.message as string, timestamp: Date.now(), isSystem: true },
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
      case 'mod:ban':
      case 'mod:kick': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (!targetUserId || targetUserId !== currentViewerId) {
          break;
        }

        const action = event === 'mod:ban' ? 'BAN' : event === 'mod:kick' ? 'KICK' : 'TIMEOUT';
        const expiresAt =
          typeof data.expiresAt === 'string' && data.expiresAt.length > 0 ? data.expiresAt : null;
        const until = expiresAt ? ` Until ${new Date(expiresAt).toLocaleTimeString()}.` : '';
        setChatRestriction(
          action === 'BAN'
            ? 'You are banned from this room. Your turn ended immediately and you were removed from the control queue.'
            : action === 'KICK'
              ? 'You were removed from control immediately and taken out of the control queue.'
              : `You are temporarily restricted in this room. Your turn ended immediately and you were removed from the control queue.${until}`,
        );
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
  }, [currentViewerId]);

  // ─── Controls ─────────────────────────────────────────────────────────────

  const sendCommand = useCallback(
    (command: string, cooldownMs = 150) => {
      if (robot.queueMode !== 'DISABLED') {
        const myPos = userId ? queue.findIndex((entry) => entry.userId === userId) + 1 : 0;
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
      wsRef.current.send(JSON.stringify({ event: 'control:command', data: { robotId: robot.id, command, timestamp: Date.now() } }));
    },
    [queue, robot.id, robot.queueMode, userId],
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
        const command = WASD[key];
        setActiveKeys((s) => new Set(s).add(key));
        setActiveCommands((s) => new Set(s).add(command));
        activeMotionKeysRef.current.add(key);
        sendCommand(command);
      }
      if (keyToBtn.has(key) && !e.repeat) {
        e.preventDefault();
        const btn = keyToBtn.get(key)!;
        setActiveKeys((s) => new Set(s).add(key));
        sendCommand(btn.command, btn.cooldownMs);
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
          sendCommand('stop', 0);
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
    wsRef.current.send(JSON.stringify({ event: 'chat:message', data: { robotId: robot.id, content: text } }));
    setChatInput('');
  }, [chatInput, robot.id]);

  const requestRoomAccess = useCallback(async () => {
    setAccessLoading(true);
    setAccessError(null);
    try {
      api.setToken(accessToken);
      const grant = await api.verifyRobotAccess(robot.id, {
        password: accessPasswordInput.trim() || undefined,
        guestSessionId,
      });
      setRoomAccessToken(grant.token);
      window.sessionStorage.setItem(`botparty.room-access.${robot.id}`, grant.token);
      pushToast('Room access granted.', 'success', 1800);
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : 'Access denied');
    } finally {
      setAccessLoading(false);
    }
  }, [accessPasswordInput, accessToken, guestSessionId, robot.id]);

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

        setMessages((prev) => [
          ...prev.slice(-200),
          {
            userId: 'system',
            username: 'system',
            content:
              action === 'TIMEOUT'
                ? `${targetLabel} timed out for 5 minutes.`
                : action === 'BAN'
                  ? `${targetLabel} has been banned from this room.`
                  : `${targetLabel} has been unbanned.`,
            timestamp: Date.now(),
            isSystem: true,
          },
        ]);
        pushToast(
          action === 'TIMEOUT'
            ? 'Timeout applied.'
            : action === 'BAN'
              ? 'User banned.'
              : 'User unbanned.',
          'success',
        );
      } catch {
        setMessages((prev) => [
          ...prev.slice(-200),
          {
            userId: 'system',
            username: 'system',
            content: 'Moderation action failed.',
            timestamp: Date.now(),
            isSystem: true,
          },
        ]);
        pushToast('Moderation action failed.', 'error');
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

  const defaultButtons: ControlButton[] = [
    { id: 'w', label: 'W', command: 'forward', hotKey: 'w', icon: '▲', cooldownMs: 100, access: 'QUEUE_TURN', position: 0, color: null },
    { id: 'a', label: 'A', command: 'left',    hotKey: 'a', icon: '◀', cooldownMs: 100, access: 'QUEUE_TURN', position: 1, color: null },
    { id: 's', label: 'S', command: 'backward', hotKey: 's', icon: '▼', cooldownMs: 100, access: 'QUEUE_TURN', position: 2, color: null },
    { id: 'd', label: 'D', command: 'right',   hotKey: 'd', icon: '▶', cooldownMs: 100, access: 'QUEUE_TURN', position: 3, color: null },
  ];
  const buttons = controlButtons.length > 0 ? controlButtons : defaultButtons;

  const isOnline = robotStatus === 'ONLINE' || robotStatus === 'BUSY';
  const queueEnabled = robot.queueMode !== 'DISABLED';
  const myQueuePosition = userId ? queue.findIndex((entry) => entry.userId === userId) + 1 : 0;
  const isMyTurn = !queueEnabled || (myQueuePosition > 0 && myQueuePosition === 1);
  const canUseButton = useCallback((button: ControlButton) => {
    if (button.access === 'EVERYONE') return true;
    if (button.access === 'QUEUE_TURN') return isMyTurn;
    return canModerate;
  }, [canModerate, isMyTurn]);

  useEffect(() => {
    if (!userId) {
      setInQueue(false);
      return;
    }
    setInQueue(queue.some((entry) => entry.userId === userId));
  }, [queue, userId]);

  useEffect(() => {
    if (!isMyTurn && activeMotionKeysRef.current.size > 0) {
      releaseLocalControls(true);
    }
  }, [isMyTurn, releaseLocalControls]);

  // ─── UI ───────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Link href="/explore" className="hover:text-[var(--foreground)] transition-colors">Explore</Link>
        <span>/</span>
        <span className="text-[var(--foreground)]">{robot.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-[var(--online)]' : 'bg-zinc-600'}`} />
          <span className="text-xs">
            {connected ? `${viewers.length} viewer${viewers.length !== 1 ? 's' : ''}` : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ─── Left column: video + controls ─── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Video */}
          <div className="relative aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-black">
            {(robot.accessMode === 'PASSWORD' || robot.accessMode === 'ALLOWED_USERS') && !roomAccessToken && !guestVideoAllowed ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-[var(--muted-foreground)]">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                  <Video className="h-7 w-7 text-sky-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {robot.accessMode === 'PASSWORD'
                      ? 'This room is password protected.'
                      : 'This room is allow-list only.'}
                  </p>
                  <p className="mt-1 text-sm">
                    {robot.accessMode === 'PASSWORD'
                      ? 'Enter the room password to unlock video, chat, and controls.'
                      : accessToken
                        ? 'Verifying your room access...'
                        : 'Sign in with an allowed account to enter this room.'}
                  </p>
                </div>
                {robot.accessMode === 'PASSWORD' && (
                  <div className="flex w-full max-w-sm gap-2">
                    <input
                      type="password"
                      value={accessPasswordInput}
                      onChange={(event) => setAccessPasswordInput(event.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)]"
                      placeholder="Room password"
                    />
                    <button
                      type="button"
                      onClick={() => void requestRoomAccess()}
                      disabled={accessLoading}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFocusMode('controls')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
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
              onClick={() => { setFocusMode('chat'); setTimeout(() => chatInputRef.current?.focus(), 50); }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                focusMode === 'chat'
                  ? 'bg-[var(--primary)] text-white'
                  : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50'
              }`}
            >
              Chat
            </button>
            <span className="text-xs text-[var(--muted-foreground)]">Tab to switch &middot; ESC = E-STOP</span>
          </div>

          {/* Controls panel */}
          <div
            className={`rounded-xl border p-5 transition-colors ${
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

            <div className="flex flex-wrap items-start gap-5">
              {/* D-pad layout */}
              <div className="grid grid-cols-3 grid-rows-3 gap-1">
                {/* Row 1: top-center = W */}
                <div />
                {(['w'] as const).map((k) => {
                  const btn = buttons.find((b) => b.hotKey === k);
                  const cmd = btn?.command ?? 'forward';
                  const isDown = activeCommands.has(cmd);
                  return (
                    <ControlKey
                      key={k}
                      label={btn?.icon ?? k.toUpperCase()}
                      hotKey={k}
                      isDown={isDown}
                      isCrowd={isCrowdActive(cmd)}
                      disabled={Boolean(btn) && (btn ? !canUseButton(btn) : true)}
                      onPress={() => sendCommand(cmd, btn?.cooldownMs)}
                    />
                  );
                })}
                <div />
                {/* Row 2: A S D */}
                {(['a', 's', 'd'] as const).map((k) => {
                  const btn = buttons.find((b) => b.hotKey === k);
                  const fallback = k === 'a' ? 'left' : k === 's' ? 'backward' : 'right';
                  const cmd = btn?.command ?? fallback;
                  const isDown = activeCommands.has(cmd);
                  return (
                    <ControlKey
                      key={k}
                      label={btn?.icon ?? k.toUpperCase()}
                      hotKey={k}
                      isDown={isDown}
                      isCrowd={isCrowdActive(cmd)}
                      disabled={Boolean(btn) && (btn ? !canUseButton(btn) : true)}
                      onPress={() => sendCommand(cmd, btn?.cooldownMs)}
                    />
                  );
                })}
                {/* Row 3: empty */}
                <div /><div /><div />
              </div>

              {/* Extra buttons */}
              <div className="flex flex-wrap gap-2">
                {buttons
                  .filter((b) => !['w', 'a', 's', 'd'].includes(b.hotKey ?? ''))
                  .filter((b) => canUseButton(b))
                  .map((btn) => (
                    <button
                      key={btn.id}
                      onMouseDown={() => sendCommand(btn.command, btn.cooldownMs)}
                      style={btn.color ? { borderColor: btn.color, color: btn.color } : undefined}
                      className={`flex h-11 min-w-[2.75rem] items-center justify-center gap-1 rounded-lg border px-3 text-sm font-bold transition select-none ${
                        isCrowdActive(btn.command)
                          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                          : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:border-[var(--primary)] hover:text-white'
                      }`}
                    >
                      {btn.icon && <span>{btn.icon}</span>}
                      {btn.label}
                      {btn.hotKey && <span className="ml-1 text-xs opacity-40">[{btn.hotKey}]</span>}
                    </button>
                  ))}
              </div>

              <div className="h-11 w-px self-center bg-[var(--border)]" />

              {/* E-STOP */}
              {canUseEStop && (
                <button
                  onMouseDown={triggerEStop}
                  className="flex h-14 w-24 flex-col items-center justify-center rounded-xl bg-[var(--destructive)] text-xs font-black text-white shadow-lg shadow-red-500/20 transition hover:brightness-110 active:scale-95 select-none"
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
                <h1 className="font-bold text-lg">{robot.name}</h1>
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

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
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
                  <div key={entry.userId} className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={i === 0 ? 'font-medium' : 'text-[var(--muted-foreground)]'}>
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
              className="mb-2 h-44 overflow-y-auto rounded-lg bg-[var(--background)] px-2 py-1.5 text-sm"
            >
              <div className="flex min-h-full flex-col justify-end gap-1.5">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`animate-fade-in rounded-md border px-2.5 py-1.5 ${
                      msg.isSystem
                        ? 'border-[var(--border)] bg-[var(--muted)]/30'
                        : msg.userId === userId
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
                        msg.userId !== userId && (
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
    </div>
  );
}

// ─── ControlKey helper ────────────────────────────────────────────────────────

function ControlKey({
  label,
  hotKey,
  isDown,
  isCrowd,
  disabled,
  onPress,
}: {
  label: string;
  hotKey: string;
  isDown: boolean;
  isCrowd: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      onMouseDown={disabled ? undefined : onPress}
      title={hotKey.toUpperCase()}
      disabled={disabled}
      className={`flex h-11 w-11 items-center justify-center rounded-lg border text-sm font-bold transition select-none ${
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
