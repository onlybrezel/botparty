'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WS_PROTOCOL_VERSION, type RobotPublic } from '@botparty/shared';
import { api, createApiClient } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { pushToast } from '@/lib/toast';
import { usePreferences } from '@/lib/preferences';
import {
  buildWidgetControlGroups,
  getErrorMessage,
  getQueuePosition,
  getRoomAccessGateState,
  isRobotOnline,
  loadStoredChatMessages,
  loadStoredRoomAccessToken,
  mergeChatMessages,
  pushThrottledToast,
  saveStoredChatMessages,
  saveStoredRoomAccessToken,
  type ToastThrottleState,
} from './robot-view-state.helpers';
import { createRobotWsEventHandler } from './robot-view-ws-events';
import {
  type ActiveSessionState,
  type ChatMsg,
  type ControlButton,
  type FocusMode,
  type QueueEntry,
  type QueueEntryWire,
  type ReconnectNotice,
  type Viewer,
  WASD,
  buildGuestMessageId,
  getOrCreateGuestSessionId,
  normalizeQueueEntries,
  resolveWsUrl,
} from './types';
import { useRobotRecordingState } from './use-robot-recording-state';

function createInitialMessages(robotName: string): ChatMsg[] {
  return [
    {
      userId: 'system',
      username: 'system',
      content: `Welcome to ${robotName}!`,
      timestamp: Date.now(),
      isSystem: true,
    },
  ];
}

