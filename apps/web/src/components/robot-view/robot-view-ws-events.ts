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
  hasLivekitCreds: () => boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isViewer(value: unknown): value is Viewer {
  return isRecord(value)
    && typeof value['userId'] === 'string'
    && typeof value['username'] === 'string'
    && typeof value['joinedAt'] === 'number';
}

function isQueueEntryWire(value: unknown): value is QueueEntryWire {
  if (!isRecord(value) || typeof value['userId'] !== 'string' || typeof value['position'] !== 'number') {
    return false;
  }
  return value['username'] === undefined || typeof value['username'] === 'string';
}

function isRobotStatus(value: unknown): value is RobotPublic['status'] {
  return value === 'ONLINE' || value === 'OFFLINE' || value === 'BUSY' || value === 'MAINTENANCE';
}

function buildActiveSessionState(data: Record<string, unknown>) {
  const userId = typeof data['userId'] === 'string' ? data['userId'] : null;
  if (!userId) {
    return null;
  }

  const expiresAtValue =
    typeof data['expiresAt'] === 'number'
      ? data['expiresAt']
      : typeof data['expiresAt'] === 'string'
        ? Date.parse(data['expiresAt'])
        : null;

  return {
    sessionId: typeof data['sessionId'] === 'string' ? data['sessionId'] : `session-${userId}`,
    userId,
    username: typeof data['username'] === 'string' ? data['username'] : userId.slice(0, 8),
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
  const targetUserId = typeof data['userId'] === 'string' ? data['userId'] : null;

  if (!targetUserId || targetUserId !== currentViewerId) {
    return;
  }

  const action = event === 'mod:ban' ? 'BAN' : 'TIMEOUT';
  const expiresAt =
    typeof data['expiresAt'] === 'string' && data['expiresAt'].length > 0 ? data['expiresAt'] : null;
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
  const balance = typeof data['balance'] === 'number' ? data['balance'] : null;

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
        params.setViewers(Array.isArray(data['viewers']) ? data['viewers'].filter(isViewer) : []);
        break;
      case 'presence:join': {
        if (typeof data['userId'] !== 'string' || typeof data['username'] !== 'string') break;
        const userId = data['userId'];
        const username = data['username'];
        params.setViewers((current) => {
          if (current.some((entry) => entry.userId === userId)) {
            return current;
          }

          return [
            ...current,
            {
              userId,
              username,
              joinedAt: Date.now(),
            },
          ];
        });
        break;
      }
      case 'presence:leave':
        params.setViewers((current) => current.filter((entry) => entry.userId !== data['userId']));
        break;
      case 'crowd:input': {
        if (typeof data['command'] === 'string') {
          const command = data['command'];
          params.setCrowdInputs((current) => new Map(current).set(command, Date.now()));
        }
        break;
      }
      case 'chat:message': {
        if (
          typeof data['userId'] !== 'string'
          || typeof data['username'] !== 'string'
          || typeof data['content'] !== 'string'
        ) break;
        const userId = data['userId'];
        const username = data['username'];
        const content = data['content'];
        params.setMessages((current) => {
          const nextMessage: ChatMsg = {
            userId,
            username,
            content,
            timestamp: getEventTimestamp(data['timestamp']),
            ...(typeof data['clientMessageId'] === 'string'
              ? { clientMessageId: data['clientMessageId'] }
              : {}),
          };

          if (data['historical'] === true) {
            params.setChatHistoryCursor((cursor) =>
              cursor === null ? nextMessage.timestamp : Math.min(cursor, nextMessage.timestamp),
            );
            params.setChatHistoryHasMore(true);
          }

          return mergeChatMessages(current, [nextMessage]);
        });
        break;
      }
      case 'chat:system': {
        if (typeof data['message'] !== 'string') break;
        const message = data['message'];
        params.setMessages((current) =>
          mergeChatMessages(current, [
            {
              userId: 'system',
              username: 'system',
              content: message,
              timestamp: getEventTimestamp(data['timestamp']),
              isSystem: true,
            },
          ]),
        );
        break;
      }
      case 'queue:update':
        params.setQueue(
          normalizeQueueEntries(Array.isArray(data['queue']) ? data['queue'].filter(isQueueEntryWire) : undefined),
        );
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
          const targetUserId = typeof data['userId'] === 'string' ? data['userId'] : null;
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
        const targetUserId = typeof data['userId'] === 'string' ? data['userId'] : null;
        if (!targetUserId || targetUserId !== params.currentViewerId) {
          break;
        }

        params.setChatRestriction(null);
        pushToast('You were removed from control and from the queue.', 'error', 2600);
        break;
      }
      case 'mod:unban': {
        const targetUserId = typeof data['userId'] === 'string' ? data['userId'] : null;
        if (!targetUserId || targetUserId !== params.currentViewerId) {
          break;
        }

        params.setChatRestriction(null);
        pushToast('Restriction removed. You can chat again.', 'success', 2200);
        break;
      }
      case 'robot:status': {
        const status = isRobotStatus(data['status']) ? data['status'] : params.initialRobotStatus;
        params.setRobotStatus(status);
        if (status === 'OFFLINE') {
          params.setLivekitCreds(null);
          params.setVideoState('idle');
          params.setQueue([]);
          params.setActiveSession(null);
          params.setInQueue(false);
        } else if ((status === 'ONLINE' || status === 'BUSY') && !params.hasLivekitCreds()) {
          void params.refreshViewerToken(true);
        }
        break;
      }
      case 'server:shutdown': {
        const retryAfterMs =
          typeof data['retryAfterMs'] === 'number' && Number.isFinite(data['retryAfterMs'])
            ? Math.max(1000, data['retryAfterMs'])
            : 12000;
        const reason = typeof data['reason'] === 'string' ? data['reason'] : 'restart';
        const message =
          typeof data['message'] === 'string'
            ? data['message']
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
        const required = typeof data['required'] === 'number' ? data['required'] : null;
        pushToast(
          required !== null
            ? `Not enough credits for this press (${required} cr needed).`
            : 'Not enough credits for this press.',
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
          typeof data['message'] === 'string' ? data['message'] : 'Unknown websocket error';

        if (message === 'Invalid session token') {
          void api.restoreSession().finally(() => {
            api.syncTokenFromStore();
            params.wsRef.current?.close();
          });
          break;
        }

        if (message.includes('restricted')) {
          const restriction = data['restriction'];
          const action = isRecord(restriction) && typeof restriction['action'] === 'string'
            ? restriction['action']
            : undefined;
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
