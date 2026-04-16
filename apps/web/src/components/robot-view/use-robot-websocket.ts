import { useEffect, useRef, useState, useCallback } from 'react';
import { type RobotPublic } from '@botparty/shared';
import { api } from '@/lib/api';
import { pushToast } from '@/lib/toast';
import type {
  ActiveSessionState,
  ChatMsg,
  QueueEntry,
  QueueEntryWire,
  ReconnectNotice,
  Viewer,
  FocusMode,
  ControlButton,
} from './types';
import { resolveWsUrl, normalizeQueueEntries } from './types';

interface UseRobotWebSocketOptions {
  robot: RobotPublic;
  guestSessionId: string;
  roomAccessToken: string | null;
  currentViewerId: string;
  userId: string | null;
  isAuthenticated: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/**
 * Custom hook to manage WebSocket connection for a robot room.
 * Handles message routing, state updates, and reconnection logic.
 */
export function useRobotWebSocket({
  robot,
  guestSessionId,
  roomAccessToken,
  currentViewerId,
  userId,
  isAuthenticated,
  onConnected,
  onDisconnected,
}: UseRobotWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      userId: 'system',
      username: 'system',
      content: `Welcome to ${robot.name}!`,
      timestamp: Date.now(),
      isSystem: true,
    },
  ]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSessionState | null>(null);
  const [controlButtons, setControlButtons] = useState<ControlButton[]>([]);
  const [chatRestriction, setChatRestriction] = useState<string | null>(null);
  const [reconnectNotice, setReconnectNotice] = useState<ReconnectNotice | null>(null);
  const [turnCountdownMs, setTurnCountdownMs] = useState<number | null>(null);
  const [reconnectCountdownMs, setReconnectCountdownMs] = useState<number | null>(null);
  const reconnectRetryAfterRef = useRef<number | null>(null);
  const lastErrorToastRef = useRef<{ message: string; timestamp: number } | null>(null);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const wsUrl = resolveWsUrl(robot.id, guestSessionId, roomAccessToken);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        onConnected?.();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWsMessage(msg);
        } catch (err) {
          console.error('Failed to parse WS message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        showErrorToast('Connection error');
      };

      ws.onclose = () => {
        setConnected(false);
        onDisconnected?.();
        // Auto-reconnect after delay
        setTimeout(() => connect(), 3000);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Failed to connect:', err);
      showErrorToast('Failed to connect to robot room');
    }
  }, [robot.id, guestSessionId, roomAccessToken, onConnected, onDisconnected]);

  const handleWsMessage = useCallback(
    (msg: any) => {
      const { event, data } = msg;

      switch (event) {
        case 'chat:message':
          setMessages((prev) => [...prev, data as ChatMsg]);
          break;

        case 'queue:updated':
          setQueue(normalizeQueueEntries(data as QueueEntryWire[]));
          break;

        case 'room:presence':
          setViewers(data as Viewer[]);
          break;

        case 'session:active':
          setActiveSession(data as ActiveSessionState);
          break;

        case 'controls:buttons':
          setControlButtons(data as ControlButton[]);
          break;

        case 'user:chat_restriction':
          setChatRestriction(data?.type ?? null);
          break;

        case 'turn:countdown':
          setTurnCountdownMs(data?.remainingMs ?? null);
          break;

        case 'reconnect:notice':
          setReconnectNotice(data as ReconnectNotice);
          setReconnectCountdownMs(data?.countdownMs ?? null);
          break;

        default:
          console.debug('Unhandled WS event:', event);
      }
    },
    [],
  );

  const sendMessage = useCallback((event: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
    }
  }, []);

  const showErrorToast = useCallback((message: string) => {
    const now = Date.now();
    if (!lastErrorToastRef.current || now - lastErrorToastRef.current.timestamp > 5000) {
      pushToast(message, 'error');
      lastErrorToastRef.current = { message, timestamp: now };
    }
  }, []);

  useEffect(() => {
    if (roomAccessToken) {
      connect();
      return () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      };
    }
  }, [roomAccessToken, connect]);

  return {
    ws: wsRef,
    connected,
    messages,
    queue,
    viewers,
    activeSession,
    controlButtons,
    chatRestriction,
    reconnectNotice,
    turnCountdownMs,
    reconnectCountdownMs,
    sendMessage,
  };
}