export function useRobotViewState(robot: RobotPublic) {
  const publicApiRef = useRef(createApiClient());
  const searchParams = useSearchParams();
  const { accessToken, userId, username, role, hasHydrated } = useAuth();
  const preferencesHydrated = usePreferences((state) => state.hydrated);
  const tabSwitchOnlyWhenEmpty = usePreferences((state) => state.keyboardTabSwitchOnlyWhenEmpty);
  const queuePositionNotifications = usePreferences((state) => state.queuePositionNotifications);
  const queueTurnNotifications = usePreferences((state) => state.queueTurnNotifications);
  const robotRoomOnboardingSeen = usePreferences((state) => state.robotRoomOnboardingSeen);
  const updatePreference = usePreferences((state) => state.updatePreference);

  const [focusMode, setFocusMode] = useState<FocusMode>('controls');
  const [controlButtons, setControlButtons] = useState<ControlButton[]>([]);
  const [, setActiveKeys] = useState<Set<string>>(new Set());
  const [activeCommands, setActiveCommands] = useState<Set<string>>(new Set());
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [crowdInputs, setCrowdInputs] = useState<Map<string, number>>(new Map());
  const [messages, setMessages] = useState<ChatMsg[]>(() => createInitialMessages(robot.name));
  const [chatHistoryCursor, setChatHistoryCursor] = useState<number | null>(null);
  const [chatHistoryHasMore, setChatHistoryHasMore] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
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
  const [guestSessionId] = useState<string>(() => getOrCreateGuestSessionId());
  const currentViewerId = userId ? userId : `guest:${guestSessionId}`;
  const inviteCodeFromUrl =
    searchParams.get('invite')?.trim() ?? searchParams.get('code')?.trim() ?? '';
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
  const [queueAction, setQueueAction] = useState<'join' | 'leave' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const controlsPanelRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const cooldownMap = useRef<Map<string, number>>(new Map());
  const lastErrorToastRef = useRef<ToastThrottleState | null>(null);
  const activeMotionKeysRef = useRef<Set<string>>(new Set());
  const livekitRefreshInFlightRef = useRef(false);
  const livekitRefreshAttemptRef = useRef(0);
  const allowListAccessAttemptedRef = useRef(false);
  const linkOnlyAccessAttemptedRef = useRef(false);
  const previousRobotStatusRef = useRef(robot.status);
  const initialChatScrollDoneRef = useRef(false);
  const chatShouldStickRef = useRef(true);
  const shutdownNoticeAtRef = useRef(0);
  const reconnectRetryAfterRef = useRef<number | null>(null);
  const wasMyTurnRef = useRef(false);
  const wasOnlineRef = useRef(robot.status === 'ONLINE' || robot.status === 'BUSY');
  const previousQueuePositionRef = useRef<number | null>(null);
  const activeGamepadCommandsRef = useRef<Set<string>>(new Set());

  // ─── Fetch controls ────────────────────────────────────────────────────────

  const isAuthenticated = Boolean(accessToken && userId);
  const robotAccess = (
    robot as RobotPublic & {
      metadata?: {
        access?: {
          video?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
          estop?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
        };
      };
    }
  ).metadata?.access;
  const canUseAccess = (mode: 'ALL' | 'AUTHENTICATED' | 'DISABLED' | undefined) => {
    if (mode === 'DISABLED') return false;
    if (mode === 'ALL') return true;
    return isAuthenticated;
  };
  const guestVideoAllowed = robotAccess?.video === 'ALL';
  const estopAccess = robotAccess?.estop;
  const canUseEStop = canUseAccess(estopAccess);
  const canModerate = Boolean(
    userId && (userId === robot.owner.id || role === 'ADMIN' || role === 'MOD'),
  );
  const isAdmin = role === 'ADMIN';
  const {
    recordingState,
    recordingLoading,
    recordingAction,
    recordingError,
    recordingCameraSummary,
    toggleRecording,
  } = useRobotRecordingState({
    robotId: robot.id,
    robotStatus,
    isAdmin,
    accessToken,
  });

  useEffect(() => {
    let active = true;

    const sameButton = (a: ControlButton, b: ControlButton) =>
      a.id === b.id &&
      a.label === b.label &&
      a.command === b.command &&
      a.hotKey === b.hotKey &&
      a.icon === b.icon &&
      a.cooldownMs === b.cooldownMs &&
      a.costCredits === b.costCredits &&
      a.access === b.access &&
      a.position === b.position &&
      a.color === b.color;

    const syncControls = () => {
      api.controls
        .getControls(robot.id)
        .then((next) => {
          if (!active) return;
          setControlButtons((prev) => {
            if (
              prev.length === next.length &&
              prev.every((entry, index) => sameButton(entry, next[index]!))
            ) {
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
    setChatHistoryCursor(null);
    setChatHistoryHasMore(false);
    setChatHistoryLoading(false);

    const storedMessages = loadStoredChatMessages(robot.id);
    setMessages(
      storedMessages.length > 0 ? storedMessages : createInitialMessages(robot.name),
    );
  }, [robot.id, robot.name]);

  useEffect(() => {
    if (robot.accessMode === 'OPEN') {
      setRoomAccessToken(null);
      setAccessError(null);
      allowListAccessAttemptedRef.current = false;
      linkOnlyAccessAttemptedRef.current = false;
      return;
    }

    const stored = loadStoredRoomAccessToken(robot.id);
    setRoomAccessToken(stored);
    allowListAccessAttemptedRef.current = robot.accessMode === 'ALLOWED_USERS' && Boolean(stored);
    linkOnlyAccessAttemptedRef.current = robot.accessMode === 'LINK_ONLY' && Boolean(stored);
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
    api.robots
      .verifyRobotAccess(robot.id)
      .then((grant) => {
        if (!active) return;
        setRoomAccessToken(grant.token);
        setAccessError(null);
        saveStoredRoomAccessToken(robot.id, grant.token);
      })
      .catch((error) => {
        if (!active) return;
        setAccessError(getErrorMessage(error, 'Access denied'));
      })
      .finally(() => {
        if (active) {
          setAccessLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessLoading, accessToken, robot.accessMode, robot.id, roomAccessToken]);

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
    api.robots
      .verifyRobotAccess(robot.id, {
        inviteCode: inviteCodeFromUrl,
      })
      .then((grant) => {
        if (!active) return;
        setRoomAccessToken(grant.token);
        saveStoredRoomAccessToken(robot.id, grant.token);
      })
      .catch((error) => {
        if (!active) return;
        linkOnlyAccessAttemptedRef.current = false;
        setAccessError(getErrorMessage(error, 'Invite access denied'));
      })
      .finally(() => {
        if (active) {
          setAccessLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessToken, inviteCodeFromUrl, robot.accessMode, robot.id, roomAccessToken]);

  // ─── Fetch LiveKit token (auth required) ──────────────────────────────────

  const refreshViewerToken = useCallback(
    async (forceRemount = false) => {
      if (!hasHydrated) {
        return;
      }

      const roomAccessGate = getRoomAccessGateState({
        accessMode: robot.accessMode,
        accessToken,
        roomAccessToken,
        guestVideoAllowed,
      });

      if (roomAccessGate.shouldBlockViewerToken) {
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
            const { token, livekitUrl } = await api.robots.getViewerToken(robot.id, false);
            setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
            setVideoState('ready');
            livekitRefreshAttemptRef.current = 0;
            if (forceRemount) {
              setLivekitVersion((value) => value + 1);
            }
            return;
          } catch {
            // Fall back to guest viewer token.
          }
        }

        const { token, livekitUrl } = await publicApiRef.current.robots.getPublicViewerToken(
          robot.id,
        );
        setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
        setVideoState('ready');
        livekitRefreshAttemptRef.current = 0;
        if (forceRemount) {
          setLivekitVersion((value) => value + 1);
        }
      } catch {
        livekitRefreshAttemptRef.current += 1;
        setLivekitCreds(null);
        setVideoState('error');
      } finally {
        livekitRefreshInFlightRef.current = false;
      }
    },
    [accessToken, guestVideoAllowed, hasHydrated, robot.accessMode, robot.id, roomAccessToken],
  );

  useEffect(() => {
    void refreshViewerToken(false);
  }, [refreshViewerToken]);

  useEffect(() => {
    const currentlyOnline = isRobotOnline(robotStatus);
    if (!currentlyOnline || livekitCreds || livekitRefreshInFlightRef.current) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        void refreshViewerToken(true);
      },
      Math.min(3000 * Math.pow(1.5, livekitRefreshAttemptRef.current), 30_000),
    );

    return () => window.clearTimeout(timer);
  }, [livekitCreds, refreshViewerToken, robotStatus]);

  useEffect(() => {
    const previousStatus = previousRobotStatusRef.current;
    previousRobotStatusRef.current = robotStatus;

    const robotCameBackOnline =
      (previousStatus === 'OFFLINE' || previousStatus === 'MAINTENANCE') &&
      isRobotOnline(robotStatus);

    if (!robotCameBackOnline) {
      return;
    }

    void refreshViewerToken(true);
  }, [refreshViewerToken, robotStatus]);

  // ─── Fetch queue ──────────────────────────────────────────────────────────

  useEffect(() => {
    api.setToken(accessToken);
    api.queue
      .getQueue(robot.id)
      .then((rows) => setQueue(normalizeQueueEntries(rows as QueueEntryWire[])))
      .catch(() => {});
  }, [accessToken, robot.id, roomAccessToken]);

  useEffect(() => {
    let active = true;
    api.moderation
      .getActiveSession(robot.id)
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

  // ─── WebSocket ────────────────────────────────────────────────────────────

  useEffect(() => {
    const passwordGateMissing = robot.accessMode === 'PASSWORD' && !roomAccessToken;
    const allowlistGateMissing =
      robot.accessMode === 'ALLOWED_USERS' && !roomAccessToken && !accessToken;
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
              protocolVersion: WS_PROTOCOL_VERSION,
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
          const { event, data } = JSON.parse(e.data as string) as {
            event: string;
            data: Record<string, unknown>;
          };
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
  }, [accessToken, robot.accessMode, robot.id, roomAccessToken, userId]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    const interval = window.setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        return;
      }

      wsRef.current.send(
        JSON.stringify({
          event: 'room:ping',
          data: { robotId: robot.id },
        }),
      );
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [connected, robot.id]);

  const handleWsEvent = useMemo(
    () =>
      createRobotWsEventHandler({
        currentViewerId,
        initialRobotStatus: robot.status,
        refreshViewerToken,
        wsRef,
        activeMotionKeysRef,
        reconnectRetryAfterRef,
        shutdownNoticeAtRef,
        lastErrorToastRef,
        setViewers,
        setCrowdInputs,
        setMessages,
        setChatHistoryCursor,
        setChatHistoryHasMore,
        setQueue,
        setActiveSession,
        setActiveKeys,
        setActiveCommands,
        setChatRestriction,
        setRobotStatus,
        setLivekitCreds,
        setVideoState,
        setInQueue,
        setReconnectNotice,
      }),
    [currentViewerId, refreshViewerToken, robot.status],
  );

  // ─── Controls ─────────────────────────────────────────────────────────────

  const sendCommand = useCallback(
    (
      command: string,
      options?: { cooldownMs?: number; access?: ControlButton['access']; value?: unknown },
    ) => {
      const cooldownMs = options?.cooldownMs ?? 150;
      const buttonAccess = options?.access ?? 'QUEUE_TURN';

      if (robot.queueMode !== 'DISABLED' && buttonAccess === 'QUEUE_TURN') {
        const myPos = getQueuePosition(queue, currentViewerId);
        const myTurn = myPos > 0 && myPos === 1;
        if (!myTurn) {
          pushThrottledToast(
            lastErrorToastRef,
            'control-queue-blocked',
            myPos > 0
              ? `Queue position #${myPos}. Wait until you are #1.`
              : 'Join the queue to control this robot.',
            { cooldownMs: 3000, kind: 'error', durationMs: 2200 },
          );
          return;
        }
      }

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        pushThrottledToast(lastErrorToastRef, 'disconnected', 'Waiting for connection to robot...', {
          cooldownMs: 3000,
          kind: 'error',
          durationMs: 2000,
        });
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
    wsRef.current.send(
      JSON.stringify({ event: 'control:emergency-stop', data: { robotId: robot.id } }),
    );
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

      if (e.key === 'Escape' && canUseEStop) {
        triggerEStop();
        return;
      }
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
      } else if (keyToBtn.has(key) && !e.repeat) {
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
      setActiveKeys((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
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
  }, [
    focusMode,
    controlButtons,
    sendCommand,
    triggerEStop,
    canUseEStop,
    releaseLocalControls,
    tabSwitchOnlyWhenEmpty,
  ]);

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

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldStickToBottom = chatShouldStickRef.current || distanceFromBottom < 80;

    if (!shouldStickToBottom) {
      return;
    }

    requestAnimationFrame(() => {
      scrollChatToBottom('auto');
    });
  }, [messages, scrollChatToBottom]);

  const saveChatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveChatTimerRef.current) clearTimeout(saveChatTimerRef.current);
    saveChatTimerRef.current = setTimeout(() => {
      saveStoredChatMessages(robot.id, messages);
    }, 1000);
    return () => {
      if (saveChatTimerRef.current) clearTimeout(saveChatTimerRef.current);
    };
  }, [messages, robot.id]);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      pushThrottledToast(lastErrorToastRef, 'disconnected', 'Waiting for connection to robot...', {
        cooldownMs: 3000,
        kind: 'error',
        durationMs: 2000,
      });
      return;
    }
    const clientMessageId = buildGuestMessageId();
    setMessages((prev) =>
      mergeChatMessages(prev, [
        {
          userId: currentViewerId,
          username: userId ? (username ?? 'You') : 'Guest',
          content: text,
          timestamp: Date.now(),
          clientMessageId,
        },
      ]),
    );
    wsRef.current.send(
      JSON.stringify({
        event: 'chat:message',
        data: { robotId: robot.id, content: text, clientMessageId },
      }),
    );
    setChatInput('');
  }, [chatInput, currentViewerId, robot.id, userId, username]);

  const loadOlderChatMessages = useCallback(async () => {
    if (chatHistoryLoading || !chatHistoryHasMore) {
      return;
    }

    const before =
      chatHistoryCursor ??
      messages.reduce<number | null>((oldest, entry) => {
        if (entry.isSystem) {
          return oldest;
        }
        return oldest === null ? entry.timestamp : Math.min(oldest, entry.timestamp);
      }, null);

    if (before === null) {
      setChatHistoryHasMore(false);
      return;
    }

    const previousHeight = chatScrollRef.current?.scrollHeight ?? 0;
    chatShouldStickRef.current = false;
    setChatHistoryLoading(true);

    try {
      api.setToken(accessToken);
      const page = await api.robots.getRobotChatHistory(robot.id, {
        before,
        limit: 50,
        roomAccessToken: roomAccessToken ?? undefined,
        guestSessionId,
      });

      setMessages((prev) => mergeChatMessages(prev, page.messages));
      setChatHistoryCursor(page.nextCursor);
      setChatHistoryHasMore(page.hasMore);

      requestAnimationFrame(() => {
        const container = chatScrollRef.current;
        if (container && previousHeight > 0) {
          container.scrollTop = container.scrollHeight - previousHeight;
        }
      });
    } catch (error) {
      pushToast(getErrorMessage(error, 'Failed to load older chat messages.'), 'error', 2200);
    } finally {
      setChatHistoryLoading(false);
    }
  }, [
    accessToken,
    chatHistoryCursor,
    chatHistoryHasMore,
    chatHistoryLoading,
    guestSessionId,
    messages,
    robot.id,
    roomAccessToken,
  ]);

  const requestRoomAccess = useCallback(async () => {
    setAccessLoading(true);
    setAccessError(null);
    try {
      api.setToken(accessToken);
      const grant = await api.robots.verifyRobotAccess(robot.id, {
        password: accessPasswordInput.trim() || undefined,
        inviteCode: inviteCodeFromUrl || undefined,
      });
      setRoomAccessToken(grant.token);
      saveStoredRoomAccessToken(robot.id, grant.token);
      pushToast('Room access granted.', 'success', 1800);
    } catch (error) {
      setAccessError(getErrorMessage(error, 'Access denied'));
    } finally {
      setAccessLoading(false);
    }
  }, [accessPasswordInput, accessToken, inviteCodeFromUrl, robot.id]);

  const moderateChatUser = useCallback(
    async (
      targetUserId: string,
      action: 'TIMEOUT' | 'BAN' | 'UNBAN',
      _preferredName?: string | null,
    ) => {
      if (!canModerate || !accessToken) return;
      setModeratingUserId(targetUserId);

      try {
        api.setToken(accessToken);
        await api.moderation.moderateRobotUser(robot.id, {
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
      } catch (error) {
        const message = getErrorMessage(error, 'Moderation action failed.');
        pushToast(message, 'error');
      } finally {
        setModeratingUserId(null);
      }
    },
    [accessToken, canModerate, robot.id],
  );

  // ─── Queue ─────────────────────────────────────────────────────────────────

  const toggleQueue = useCallback(async () => {
    if (!accessToken || queueAction) return;
    api.setToken(accessToken);
    const nextAction = inQueue ? 'leave' : 'join';
    setQueueAction(nextAction);
    try {
      if (inQueue) {
        releaseLocalControls(true);
        await api.queue.leaveQueue(robot.id);
        setInQueue(false);
        pushToast('Left the queue.', 'info');
      } else {
        await api.queue.joinQueue(robot.id, roomAccessToken);
        setInQueue(true);
        pushToast('Joined the queue.', 'success');
      }
      const updated = await api.queue.getQueue(robot.id);
      setQueue(updated);
    } catch (error) {
      pushToast(getErrorMessage(error, 'Queue update failed.'), 'error', 2200);
    } finally {
      setQueueAction(null);
    }
  }, [accessToken, inQueue, queueAction, releaseLocalControls, robot.id, roomAccessToken]);

  const voteForQueueUser = useCallback(
    async (targetUserId: string) => {
      if (!accessToken) {
        pushToast('Sign in to vote in queue mode.', 'error', 2200);
        return;
      }

      setVotingForUserId(targetUserId);
      try {
        api.setToken(accessToken);
        await api.queue.voteQueue(robot.id, targetUserId, roomAccessToken);
        const updated = await api.queue.getQueue(robot.id);
        setQueue(updated);
        pushToast('Vote submitted.', 'success', 1400);
      } catch (error) {
        pushToast(getErrorMessage(error, 'Vote failed.'), 'error', 2200);
      } finally {
        setVotingForUserId(null);
      }
    },
    [accessToken, robot.id, roomAccessToken],
  );

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isCrowdActive = (command: string) => Date.now() - (crowdInputs.get(command) ?? 0) < 600;

  const isOnline = isRobotOnline(robotStatus);
  const queueEnabled = robot.queueMode !== 'DISABLED';
  const myQueuePosition = getQueuePosition(queue, currentViewerId);
  const isMyTurn = !queueEnabled || (myQueuePosition > 0 && myQueuePosition === 1);
  const reconnectSeconds =
    reconnectCountdownMs !== null ? Math.max(1, Math.ceil(reconnectCountdownMs / 1000)) : null;
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
  const showRoomOnboarding = preferencesHydrated && !robotRoomOnboardingSeen;
  const canUseButton = useCallback(
    (button: ControlButton) => {
      if (button.access === 'EVERYONE') return true;
      if (button.access === 'QUEUE_TURN') return isMyTurn;
      if (button.access === 'MODERATOR') return canModerate;
      return Boolean(userId && userId === robot.owner.id);
    },
    [canModerate, isMyTurn, robot.owner.id, userId],
  );
  const { extraButtonControls, sliderControls, xyControls } = useMemo(
    () => buildWidgetControlGroups(controlButtons),
    [controlButtons],
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
    if (!isOnline || focusMode === 'chat') {
      return;
    }

    let frame = 0;
    const threshold = 0.45;

    const syncGamepad = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = pads.find((entry) => entry?.connected);
      const nextCommands = new Set<string>();

      if (pad && isMyTurn) {
        const x = pad.axes[0] ?? 0;
        const y = pad.axes[1] ?? 0;

        if (y <= -threshold || pad.buttons[12]?.pressed) nextCommands.add('forward');
        if (y >= threshold || pad.buttons[13]?.pressed) nextCommands.add('backward');
        if (x <= -threshold || pad.buttons[14]?.pressed) nextCommands.add('left');
        if (x >= threshold || pad.buttons[15]?.pressed) nextCommands.add('right');
      }

      const previousCommands = activeGamepadCommandsRef.current;

      for (const command of nextCommands) {
        if (!previousCommands.has(command)) {
          sendCommand(command, { cooldownMs: 0, access: 'QUEUE_TURN' });
        }
      }

      const hadCommands = previousCommands.size > 0;
      activeGamepadCommandsRef.current = nextCommands;

      if (hadCommands && nextCommands.size === 0) {
        sendCommand('stop', { cooldownMs: 0, access: 'QUEUE_TURN' });
      }

      frame = window.setTimeout(syncGamepad, 120);
    };

    frame = window.setTimeout(syncGamepad, 120);

    return () => {
      window.clearTimeout(frame);
      if (activeGamepadCommandsRef.current.size > 0) {
        activeGamepadCommandsRef.current.clear();
        sendCommand('stop', { cooldownMs: 0, access: 'QUEUE_TURN' });
      }
    };
  }, [focusMode, isMyTurn, isOnline, sendCommand]);

  useEffect(() => {
    const previousPosition = previousQueuePositionRef.current;
    previousQueuePositionRef.current = myQueuePosition > 0 ? myQueuePosition : null;

    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      document.visibilityState === 'visible' ||
      !inQueue ||
      myQueuePosition <= 0
    ) {
      return;
    }

    if (
      queuePositionNotifications &&
      previousPosition !== null &&
      previousPosition !== myQueuePosition &&
      myQueuePosition > 1
    ) {
      new Notification(`${robot.name}: queue update`, {
        body: `You moved to position #${myQueuePosition}.`,
        tag: `botparty-queue-${robot.id}`,
      });
    }

    if (queueTurnNotifications && previousPosition !== 1 && myQueuePosition === 1) {
      new Notification(`${robot.name}: it is your turn`, {
        body: 'Return to BotParty now. Controls are unlocked for you.',
        tag: `botparty-turn-${robot.id}`,
      });
    }
  }, [
    inQueue,
    myQueuePosition,
    queuePositionNotifications,
    queueTurnNotifications,
    robot.id,
    robot.name,
  ]);

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

  const dismissRoomOnboarding = useCallback(() => {
    if (!robotRoomOnboardingSeen) {
      updatePreference('robotRoomOnboardingSeen', true);
    }
  }, [robotRoomOnboardingSeen, updatePreference]);

  return {
    robot,
    accessToken,
    userId,
    username,
    role,
    hasHydrated,
    preferencesHydrated,
    tabSwitchOnlyWhenEmpty,
    queuePositionNotifications,
    queueTurnNotifications,
    robotRoomOnboardingSeen,
    updatePreference,
    focusMode,
    setFocusMode,
    controlButtons,
    activeCommands,
    setActiveCommands,
    viewers,
    queue,
    crowdInputs,
    messages,
    chatHistoryCursor,
    chatHistoryHasMore,
    chatHistoryLoading,
    chatInput,
    setChatInput,
    connected,
    inQueue,
    livekitCreds,
    livekitVersion,
    videoState,
    moderatingUserId,
    robotStatus,
    chatRestriction,
    votingForUserId,
    guestSessionId,
    currentViewerId,
    inviteCodeFromUrl,
    roomAccessToken,
    accessPasswordInput,
    setAccessPasswordInput,
    accessLoading,
    accessError,
    activeSession,
    turnCountdownMs,
    reconnectNotice,
    reconnectCountdownMs,
    widgetQueueResetEpoch,
    widgetOfflineResetEpoch,
    recordingState,
    recordingLoading,
    recordingAction,
    recordingError,
    queueAction,
    chatScrollRef,
    chatInputRef,
    controlsPanelRef,
    chatPanelRef,
    chatShouldStickRef,
    isAuthenticated,
    guestVideoAllowed,
    canUseEStop,
    canModerate,
    isAdmin,
    refreshViewerToken,
    recordingCameraSummary,
    toggleRecording,
    sendCommand,
    sendImmediateStop,
    releaseLocalControls,
    triggerEStop,
    activateControlsPanel,
    activateChatPanel,
    sendChat,
    loadOlderChatMessages,
    requestRoomAccess,
    moderateChatUser,
    toggleQueue,
    voteForQueueUser,
    isCrowdActive,
    buttons: controlButtons,
    isOnline,
    queueEnabled,
    myQueuePosition,
    isMyTurn,
    reconnectSeconds,
    viewerLabel,
    queueSummary,
    showRoomOnboarding,
    canUseButton,
    extraButtonControls,
    sliderControls,
    xyControls,
    dismissRoomOnboarding,
  };
}

export type RobotViewState = ReturnType<typeof useRobotViewState>;
