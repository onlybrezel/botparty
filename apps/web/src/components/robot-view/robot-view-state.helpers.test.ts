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
} from './robot-view-state.helpers';
import type { ChatMsg, ControlButton } from './types';
import { pushToast } from '@/lib/toast';

vi.mock('@/lib/toast', () => ({ pushToast: vi.fn() }));

describe('robot-view state helpers', () => {
  it('deduplicates chat messages by client message id', () => {
    const existing: ChatMsg[] = [
      {
        userId: 'user-1',
        username: 'alpha',
        content: 'hello',
        timestamp: 100,
        clientMessageId: 'msg-1',
      },
    ];

    const incoming: ChatMsg[] = [
      {
        userId: 'user-1',
        username: 'alpha',
        content: 'hello',
        timestamp: 100,
        clientMessageId: 'msg-1',
      },
      {
        userId: 'user-2',
        username: 'beta',
        content: 'hi',
        timestamp: 200,
      },
    ];

    expect(mergeChatMessages(existing, incoming)).toEqual([
      existing[0],
      incoming[1],
    ]);
  });

  it('deduplicates fallback chat keys, merges updates, sorts, and bounds the buffer', () => {
    const messages = Array.from({ length: 505 }, (_, index) => ({
      userId: `user-${index}`,
      username: `user-${index}`,
      content: `message-${index}`,
      timestamp: 505 - index,
    }));
    const firstMessage = messages[0];
    if (!firstMessage) throw new Error('Expected generated chat messages');
    const duplicate = { ...firstMessage, username: 'updated' };
    const merged = mergeChatMessages(messages, [duplicate]);
    expect(merged).toHaveLength(500);
    expect(merged.map((entry) => entry.timestamp)).toEqual(
      [...merged].map((entry) => entry.timestamp).sort((left, right) => left - right),
    );
    expect(merged.find((entry) => entry.userId === duplicate.userId)?.username).toBe('updated');
  });

  it('maps errors, online states, and queue positions', () => {
    expect(getErrorMessage(new Error('specific'), 'fallback')).toBe('specific');
    expect(getErrorMessage('bad', 'fallback')).toBe('fallback');
    expect(isRobotOnline('ONLINE')).toBe(true);
    expect(isRobotOnline('BUSY')).toBe(true);
    expect(isRobotOnline('OFFLINE')).toBe(false);
    expect(
      getQueuePosition(
        [
          { userId: 'one', username: 'One', position: 1 },
          { userId: 'two', username: 'Two', position: 2 },
        ],
        'two',
      ),
    ).toBe(2);
    expect(getQueuePosition([], 'missing')).toBe(0);
  });

  it('loads only valid, recent chat storage and tolerates malformed or unavailable storage', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.clear();
    expect(loadStoredChatMessages('robot')).toEqual([]);
    localStorage.setItem('botparty.chat.robot', '{}');
    expect(loadStoredChatMessages('robot')).toEqual([]);
    localStorage.setItem('botparty.chat.robot', '[]');
    expect(loadStoredChatMessages('robot')).toEqual([]);
    localStorage.setItem('botparty.chat.robot', JSON.stringify([null]));
    expect(loadStoredChatMessages('robot')).toEqual([]);
    localStorage.setItem(
      'botparty.chat.robot',
      JSON.stringify([{ userId: 'old', username: 'Old', content: 'old', timestamp: 0 }]),
    );
    expect(loadStoredChatMessages('robot')).toEqual([]);
    const recent = { userId: 'new', username: 'New', content: 'new', timestamp: now - 1000 };
    localStorage.setItem('botparty.chat.robot', JSON.stringify([recent]));
    expect(loadStoredChatMessages('robot')).toEqual([recent]);
    localStorage.setItem('botparty.chat.robot', '{');
    expect(loadStoredChatMessages('robot')).toEqual([]);
  });

  it('saves chat and room access storage while tolerating storage failures and SSR', () => {
    localStorage.clear();
    sessionStorage.clear();
    const messages: ChatMsg[] = [
      { userId: 'one', username: 'One', content: 'hello', timestamp: 1 },
    ];
    saveStoredChatMessages('robot', messages);
    expect(localStorage.getItem('botparty.chat.robot')).toBe(JSON.stringify(messages));
    expect(loadStoredRoomAccessToken('robot')).toBeNull();
    saveStoredRoomAccessToken('robot', 'grant');
    expect(loadStoredRoomAccessToken('robot')).toBe('grant');

    const localSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(() => saveStoredChatMessages('full', messages)).not.toThrow();
    localSet.mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(() => saveStoredRoomAccessToken('blocked', 'grant')).not.toThrow();
    const sessionGet = vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(loadStoredRoomAccessToken('blocked')).toBeNull();
    sessionGet.mockRestore();
    localSet.mockRestore();

    vi.stubGlobal('window', undefined);
    expect(loadStoredChatMessages('robot')).toEqual([]);
    expect(loadStoredRoomAccessToken('robot')).toBeNull();
    expect(() => saveStoredChatMessages('robot', messages)).not.toThrow();
    expect(() => saveStoredRoomAccessToken('robot', 'grant')).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('groups non-wasd controls into plain, slider, and xy widgets', () => {
    const controls: ControlButton[] = [
      {
        id: 'forward',
        label: 'Forward',
        command: 'forward',
        hotKey: 'w',
        icon: null,
        cooldownMs: 100,
        costCredits: 0,
        access: 'QUEUE_TURN',
        position: 1,
        color: null,
      },
      {
        id: 'plain',
        label: 'Light',
        command: 'light',
        hotKey: 'l',
        icon: null,
        cooldownMs: 100,
        costCredits: 0,
        access: 'EVERYONE',
        position: 2,
        color: null,
      },
      {
        id: 'slider',
        label: 'Speed',
        command: 'speed',
        hotKey: null,
        icon: 'widget:slider:min=0:max=100:start=50',
        cooldownMs: 100,
        costCredits: 0,
        access: 'QUEUE_TURN',
        position: 3,
        color: null,
      },
      {
        id: 'xy',
        label: 'Arm',
        command: 'arm',
        hotKey: null,
        icon: 'widget:xy:xmin=-1:xmax=1:ymin=-1:ymax=1',
        cooldownMs: 100,
        costCredits: 0,
        access: 'QUEUE_TURN',
        position: 4,
        color: null,
      },
    ];

    const groups = buildWidgetControlGroups(controls);

    expect(groups.extraButtonControls.map((entry) => entry.id)).toEqual(['plain']);
    expect(groups.sliderControls.map((entry) => entry.button.id)).toEqual(['slider']);
    expect(groups.xyControls.map((entry) => entry.button.id)).toEqual(['xy']);
  });

  it('blocks guest viewer token refresh when the room gate still needs auth', () => {
    expect(
      getRoomAccessGateState({
        accessMode: 'ALLOWED_USERS',
        accessToken: null,
        roomAccessToken: null,
        guestVideoAllowed: false,
      }).shouldBlockViewerToken,
    ).toBe(true);

    expect(
      getRoomAccessGateState({
        accessMode: 'PASSWORD',
        accessToken: null,
        roomAccessToken: null,
        guestVideoAllowed: true,
      }).shouldBlockViewerToken,
    ).toBe(false);

    expect(
      getRoomAccessGateState({
        accessMode: 'LINK_ONLY',
        accessToken: 'access',
        roomAccessToken: null,
        guestVideoAllowed: true,
      }),
    ).toEqual({
      passwordGateMissing: false,
      allowlistGateMissing: false,
      linkGateMissing: true,
      shouldBlockViewerToken: true,
    });
    expect(
      getRoomAccessGateState({
        accessMode: 'OPEN',
        accessToken: null,
        roomAccessToken: null,
        guestVideoAllowed: false,
      }).shouldBlockViewerToken,
    ).toBe(false);
  });

  it('throttles repeated toast keys within the configured interval', () => {
    const ref = { current: null as { key: string; timestamp: number } | null };
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1200).mockReturnValueOnce(1300).mockReturnValueOnce(2500);
    expect(
      pushThrottledToast(ref, 'offline', 'Offline', {
        cooldownMs: 1000,
        kind: 'error',
        durationMs: 2000,
      }),
    ).toBe(true);
    expect(pushThrottledToast(ref, 'offline', 'Offline', { cooldownMs: 1000 })).toBe(false);
    expect(pushThrottledToast(ref, 'other', 'Other', { cooldownMs: 1000 })).toBe(true);
    expect(pushThrottledToast(ref, 'other', 'Other again', { cooldownMs: 1000 })).toBe(true);
    expect(pushToast).toHaveBeenCalledTimes(3);
  });
});
