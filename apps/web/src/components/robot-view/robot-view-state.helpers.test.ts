import {
  buildWidgetControlGroups,
  getRoomAccessGateState,
  mergeChatMessages,
} from './robot-view-state.helpers';
import type { ChatMsg, ControlButton } from './types';

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
  });
});
