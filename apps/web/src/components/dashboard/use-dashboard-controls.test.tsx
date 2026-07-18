import { act, renderHook, waitFor } from '@testing-library/react';
import { ControlButtonAccess } from '@botparty/shared';
import { useDashboardControls } from './use-dashboard-controls';
import { DEFAULT_CONTROL_DRAFT, type ControlButtonDraft } from './types';
import { pushToast } from '@/lib/toast';

const mockApi = vi.hoisted(() => ({
  setToken: vi.fn(),
  getAllControls: vi.fn(),
  createControl: vi.fn(),
  updateControl: vi.fn(),
  deleteControl: vi.fn(),
  reorderControls: vi.fn(),
  getAllowedUsers: vi.fn(),
  addAllowedUser: vi.fn(),
  removeAllowedUser: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    setToken: mockApi.setToken,
    controls: {
      getAllControls: mockApi.getAllControls,
      createControl: mockApi.createControl,
      updateControl: mockApi.updateControl,
      deleteControl: mockApi.deleteControl,
      reorderControls: mockApi.reorderControls,
    },
    robots: {
      getAllowedUsers: mockApi.getAllowedUsers,
      addAllowedUser: mockApi.addAllowedUser,
      removeAllowedUser: mockApi.removeAllowedUser,
    },
  },
}));

vi.mock('@/lib/toast', () => ({ pushToast: vi.fn() }));

const firstButton = {
  id: 'first',
  label: 'Forward',
  command: 'forward',
  hotKey: 'w',
  icon: null,
  cooldownMs: 200,
  costCredits: 0,
  access: ControlButtonAccess.QUEUE_TURN,
  position: 0,
  color: null,
  isEnabled: true,
};

const secondButton = {
  ...firstButton,
  id: 'second',
  label: 'Horn',
  command: 'horn',
  hotKey: 'h',
  access: ControlButtonAccess.EVERYONE,
  position: 1,
};

const firstAllowedUser = {
  id: 'user-1',
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  addedAt: '2026-07-17T12:00:00.000Z',
};

const secondAllowedUser = {
  id: 'user-2',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  addedAt: '2026-07-17T12:00:00.000Z',
};

function buildProps(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'access-token' as string | null,
    selectedRobotId: 'robot-1' as string | null,
    roomMode: 'ALLOWED_USERS' as const,
    controlDraft: {
      ...DEFAULT_CONTROL_DRAFT,
      label: ' Light ',
      command: ' light ',
      hotKey: ' l ',
      color: ' #fff ',
      cooldownMs: '250',
      costCredits: '-5',
    },
    resetControlDraft: vi.fn(),
    editingControlId: null as string | null,
    setEditingControlId: vi.fn(),
    controlEditDraft: null as ControlButtonDraft | null,
    setControlEditDraft: vi.fn(),
    clearControlEditDraft: vi.fn(),
    setControlEditPreset: vi.fn(),
    allowlistUsername: ' alice ',
    resetAllowlistUsername: vi.fn(),
    setError: vi.fn(),
    ...overrides,
  };
}

