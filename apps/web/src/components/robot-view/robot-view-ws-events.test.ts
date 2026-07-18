import { createRobotWsEventHandler } from './robot-view-ws-events';
import { api } from '@/lib/api';
import { pushToast } from '@/lib/toast';
import { RobotStatus } from '@botparty/shared';

vi.mock('@/lib/api', () => ({
  api: {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    syncTokenFromStore: vi.fn(),
  },
}));

vi.mock('@/lib/toast', () => ({
  pushToast: vi.fn(),
}));

function stateSetter<T>(initial: T) {
  let value = initial;
  const set = vi.fn((next: T | ((current: T) => T)) => {
    value = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
  });
  return { set, get: () => value };
}

function buildHandler() {
  const viewers = stateSetter<any[]>([]);
  const crowdInputs = stateSetter(new Map<string, number>());
  const messages = stateSetter<any[]>([]);
  const chatHistoryCursor = stateSetter<number | null>(null);
  const chatHistoryHasMore = stateSetter(false);
  const queue = stateSetter<any[]>([]);
  const activeSession = stateSetter<any>(null);
  const activeKeys = stateSetter(new Set<string>());
  const activeCommands = stateSetter(new Set<string>());
  const chatRestriction = stateSetter<string | null>(null);
  const robotStatus = stateSetter(RobotStatus.ONLINE);
  const livekitCreds = stateSetter<any>({ token: 'token', url: 'url' });
  const videoState = stateSetter<any>('ready');
  const inQueue = stateSetter(true);
  const reconnectNotice = stateSetter<any>(null);
  const ws = { close: vi.fn() };
  const refreshViewerToken = vi.fn().mockResolvedValue(undefined);
  const activeMotionKeysRef = { current: new Set(['w']) };
  const reconnectRetryAfterRef = { current: null as number | null };
  const shutdownNoticeAtRef = { current: 0 };
  const lastErrorToastRef = { current: null };
  let hasLivekitCreds = true;

  const handler = createRobotWsEventHandler({
    currentViewerId: 'user-1',
    initialRobotStatus: RobotStatus.ONLINE,
    refreshViewerToken,
    hasLivekitCreds: () => hasLivekitCreds,
    wsRef: { current: ws as never },
    activeMotionKeysRef,
    reconnectRetryAfterRef,
    shutdownNoticeAtRef,
    lastErrorToastRef,
    setViewers: viewers.set,
    setCrowdInputs: crowdInputs.set,
    setMessages: messages.set,
    setChatHistoryCursor: chatHistoryCursor.set,
    setChatHistoryHasMore: chatHistoryHasMore.set,
    setQueue: queue.set,
    setActiveSession: activeSession.set,
    setActiveKeys: activeKeys.set,
    setActiveCommands: activeCommands.set,
    setChatRestriction: chatRestriction.set,
    setRobotStatus: robotStatus.set,
    setLivekitCreds: livekitCreds.set,
    setVideoState: videoState.set,
    setInQueue: inQueue.set,
    setReconnectNotice: reconnectNotice.set,
  });

  return {
    handler,
    states: {
      viewers,
      crowdInputs,
      messages,
      chatHistoryCursor,
      chatHistoryHasMore,
      queue,
      activeSession,
      activeKeys,
      activeCommands,
      chatRestriction,
      robotStatus,
      livekitCreds,
      videoState,
      inQueue,
      reconnectNotice,
    },
    ws,
    refreshViewerToken,
    activeMotionKeysRef,
    reconnectRetryAfterRef,
    shutdownNoticeAtRef,
    setHasLivekitCreds: (value: boolean) => {
      hasLivekitCreds = value;
    },
  };
}

