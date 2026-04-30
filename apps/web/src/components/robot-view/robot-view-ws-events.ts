import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { RobotPublic } from '@botparty/shared';
import { api } from '@/lib/api';
import { pushToast } from '@/lib/toast';
import {
  mergeChatMessages,
  pushThrottledToast,
  type ToastThrottleState,
} from './robot-view-state.helpers';
import {
  normalizeQueueEntries,
  type ActiveSessionState,
  type ChatMsg,
  type QueueEntry,
  type QueueEntryWire,
  type ReconnectNotice,
  type Viewer,
} from './types';

type VideoState = 'idle' | 'loading' | 'ready' | 'error';

type RobotWsEventHandlerParams = {
  currentViewerId: string;
  initialRobotStatus: RobotPublic['status'];
  refreshViewerToken: (forceRemount?: boolean) => Promise<void>;
  wsRef: MutableRefObject<WebSocket | null>;
  activeMotionKeysRef: MutableRefObject<Set<string>>;
  reconnectRetryAfterRef: MutableRefObject<number | null>;
  shutdownNoticeAtRef: MutableRefObject<number>;
  lastErrorToastRef: MutableRefObject<ToastThrottleState | null>;
  setViewers: Dispatch<SetStateAction<Viewer[]>>;
  setCrowdInputs: Dispatch<SetStateAction<Map<string, number>>>;
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>;
  setChatHistoryCursor: Dispatch<SetStateAction<number | null>>;
  setChatHistoryHasMore: Dispatch<SetStateAction<boolean>>;
  setQueue: Dispatch<SetStateAction<QueueEntry[]>>;
  setActiveSession: Dispatch<SetStateAction<ActiveSessionState | null>>;
  setActiveKeys: Dispatch<SetStateAction<Set<string>>>;
  setActiveCommands: Dispatch<SetStateAction<Set<string>>>;
  setChatRestriction: Dispatch<SetStateAction<string | null>>;
  setRobotStatus: Dispatch<SetStateAction<RobotPublic['status']>>;
  setLivekitCreds: Dispatch<SetStateAction<{ token: string; url: string } | null>>;
  setVideoState: Dispatch<SetStateAction<VideoState>>;
  setInQueue: Dispatch<SetStateAction<boolean>>;
  setReconnectNotice: Dispatch<SetStateAction<ReconnectNotice | null>>;
};

function getEventTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function buildActiveSessionState(data: Record<string, unknown>) {
  const userId = typeof data.userId === 'string' ? data.userId : null;
  if (!userId) {
    return null;
  }

  const expiresAtValue =
    typeof data.expiresAt === 'number'
      ? data.expiresAt
      : typeof data.expiresAt === 'string'
        ? Date.parse(data.expiresAt)
        : null;

  return {
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : `session-${userId}`,
    userId,
    username: typeof data.username === 'string' ? data.username : userId.slice(0, 8),
    startedAt: Date.now(),
    expiresAt: Number.isFinite(expiresAtValue) ? expiresAtValue : null,
  } satisfies ActiveSessionState;
}

function clearLocalControlState(params: {
  currentViewerId: string;
  targetUserId: string | null;
  activeMotionKeysRef: MutableRefObject<Set<string>>;
  setActiveKeys: Dispatch<SetStateAction<Set<string>>>;
  setActiveCommands: Dispatch<SetStateAction<Set<string>>>;
}) {
  const { currentViewerId, targetUserId, activeMotionKeysRef, setActiveKeys, setActiveCommands } =
    params;

  if (!targetUserId || targetUserId !== currentViewerId) {
    return;
  }

  activeMotionKeysRef.current.clear();
  setActiveKeys(new Set());
  setActiveCommands(new Set());
}

function handleRestrictionEvent(params: {
  event: 'mod:timeout' | 'mod:ban';
  data: Record<string, unknown>;
  currentViewerId: string;
  setChatRestriction: Dispatch<SetStateAction<string | null>>;
}) {
  const { event, data, currentViewerId, setChatRestriction } = params;
  const targetUserId = typeof data.userId === 'string' ? data.userId : null;

  if (!targetUserId || targetUserId !== currentViewerId) {
    return;
  }

  const action = event === 'mod:ban' ? 'BAN' : 'TIMEOUT';
  const expiresAt =
    typeof data.expiresAt === 'string' && data.expiresAt.length > 0 ? data.expiresAt : null;
  const until = expiresAt ? ` Until ${new Date(expiresAt).toLocaleTimeString()}.` : '';

  setChatRestriction(
    action === 'BAN'
      ? 'You are banned from this room. Your turn ended immediately and you were removed from the control queue.'
      : `You are temporarily restricted in this room. Your turn ended immediately and you were removed from the control queue.${until}`,
  );

  pushToast(
    action === 'BAN'
      ? 'You were banned from this room.'
      : `You were timed out in this room.${until}`,
    'error',
    2600,
  );
}

function handleWalletUpdate(data: Record<string, unknown>) {
  const balance = typeof data.balance === 'number' ? data.balance : null;

  if (balance === null || typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ balance: number }>('botparty:wallet-update', {
      detail: { balance },
    }),
  );
}

