import type { MutableRefObject } from 'react';
import type { ToastKind } from '@/lib/toast';
import { pushToast } from '@/lib/toast';
import {
  parseWidgetConfig,
  type ChatMsg,
  type ControlButton,
  type QueueEntry,
  type SliderWidgetConfig,
  type XYWidgetConfig,
} from './types';

const MAX_CHAT_BUFFER = 500;
const CHAT_STORAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_STORAGE_PREFIX = 'botparty.chat.';
const ROOM_ACCESS_STORAGE_PREFIX = 'botparty.room-access.';

export type ToastThrottleState = {
  key: string;
  timestamp: number;
};

export type WidgetControlGroups = {
  extraButtonControls: ControlButton[];
  sliderControls: Array<{ button: ControlButton; widget: SliderWidgetConfig }>;
  xyControls: Array<{ button: ControlButton; widget: XYWidgetConfig }>;
};

function getChatStorageKey(robotId: string) {
  return `${CHAT_STORAGE_PREFIX}${robotId}`;
}

function getRoomAccessStorageKey(robotId: string) {
  return `${ROOM_ACCESS_STORAGE_PREFIX}${robotId}`;
}

function chatMessageKey(message: ChatMsg): string {
  return message.clientMessageId
    ? `client:${message.clientMessageId}`
    : `msg:${message.userId}:${message.timestamp}:${message.content}`;
}

export function mergeChatMessages(existing: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const merged = new Map<string, ChatMsg>();

  for (const message of [...existing, ...incoming]) {
    const key = chatMessageKey(message);
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, ...message } : message);
  }

  return [...merged.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-MAX_CHAT_BUFFER);
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function isRobotOnline(status: string) {
  return status === 'ONLINE' || status === 'BUSY';
}

export function getQueuePosition(queue: QueueEntry[], currentViewerId: string) {
  return queue.findIndex((entry) => entry.userId === currentViewerId) + 1;
}

export function loadStoredChatMessages(robotId: string): ChatMsg[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getChatStorageKey(robotId));
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }

    const oldest = parsed[0];
    if (
      !oldest ||
      typeof oldest !== 'object' ||
      typeof oldest.timestamp !== 'number' ||
      Date.now() - oldest.timestamp >= CHAT_STORAGE_MAX_AGE_MS
    ) {
      return [];
    }

    const messages = parsed.filter((entry): entry is ChatMsg =>
      typeof entry === 'object'
      && entry !== null
      && typeof entry.userId === 'string'
      && typeof entry.username === 'string'
      && typeof entry.content === 'string'
      && typeof entry.timestamp === 'number',
    );
    return mergeChatMessages([], messages);
  } catch {
    return [];
  }
}

export function saveStoredChatMessages(robotId: string, messages: ChatMsg[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(getChatStorageKey(robotId), JSON.stringify(messages));
  } catch {
    // Ignore storage quota errors and privacy-mode storage failures.
  }
}

export function loadStoredRoomAccessToken(robotId: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage.getItem(getRoomAccessStorageKey(robotId));
  } catch {
    return null;
  }
}

export function saveStoredRoomAccessToken(robotId: string, token: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(getRoomAccessStorageKey(robotId), token);
  } catch {
    // Ignore storage failures and keep the in-memory token.
  }
}

export function getRoomAccessGateState(params: {
  accessMode: 'OPEN' | 'PASSWORD' | 'ALLOWED_USERS' | 'LINK_ONLY';
  accessToken: string | null;
  roomAccessToken: string | null;
  guestVideoAllowed: boolean;
}) {
  const { accessMode, accessToken, roomAccessToken, guestVideoAllowed } = params;
  const passwordGateMissing = accessMode === 'PASSWORD' && !roomAccessToken;
  const allowlistGateMissing =
    accessMode === 'ALLOWED_USERS' && !roomAccessToken && !accessToken;
  const linkGateMissing = accessMode === 'LINK_ONLY' && !roomAccessToken;
  const shouldBlockViewerToken =
    linkGateMissing || ((passwordGateMissing || allowlistGateMissing) && !guestVideoAllowed);

  return {
    passwordGateMissing,
    allowlistGateMissing,
    linkGateMissing,
    shouldBlockViewerToken,
  };
}

export function buildWidgetControlGroups(controlButtons: ControlButton[]): WidgetControlGroups {
  const extraButtonControls: ControlButton[] = [];
  const sliderControls: Array<{ button: ControlButton; widget: SliderWidgetConfig }> = [];
  const xyControls: Array<{ button: ControlButton; widget: XYWidgetConfig }> = [];

  for (const button of controlButtons) {
    const hotKey = (button.hotKey ?? '').toLowerCase();
    if (['w', 'a', 's', 'd'].includes(hotKey)) {
      continue;
    }

    const widget = parseWidgetConfig(button.icon ?? null);
    if (!widget) {
      extraButtonControls.push(button);
      continue;
    }

    if (widget.kind === 'slider') {
      sliderControls.push({ button, widget });
      continue;
    }

    xyControls.push({ button, widget });
  }

  return {
    extraButtonControls,
    sliderControls,
    xyControls,
  };
}

export function pushThrottledToast(
  lastToastRef: MutableRefObject<ToastThrottleState | null>,
  key: string,
  message: string,
  options: {
    cooldownMs: number;
    kind?: ToastKind;
    durationMs?: number;
  },
) {
  const now = Date.now();
  const lastToast = lastToastRef.current;

  if (lastToast && lastToast.key === key && now - lastToast.timestamp < options.cooldownMs) {
    return false;
  }

  pushToast(message, options.kind, options.durationMs);
  lastToastRef.current = {
    key,
    timestamp: now,
  };
  return true;
}