describe('useDashboardControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAllControls.mockResolvedValue([secondButton, firstButton]);
    mockApi.createControl.mockResolvedValue({ ...secondButton, id: 'created', position: 2 });
    mockApi.updateControl.mockImplementation((id, input) =>
      Promise.resolve({ ...(id === 'first' ? firstButton : secondButton), ...input, id }),
    );
    mockApi.deleteControl.mockResolvedValue(undefined);
    mockApi.reorderControls.mockResolvedValue(undefined);
    mockApi.getAllowedUsers.mockResolvedValue([firstAllowedUser]);
    mockApi.addAllowedUser.mockResolvedValue(secondAllowedUser);
    mockApi.removeAllowedUser.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and sorts controls plus allow-list users, then clears state when context disappears', async () => {
    const props = buildProps();
    const { result, rerender } = renderHook((current) => useDashboardControls(current), {
      initialProps: props,
    });
    await waitFor(() => expect(result.current.controlsLoading).toBe(false));
    expect(result.current.controlButtons.map((button) => button.id)).toEqual(['first', 'second']);
    expect(result.current.allowedUsers).toEqual([firstAllowedUser]);
    expect(mockApi.setToken).toHaveBeenCalledWith('access-token');

    rerender(buildProps({ accessToken: null, selectedRobotId: null, roomMode: 'PRIVATE' }));
    await waitFor(() => expect(result.current.controlButtons).toEqual([]));
    expect(result.current.allowedUsers).toEqual([]);
  });

  it('settles loading with empty state when control and allow-list reads fail', async () => {
    mockApi.getAllControls.mockRejectedValueOnce(new Error('controls offline'));
    mockApi.getAllowedUsers.mockRejectedValueOnce(new Error('allow-list offline'));
    const { result } = renderHook(() => useDashboardControls(buildProps()));
    await waitFor(() => expect(result.current.controlsLoading).toBe(false));
    await waitFor(() => expect(result.current.allowlistLoading).toBe(false));
    expect(result.current.controlButtons).toEqual([]);
    expect(result.current.allowedUsers).toEqual([]);
  });

  it('handles successful and invalid control creation with normalized values', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.controlsLoading).toBe(false));
    await act(() => result.current.handleCreateControl());
    expect(mockApi.createControl).toHaveBeenCalledWith(
      'robot-1',
      expect.objectContaining({
        label: 'Light',
        command: 'light',
        hotKey: 'l',
        cooldownMs: 250,
        costCredits: 0,
        color: '#fff',
      }),
    );
    expect(result.current.controlButtons.at(-1)?.id).toBe('created');
    expect(props.resetControlDraft).toHaveBeenCalled();

    const minimalProps = buildProps({
      controlDraft: {
        ...DEFAULT_CONTROL_DRAFT,
        label: 'Stop',
        command: 'stop',
        hotKey: '',
        costCredits: 'invalid',
        color: '',
      },
    });
    const minimal = renderHook(() => useDashboardControls(minimalProps));
    await act(() => minimal.result.current.handleCreateControl());
    expect(mockApi.createControl).toHaveBeenLastCalledWith(
      'robot-1',
      expect.objectContaining({ hotKey: undefined, costCredits: 0, color: undefined }),
    );

    const invalidProps = buildProps({
      controlDraft: { ...DEFAULT_CONTROL_DRAFT, label: ' ', command: '' },
    });
    const invalid = renderHook(() => useDashboardControls(invalidProps));
    await act(() => invalid.result.current.handleCreateControl());
    expect(pushToast).toHaveBeenCalledWith(
      'Label and command are required for a control button.',
      'error',
      2600,
    );
  });

  it('reports typed and untyped create failures and clears the busy state', async () => {
    const props = buildProps();
    mockApi.createControl.mockRejectedValueOnce(new Error('create denied'));
    const { result } = renderHook(() => useDashboardControls(props));
    await act(() => result.current.handleCreateControl());
    expect(props.setError).toHaveBeenCalledWith('create denied');
    expect(result.current.creatingControl).toBe(false);

    mockApi.createControl.mockRejectedValueOnce('offline');
    await act(() => result.current.handleCreateControl());
    expect(props.setError).toHaveBeenCalledWith('Failed to create control button');
  });

  it('toggles a control and handles update failures', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.controlButtons).toHaveLength(2));
    await act(() => result.current.handleToggleControl(firstButton));
    expect(mockApi.updateControl).toHaveBeenCalledWith('first', { isEnabled: false });
    expect(result.current.controlButtons[0]?.isEnabled).toBe(false);
    mockApi.updateControl.mockRejectedValueOnce('offline');
    await act(() => result.current.handleToggleControl(secondButton));
    expect(pushToast).toHaveBeenCalledWith('Failed to update control.', 'error');
    expect(result.current.controlOp).toBeNull();
  });

  it('chooses an editor preset for XY, vertical slider, speed, gripper, and ordinary buttons', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.controlsLoading).toBe(false));
    const cases = [
      [{ ...firstButton, icon: 'widget:xy' }, 'arm-xy'],
      [{ ...firstButton, icon: 'widget:s:dir=v' }, 'ptz-tilt'],
      [{ ...firstButton, command: 'set_speed' }, 'drive-speed'],
      [{ ...firstButton, command: 'gripper' }, 'gripper'],
      [firstButton, 'ptz-pan'],
    ] as const;
    for (const [control, preset] of cases) {
      act(() => result.current.startEditControl(control));
      expect(props.setControlEditPreset).toHaveBeenLastCalledWith(preset);
    }
    expect(props.setEditingControlId).toHaveBeenCalledWith('first');
    expect(props.setControlEditDraft).toHaveBeenCalled();
  });

  it('validates, saves, and closes control edits', async () => {
    const draft = {
      ...DEFAULT_CONTROL_DRAFT,
      label: ' Updated ',
      command: ' updated ',
      hotKey: ' u ',
      cooldownMs: '300',
      costCredits: '4',
      color: '',
    };
    const props = buildProps({ editingControlId: 'first', controlEditDraft: draft });
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.controlButtons).toHaveLength(2));
    await act(() => result.current.saveControlEdit());
    expect(mockApi.updateControl).toHaveBeenCalledWith(
      'first',
      expect.objectContaining({ label: 'Updated', command: 'updated', hotKey: 'u', color: null }),
    );
    expect(props.setEditingControlId).toHaveBeenCalledWith(null);
    expect(props.clearControlEditDraft).toHaveBeenCalled();

    const invalidProps = buildProps({
      editingControlId: 'first',
      controlEditDraft: { ...DEFAULT_CONTROL_DRAFT, label: '', command: '' },
    });
    const invalid = renderHook(() => useDashboardControls(invalidProps));
    await act(() => invalid.result.current.saveControlEdit());
    expect(pushToast).toHaveBeenCalledWith(
      'Label and command are required for a control button.',
      'error',
      2600,
    );
  });

  it('reports an edit failure and clears its operation marker', async () => {
    const props = buildProps({
      editingControlId: 'first',
      controlEditDraft: { ...DEFAULT_CONTROL_DRAFT, label: 'Forward', command: 'forward' },
    });
    mockApi.updateControl.mockRejectedValueOnce(new Error('update denied'));
    const { result } = renderHook(() => useDashboardControls(props));
    await act(() => result.current.saveControlEdit());
    expect(pushToast).toHaveBeenCalledWith('update denied', 'error');
    expect(result.current.controlOp).toBeNull();
    mockApi.updateControl.mockRejectedValueOnce('offline');
    await act(() => result.current.saveControlEdit());
    expect(pushToast).toHaveBeenCalledWith('Failed to update control.', 'error');
  });

  it('deletes, compacts, and reorders controls while honoring confirmation and bounds', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.controlButtons).toHaveLength(2));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(() => result.current.handleDeleteControl(firstButton));
    expect(mockApi.deleteControl).not.toHaveBeenCalled();

    await act(() => result.current.handleDeleteControl(firstButton));
    expect(mockApi.deleteControl).toHaveBeenCalledWith('first');
    expect(result.current.controlButtons).toEqual([
      expect.objectContaining({ id: 'second', position: 0 }),
    ]);
    expect(mockApi.reorderControls).toHaveBeenCalledWith('robot-1', [
      { id: 'second', position: 0 },
    ]);

    await act(() => result.current.moveControl('missing', 1));
    await act(() => result.current.moveControl('second', -1));
    expect(mockApi.reorderControls).toHaveBeenCalledTimes(1);
  });

  it('moves controls optimistically and reports reorder or delete failures', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.controlButtons).toHaveLength(2));
    await act(() => result.current.moveControl('first', 1));
    expect(result.current.controlButtons.map((entry) => entry.id)).toEqual(['second', 'first']);

    mockApi.reorderControls.mockRejectedValueOnce(new Error('reorder denied'));
    await act(() => result.current.moveControl('first', -1));
    expect(pushToast).toHaveBeenCalledWith('reorder denied', 'error');

    mockApi.deleteControl.mockRejectedValueOnce('offline');
    await act(() => result.current.handleDeleteControl(secondButton));
    expect(pushToast).toHaveBeenCalledWith('Failed to delete control.', 'error');
  });

  it('adds unique allow-list users and removes them', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    await waitFor(() => expect(result.current.allowedUsers).toHaveLength(1));
    await act(() => result.current.addAllowedUser());
    expect(mockApi.addAllowedUser).toHaveBeenCalledWith('robot-1', 'alice');
    expect(result.current.allowedUsers).toHaveLength(2);
    expect(props.resetAllowlistUsername).toHaveBeenCalled();

    mockApi.addAllowedUser.mockResolvedValueOnce(secondAllowedUser);
    await act(() => result.current.addAllowedUser());
    expect(result.current.allowedUsers).toHaveLength(2);

    await act(() => result.current.removeAllowedUser(firstAllowedUser));
    expect(mockApi.removeAllowedUser).toHaveBeenCalledWith('robot-1', 'user-1');
    expect(result.current.allowedUsers).toEqual([secondAllowedUser]);
  });

  it('handles allow-list API failures and guards missing identity/input', async () => {
    const props = buildProps();
    const { result } = renderHook(() => useDashboardControls(props));
    mockApi.addAllowedUser.mockRejectedValueOnce('offline');
    await act(() => result.current.addAllowedUser());
    expect(pushToast).toHaveBeenCalledWith('Failed to add user.', 'error');
    mockApi.removeAllowedUser.mockRejectedValueOnce(new Error('remove denied'));
    await act(() => result.current.removeAllowedUser(firstAllowedUser));
    expect(pushToast).toHaveBeenCalledWith('remove denied', 'error');

    const guarded = renderHook(() =>
      useDashboardControls(
        buildProps({ accessToken: null, selectedRobotId: null, allowlistUsername: ' ' }),
      ),
    );
    await act(() => guarded.result.current.addAllowedUser());
    await act(() => guarded.result.current.removeAllowedUser(firstAllowedUser));
    await act(() => guarded.result.current.handleCreateControl());
    expect(mockApi.addAllowedUser).toHaveBeenCalledTimes(1);
  });
});