export function createRobotWsEventHandler(params: RobotWsEventHandlerParams) {
  return (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case 'presence:update':
        params.setViewers((data.viewers as Viewer[]) ?? []);
        break;
      case 'presence:join':
        params.setViewers((current) => {
          if (current.some((entry) => entry.userId === data.userId)) {
            return current;
          }

          return [
            ...current,
            {
              userId: data.userId as string,
              username: data.username as string,
              joinedAt: Date.now(),
            },
          ];
        });
        break;
      case 'presence:leave':
        params.setViewers((current) => current.filter((entry) => entry.userId !== data.userId));
        break;
      case 'crowd:input':
        params.setCrowdInputs((current) => new Map(current).set(data.command as string, Date.now()));
        break;
      case 'chat:message':
        params.setMessages((current) => {
          const nextMessage: ChatMsg = {
            userId: data.userId as string,
            username: data.username as string,
            content: data.content as string,
            timestamp: getEventTimestamp(data.timestamp),
            clientMessageId:
              typeof data.clientMessageId === 'string' ? data.clientMessageId : undefined,
          };

          if (data.historical === true) {
            params.setChatHistoryCursor((cursor) =>
              cursor === null ? nextMessage.timestamp : Math.min(cursor, nextMessage.timestamp),
            );
            params.setChatHistoryHasMore(true);
          }

          return mergeChatMessages(current, [nextMessage]);
        });
        break;
      case 'chat:system':
        params.setMessages((current) =>
          mergeChatMessages(current, [
            {
              userId: 'system',
              username: 'system',
              content: data.message as string,
              timestamp: getEventTimestamp(data.timestamp),
              isSystem: true,
            },
          ]),
        );
        break;
      case 'queue:update':
        params.setQueue(normalizeQueueEntries(data.queue as QueueEntryWire[] | undefined));
        break;
      case 'session:start':
      case 'queue:turn-start': {
        const nextSession = buildActiveSessionState(data);
        if (nextSession) {
          params.setActiveSession(nextSession);
        }
        break;
      }
      case 'session:end':
      case 'queue:turn-end':
        params.setActiveSession((current) => {
          const targetUserId = typeof data.userId === 'string' ? data.userId : null;
          if (targetUserId && current && current.userId !== targetUserId) {
            return current;
          }

          clearLocalControlState({
            currentViewerId: params.currentViewerId,
            targetUserId,
            activeMotionKeysRef: params.activeMotionKeysRef,
            setActiveKeys: params.setActiveKeys,
            setActiveCommands: params.setActiveCommands,
          });

          return null;
        });
        break;
      case 'mod:timeout':
      case 'mod:ban':
        handleRestrictionEvent({
          event,
          data,
          currentViewerId: params.currentViewerId,
          setChatRestriction: params.setChatRestriction,
        });
        break;
      case 'mod:kick': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (!targetUserId || targetUserId !== params.currentViewerId) {
          break;
        }

        params.setChatRestriction(null);
        pushToast('You were removed from control and from the queue.', 'error', 2600);
        break;
      }
      case 'mod:unban': {
        const targetUserId = typeof data.userId === 'string' ? data.userId : null;
        if (!targetUserId || targetUserId !== params.currentViewerId) {
          break;
        }

        params.setChatRestriction(null);
        pushToast('Restriction removed. You can chat again.', 'success', 2200);
        break;
      }
      case 'robot:status': {
        const status =
          typeof data.status === 'string' ? (data.status as RobotPublic['status']) : params.initialRobotStatus;
        params.setRobotStatus(status);
        if (status === 'OFFLINE') {
          params.setLivekitCreds(null);
          params.setVideoState('idle');
          params.setQueue([]);
          params.setActiveSession(null);
          params.setInQueue(false);
        } else if (status === 'ONLINE' || status === 'BUSY') {
          void params.refreshViewerToken(true);
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
          typeof data.message === 'string'
            ? data.message
            : 'Realtime connection is restarting. Reconnecting soon...';

        params.reconnectRetryAfterRef.current = retryAfterMs;
        params.setReconnectNotice({
          message,
          reason,
          retryAt: Date.now() + retryAfterMs,
        });

        const now = Date.now();
        if (now - params.shutdownNoticeAtRef.current > 3000) {
          pushToast(message, 'error', 2500);
          params.shutdownNoticeAtRef.current = now;
        }
        break;
      }
      case 'wallet:insufficient': {
        const required = typeof data.required === 'number' ? data.required : null;
        pushToast(
          required !== null
            ? `Nicht genug Credits für diesen Druck (${required} cr nötig).`
            : 'Nicht genug Credits für diesen Druck.',
          'error',
          3500,
        );
        break;
      }
      case 'wallet:update':
        handleWalletUpdate(data);
        break;
      case 'error': {
        const message =
          typeof data.message === 'string' ? data.message : 'Unknown websocket error';

        if (message === 'Invalid session token') {
          void api.restoreSession().finally(() => {
            api.syncTokenFromStore();
            params.wsRef.current?.close();
          });
          break;
        }

        if (message.includes('restricted')) {
          const restriction =
            (data.restriction as { action?: string; expiresAt?: string | null } | undefined) ?? {};
          const action = restriction.action;
          const text =
            action === 'BAN'
              ? 'You are banned from this room.'
              : action === 'KICK'
                ? 'You were removed from control and from the control queue.'
                : action === 'TIMEOUT'
                  ? 'You are temporarily restricted from chat and control in this room.'
                  : 'You are currently restricted.';
          params.setChatRestriction(text);
          break;
        }

        pushThrottledToast(params.lastErrorToastRef, message, message, {
          cooldownMs: 5000,
          kind: 'error',
        });
        break;
      }
    }
  };
}