describe('createRobotWsEventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.restoreSession).mockResolvedValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maintains presence and crowd-input state without duplicate viewers', () => {
    const { handler, states } = buildHandler();
    handler('presence:update', { viewers: [{ userId: 'existing' }] });
    expect(states.viewers.get()).toEqual([{ userId: 'existing' }]);
    handler('presence:join', { userId: 'existing', username: 'Existing' });
    expect(states.viewers.get()).toHaveLength(1);
    handler('presence:join', { userId: 'new', username: 'New' });
    expect(states.viewers.get()).toHaveLength(2);
    handler('presence:leave', { userId: 'existing' });
    expect(states.viewers.get()).toEqual([
      { userId: 'new', username: 'New', joinedAt: 1_700_000_000_000 },
    ]);
    handler('crowd:input', { command: 'forward' });
    expect(states.crowdInputs.get().get('forward')).toBe(1_700_000_000_000);
  });

  it('merges live, historical, and system chat messages', () => {
    const { handler, states } = buildHandler();
    handler('chat:message', {
      userId: 'user-2',
      username: 'Bob',
      content: 'older',
      timestamp: 100,
      clientMessageId: 'message-1',
      historical: true,
    });
    handler('chat:message', {
      userId: 'user-2',
      username: 'Bob',
      content: 'oldest',
      timestamp: 50,
      historical: true,
    });
    handler('chat:message', {
      userId: 'user-3',
      username: 'Eve',
      content: 'now',
      timestamp: 'invalid',
    });
    handler('chat:system', { message: 'Ready', timestamp: Number.NaN });

    expect(states.messages.get()).toHaveLength(4);
    expect(states.chatHistoryCursor.get()).toBe(50);
    expect(states.chatHistoryHasMore.get()).toBe(true);
    expect(states.messages.get().at(-1)).toEqual(
      expect.objectContaining({ userId: 'system', isSystem: true }),
    );
  });

  it('normalizes queue state and builds sessions from numeric, string, and fallback values', () => {
    const { handler, states } = buildHandler();
    handler('queue:update', { queue: [{ userId: 'user-2', position: 2 }] });
    expect(states.queue.get()).toHaveLength(1);
    handler('queue:update', {});
    expect(states.queue.get()).toEqual([]);

    handler('session:start', {
      sessionId: 'session-1',
      userId: 'user-1',
      username: 'Alice',
      expiresAt: 1_700_000_010_000,
    });
    expect(states.activeSession.get()).toEqual(
      expect.objectContaining({ sessionId: 'session-1', expiresAt: 1_700_000_010_000 }),
    );
    handler('queue:turn-start', {
      userId: 'abcdefghijk',
      expiresAt: '2026-07-17T16:00:00.000Z',
    });
    expect(states.activeSession.get()).toEqual(
      expect.objectContaining({ sessionId: 'session-abcdefghijk', username: 'abcdefgh' }),
    );
    handler('session:start', { expiresAt: 'invalid' });
    expect(states.activeSession.get()?.userId).toBe('abcdefghijk');
  });

  it('ends only the targeted session and clears local motion for the current viewer', () => {
    const { handler, states, activeMotionKeysRef } = buildHandler();
    states.activeSession.set({ userId: 'user-1' });
    states.activeKeys.set(new Set(['w']));
    states.activeCommands.set(new Set(['forward']));

    handler('session:end', { userId: 'other-user' });
    expect(states.activeSession.get()).toEqual({ userId: 'user-1' });
    handler('queue:turn-end', { userId: 'user-1' });
    expect(states.activeSession.get()).toBeNull();
    expect(states.activeKeys.get().size).toBe(0);
    expect(states.activeCommands.get().size).toBe(0);
    expect(activeMotionKeysRef.current.size).toBe(0);

    states.activeSession.set({ userId: 'other-user' });
    handler('session:end', {});
    expect(states.activeSession.get()).toBeNull();
  });

  it('applies only moderation events targeting the current viewer', () => {
    const { handler, states } = buildHandler();
    handler('mod:timeout', { userId: 'other-user' });
    expect(states.chatRestriction.get()).toBeNull();
    handler('mod:timeout', {
      userId: 'user-1',
      expiresAt: '2026-07-17T17:00:00.000Z',
    });
    expect(states.chatRestriction.get()).toContain('temporarily restricted');
    handler('mod:ban', { userId: 'user-1' });
    expect(states.chatRestriction.get()).toContain('banned');
    handler('mod:kick', { userId: 'other-user' });
    handler('mod:kick', { userId: 'user-1' });
    expect(states.chatRestriction.get()).toBeNull();
    handler('mod:unban', { userId: 'other-user' });
    handler('mod:unban', { userId: 'user-1' });
    expect(pushToast).toHaveBeenCalledWith(
      'Restriction removed. You can chat again.',
      'success',
      2200,
    );
  });

  it('clears live state offline and refreshes video only when online credentials are absent', () => {
    const { handler, states, refreshViewerToken, setHasLivekitCreds } = buildHandler();
    states.queue.set([{ userId: 'user-1' }]);
    states.activeSession.set({ userId: 'user-1' });
    handler('robot:status', { status: 'OFFLINE' });
    expect(states.robotStatus.get()).toBe('OFFLINE');
    expect(states.livekitCreds.get()).toBeNull();
    expect(states.videoState.get()).toBe('idle');
    expect(states.queue.get()).toEqual([]);
    expect(states.activeSession.get()).toBeNull();
    expect(states.inQueue.get()).toBe(false);

    handler('robot:status', { status: 'ONLINE' });
    expect(refreshViewerToken).not.toHaveBeenCalled();
    setHasLivekitCreds(false);
    handler('robot:status', { status: 'BUSY' });
    expect(refreshViewerToken).toHaveBeenCalledWith(true);
    handler('robot:status', {});
    expect(states.robotStatus.get()).toBe('ONLINE');
  });

  it('uses bounded shutdown retry metadata and throttles repeated notices', () => {
    const { handler, states, reconnectRetryAfterRef, shutdownNoticeAtRef } = buildHandler();
    handler('server:shutdown', { retryAfterMs: 20, reason: 'deploy', message: 'Restarting' });
    expect(reconnectRetryAfterRef.current).toBe(1000);
    expect(states.reconnectNotice.get()).toEqual({
      message: 'Restarting',
      reason: 'deploy',
      retryAt: 1_700_000_001_000,
    });
    expect(pushToast).toHaveBeenCalledTimes(1);
    handler('server:shutdown', { retryAfterMs: Number.NaN });
    expect(reconnectRetryAfterRef.current).toBe(12000);
    expect(states.reconnectNotice.get()).toEqual(
      expect.objectContaining({ reason: 'restart', retryAt: 1_700_000_012_000 }),
    );
    expect(pushToast).toHaveBeenCalledTimes(1);
    shutdownNoticeAtRef.current = 1_699_999_990_000;
    handler('server:shutdown', {});
    expect(pushToast).toHaveBeenCalledTimes(2);
  });

  it('publishes wallet balance updates and handles insufficient-credit messages', () => {
    const { handler } = buildHandler();
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    handler('wallet:update', { balance: 'invalid' });
    expect(dispatch).not.toHaveBeenCalled();
    handler('wallet:update', { balance: 42 });
    expect(dispatch).toHaveBeenCalledWith(expect.any(CustomEvent));
    expect((dispatch.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ balance: 42 });
    handler('wallet:insufficient', { required: 5 });
    handler('wallet:insufficient', {});
    expect(pushToast).toHaveBeenCalledWith(
      'Not enough credits for this press (5 cr needed).',
      'error',
      3500,
    );
    expect(pushToast).toHaveBeenCalledWith('Not enough credits for this press.', 'error', 3500);
  });

  it('restores invalid sessions and maps all restriction error variants', async () => {
    const { handler, states, ws } = buildHandler();
    handler('error', { message: 'Invalid session token' });
    await vi.waitFor(() => expect(api.syncTokenFromStore).toHaveBeenCalled());
    expect(ws.close).toHaveBeenCalled();

    handler('error', { message: 'restricted', restriction: { action: 'BAN' } });
    expect(states.chatRestriction.get()).toContain('banned');
    handler('error', { message: 'restricted', restriction: { action: 'KICK' } });
    expect(states.chatRestriction.get()).toContain('removed');
    handler('error', { message: 'restricted', restriction: { action: 'TIMEOUT' } });
    expect(states.chatRestriction.get()).toContain('temporarily');
    handler('error', { message: 'restricted' });
    expect(states.chatRestriction.get()).toContain('currently restricted');
  });

  it('throttles ordinary websocket errors, including malformed messages', () => {
    const { handler } = buildHandler();
    handler('error', { message: 'robot offline' });
    handler('error', {});
    expect(pushToast).toHaveBeenCalledWith('robot offline', 'error', undefined);
    expect(pushToast).toHaveBeenCalledWith('Unknown websocket error', 'error', undefined);
    handler('unknown:event', {});
  });
});
