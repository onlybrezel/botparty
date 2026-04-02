'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
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

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  robot: RobotPublic;
}

export default function RobotView({ robot }: Props) {
  const { accessToken, username, userId } = useAuth();

  const [focusMode, setFocusMode] = useState<FocusMode>('controls');
  const [controlButtons, setControlButtons] = useState<ControlButton[]>([]);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
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
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [moderatingUserId, setModeratingUserId] = useState<string | null>(null);
  const [robotStatus, setRobotStatus] = useState(robot.status);
  const [chatRestriction, setChatRestriction] = useState<string | null>(null);
  const [tabSwitchOnlyWhenEmpty, setTabSwitchOnlyWhenEmpty] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState<Array<{ time: string; type: string; msg: string }>>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const cooldownMap = useRef<Map<string, number>>(new Map());
  const lastErrorToastRef = useRef<{ message: string; timestamp: number } | null>(null);

  const addDebugLog = useCallback(
    (type: 'command' | 'chat' | 'event' | 'error') => {
      return (msg: string) => {
        if (debugMode) {
          const time = new Date().toLocaleTimeString();
          setDebugLogs((prev) => [...prev.slice(-49), { time, type, msg }]);
        }
      };
    },
    [debugMode],
  );

  // ─── Fetch controls ────────────────────────────────────────────────────────

  const isAuthenticated = Boolean(accessToken && userId);
  const robotAccess = (robot as RobotPublic & {
    metadata?: { access?: { estop?: 'ALL' | 'AUTHENTICATED' | 'DISABLED' } };
  }).metadata?.access;
  const canUseAccess = (mode: 'ALL' | 'AUTHENTICATED' | 'DISABLED' | undefined) => {
    if (mode === 'DISABLED') return false;
    if (mode === 'ALL') return true;
    return isAuthenticated;
  };
  const estopAccess = robotAccess?.estop;
  const canUseEStop = canUseAccess(estopAccess);
  const canModerate = Boolean(userId && userId === robot.owner.id);

  useEffect(() => {
    api.getControls(robot.id).then(setControlButtons).catch(() => {});
    
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

  // ─── Fetch LiveKit token (auth required) ──────────────────────────────────

  useEffect(() => {
    api.setToken(accessToken);

    const loadToken = async () => {
      setVideoState('loading');
      try {
        const publicUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        if (accessToken) {
          try {
            const { token, livekitUrl } = await api.getViewerToken(robot.id, false);
            setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
            setVideoState('ready');
            return;
          } catch {
            // Fall back to the guest token path when the local session is stale
            // or the room also allows public viewers.
          }
        }

        api.setToken(null);
        const { token, livekitUrl } = await api.getPublicViewerToken(robot.id);
        setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
        setVideoState('ready');
      } catch {
        setLivekitCreds(null);
        setVideoState('error');
      }
    };

    loadToken().catch(() => {});
  }, [accessToken, robot.id]);

  // ─── Fetch queue ──────────────────────────────────────────────────────────

  useEffect(() => {
    api.getQueue(robot.id).then(setQueue).catch(() => {});
  }, [robot.id]);

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
              userId: userId ?? undefined,
              username: username ?? undefined,
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
  }, [robot.id, userId, username]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setQueue((data.queue as QueueEntry[]) ?? []);
        break;
      case 'robot:status': {
        const status = typeof data.status === 'string' ? data.status : robot.status;
        setRobotStatus(status as RobotPublic['status']);
        if (status === 'OFFLINE') {
          setLivekitCreds(null);
          setVideoState('idle');
        }
        break;
      }
      case 'error': {
        const message = typeof data.message === 'string' ? data.message : 'Unknown websocket error';
        if (message.includes('restricted')) {
          const restriction = (data.restriction as { action?: string; expiresAt?: string | null } | undefined) ?? {};
          const text = restriction.action
            ? `You are currently restricted (${restriction.action}).`
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
  }, []);

  // ─── Controls ─────────────────────────────────────────────────────────────

  const sendCommand = useCallback(
    (command: string, cooldownMs = 150) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        addDebugLog('error')(`Command blocked: not connected (${command})`);
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
      addDebugLog('command')(`Sent: ${command}`);
      wsRef.current.send(JSON.stringify({ event: 'control:command', data: { robotId: robot.id, command, timestamp: Date.now() } }));
    },
    [robot.id, addDebugLog],
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
      const inChatInput = target === chatInputRef.current;

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
      if (inInput || focusMode === 'chat' || inChatInput) return;

      const key = e.key.toLowerCase();
      if (WASD[key] && !e.repeat) {
        e.preventDefault();
        setActiveKeys((s) => new Set(s).add(key));
        sendCommand(WASD[key]);
      }
      if (keyToBtn.has(key) && !e.repeat) {
        e.preventDefault();
        const btn = keyToBtn.get(key)!;
        setActiveKeys((s) => new Set(s).add(key));
        sendCommand(btn.command, btn.cooldownMs);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      setActiveKeys((s) => { const n = new Set(s); n.delete(key); return n; });
      if (WASD[key]) sendCommand('stop', 0);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [focusMode, controlButtons, sendCommand, triggerEStop, canUseEStop, tabSwitchOnlyWhenEmpty]);

  // ─── Chat ─────────────────────────────────────────────────────────────────

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Save chat history to localStorage
  useEffect(() => {
    try {
      const key = `botparty.chat.${robot.id}`;
      window.localStorage.setItem(key, JSON.stringify(messages));
    } catch {
      // Ignore localStorage errors (quota full, etc)
    }
  }, [messages, robot.id]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      addDebugLog('error')('Chat blocked: not connected');
      // Show warning only once per 3 seconds if not connected
      const now = Date.now();
      const lastError = lastErrorToastRef.current;
      if (!lastError || now - lastError.timestamp > 3000) {
        pushToast('Waiting for connection to robot...', 'error', 2000);
        lastErrorToastRef.current = { message: 'disconnected', timestamp: now };
      }
      return;
    }
    addDebugLog('chat')(`Message sent: "${text}"`);
    wsRef.current.send(JSON.stringify({ event: 'chat:message', data: { robotId: robot.id, content: text } }));
    setChatInput('');
  }, [chatInput, robot.id, addDebugLog]);

  const moderateChatUser = useCallback(
    async (targetUserId: string, action: 'TIMEOUT' | 'BAN' | 'UNBAN') => {
      if (!canModerate || !accessToken) return;
      setModeratingUserId(targetUserId);

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
                ? `User ${targetUserId.slice(0, 8)} timed out for 5 minutes.`
                : action === 'BAN'
                  ? `User ${targetUserId.slice(0, 8)} has been banned from this room.`
                  : `User ${targetUserId.slice(0, 8)} has been unbanned.`,
            timestamp: Date.now(),
            isSystem: true,
          },
        ]);
        pushToast(
          action === 'TIMEOUT'
            ? 'Timeout wurde gesetzt.'
            : action === 'BAN'
              ? 'User wurde gebannt.'
              : 'User wurde entsperrt.',
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
    [accessToken, canModerate, robot.id],
  );

  // ─── Queue ─────────────────────────────────────────────────────────────────

  const toggleQueue = useCallback(async () => {
    if (!accessToken) return;
    api.setToken(accessToken);
    try {
      if (inQueue) {
        await api.leaveQueue(robot.id);
        setInQueue(false);
        pushToast('Left the queue.', 'info');
      } else {
        await api.joinQueue(robot.id);
        setInQueue(true);
        pushToast('Joined the queue.', 'success');
      }
      const updated = await api.getQueue(robot.id);
      setQueue(updated);
    } catch (err) {
      console.error('Queue error', err);
    }
  }, [accessToken, inQueue, robot.id]);

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
            {isOnline && livekitCreds ? (
              <LiveKitPlayer token={livekitCreds.token} livekitUrl={livekitCreds.url} />
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
            {isOnline && (
              <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-[var(--live)]/90 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" />
                LIVE
              </div>
            )}
          </div>

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
                  const isDown = activeKeys.has(k);
                  return (
                    <ControlKey
                      key={k}
                      label={btn?.icon ?? k.toUpperCase()}
                      hotKey={k}
                      isDown={isDown}
                      isCrowd={isCrowdActive(cmd)}
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
                  const isDown = activeKeys.has(k);
                  return (
                    <ControlKey
                      key={k}
                      label={btn?.icon ?? k.toUpperCase()}
                      hotKey={k}
                      isDown={isDown}
                      isCrowd={isCrowdActive(cmd)}
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
                  robot.status === 'ONLINE'
                    ? 'bg-[var(--online)]/15 text-[var(--online)]'
                    : robot.status === 'BUSY'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-zinc-700/50 text-zinc-400'
                }`}
              >
                {robot.status.charAt(0) + robot.status.slice(1).toLowerCase()}
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
                    {i === 0 && (
                      <span className="ml-auto text-xs text-[var(--online)]">Controlling</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chat */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              focusMode === 'chat' ? 'border-[var(--primary)]/50 bg-[var(--card)]' : 'border-[var(--border)] bg-[var(--card)]'
            }`}
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Chat
            </p>

            <div className="mb-3 h-52 space-y-1 overflow-y-auto rounded-lg bg-[var(--background)] p-2 text-sm leading-relaxed">
              {messages.map((msg, i) => (
                <p key={i} className="animate-fade-in">
                  {msg.isSystem ? (
                    <span className="italic text-[var(--muted-foreground)]">{msg.content}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-semibold text-violet-400">{msg.username}: </span>
                      <span className="text-[var(--foreground)]/90">{msg.content}</span>
                      {canModerate &&
                        msg.userId !== 'system' &&
                        msg.userId !== userId &&
                        /^[0-9a-f-]{36}$/i.test(msg.userId) && (
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void moderateChatUser(msg.userId, 'TIMEOUT')}
                              disabled={moderatingUserId === msg.userId}
                              className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 transition-all hover:border-amber-500/80 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Timeout
                            </button>
                            <button
                              type="button"
                              onClick={() => void moderateChatUser(msg.userId, 'BAN')}
                              disabled={moderatingUserId === msg.userId}
                              className="rounded border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-300 transition-all hover:border-red-500/80 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Ban
                            </button>
                            <button
                              type="button"
                              onClick={() => void moderateChatUser(msg.userId, 'UNBAN')}
                              disabled={moderatingUserId === msg.userId}
                              className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-300 transition-all hover:border-emerald-500/80 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Unban
                            </button>
                          </span>
                        )}
                    </span>
                  )}
                </p>
              ))}
              <div ref={chatEndRef} />
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
                className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--primary-hover)] hover:shadow-lg hover:shadow-[var(--primary)]/25 active:scale-95 disabled:opacity-50 disabled:hover:shadow-none"
              >
                Send
              </button>
            </div>
            <p className="mt-1 text-right text-xs text-[var(--muted-foreground)]">
              {chatInput.length}/300
            </p>
            {chatRestriction && (
              <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                {chatRestriction}
              </p>
            )}
          </div>
        </div>

        {/* Debug console */}
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">Debug Console</h3>
            <button
              onClick={() => {
                setDebugMode(!debugMode);
                if (!debugMode) setDebugLogs([]);
              }}
              className={`text-xs px-2 py-1 rounded transition-all ${
                debugMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 hover:border-emerald-500/60' : 'bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--muted)]/80 hover:border-emerald-500/40'
              }`}
            >
              {debugMode ? 'ON' : 'OFF'}
            </button>
          </div>
          {debugMode && (
            <div className="h-32 overflow-y-auto bg-black rounded border border-[var(--border)] p-2 font-mono text-xs text-white/60">
              {debugLogs.length === 0 ? (
                <p className="text-[var(--muted-foreground)]">// Waiting for events...</p>
              ) : (
                debugLogs.map((log, i) => (
                  <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'command' ? 'text-emerald-400' : 'text-white/60'}>
                    <span className="text-white/40">{log.time}</span> {log.type === 'command' && '▶'} {log.msg}
                  </div>
                ))
              )}
            </div>
          )}
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
  onPress,
}: {
  label: string;
  hotKey: string;
  isDown: boolean;
  isCrowd: boolean;
  onPress: () => void;
}) {
  return (
    <button
      onMouseDown={onPress}
      title={hotKey.toUpperCase()}
      className={`flex h-11 w-11 items-center justify-center rounded-lg border text-sm font-bold transition select-none ${
        isDown
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
