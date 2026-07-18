import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardRobotPolling } from './use-dashboard-robot-polling';

const mockApi = vi.hoisted(() => ({
  setToken: vi.fn(),
  getPendingRobotActions: vi.fn(),
  getRobotLogs: vi.fn(),
  getRobotTelemetry: vi.fn(),
  getOnboardingStatus: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    setToken: mockApi.setToken,
    robots: {
      getPendingRobotActions: mockApi.getPendingRobotActions,
      getRobotLogs: mockApi.getRobotLogs,
      getRobotTelemetry: mockApi.getRobotTelemetry,
      getOnboardingStatus: mockApi.getOnboardingStatus,
    },
  },
}));

const telemetryPoint = {
  ts: 1,
  clientVersion: '1.0.0',
  gitBranch: 'main',
  gitCommit: 'abc123',
  gitDirty: false,
  pythonVersion: '3.13',
  cpuPercent: 10,
  memoryPercent: 20,
  temperatureC: 40,
  uptimeSec: 60,
  controlConnected: true,
  livekitConnected: true,
  commandsReceived: 2,
  cameraFrames: 30,
  emergencyStopVerified: true,
};

const onboarding = {
  canPublish: true,
  generatedAt: '2026-07-18T00:00:00.000Z',
  steps: [],
};

describe('useDashboardRobotPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    mockApi.getPendingRobotActions.mockResolvedValue({
      robotId: 'robot-1',
      actions: [
        { id: '1', type: 'restart_video', createdAt: 1 },
        { id: '2', type: 'restart_video', createdAt: 2 },
        { id: '3', type: 'unsupported', createdAt: 3 },
      ],
    });
    mockApi.getRobotLogs.mockResolvedValue({
      logs: Array.from({ length: 155 }, (_, index) => ({ ts: index, line: `line ${index}` })),
    });
    mockApi.getRobotTelemetry.mockResolvedValue({
      latest: telemetryPoint,
      history: [telemetryPoint],
    });
    mockApi.getOnboardingStatus.mockResolvedValue(onboarding);
  });

  it('loads visible robot diagnostics, filters actions, and caps retained logs', async () => {
    const { result } = renderHook(() =>
      useDashboardRobotPolling({ accessToken: 'token', robotId: 'robot-1' }),
    );

    await waitFor(() => expect(result.current.onboarding).toEqual(onboarding));
    expect(mockApi.setToken).toHaveBeenCalledWith('token');
    expect(result.current.pendingActionTypes).toEqual(['restart_video']);
    expect(result.current.diagLogs).toHaveLength(150);
    expect(result.current.diagLogs[0]?.line).toBe('line 5');
    expect(result.current.telemetry.latest).toEqual(telemetryPoint);
  });

  it('clears diagnostics and stops requesting when the robot context is removed', async () => {
    const { result, rerender } = renderHook(
      ({ accessToken, robotId }) => useDashboardRobotPolling({ accessToken, robotId }),
      { initialProps: { accessToken: 'token' as string | null, robotId: 'robot-1' as string | null } },
    );

    await waitFor(() => expect(result.current.pendingActionTypes).toEqual(['restart_video']));
    vi.clearAllMocks();
    rerender({ accessToken: null, robotId: null });

    await waitFor(() => expect(result.current.pendingActionTypes).toEqual([]));
    expect(result.current.diagLogs).toEqual([]);
    expect(result.current.telemetry).toEqual({ latest: null, history: [] });
    expect(result.current.onboarding).toBeNull();
    expect(mockApi.getPendingRobotActions).not.toHaveBeenCalled();
  });

  it('keeps empty state when diagnostic requests fail', async () => {
    mockApi.getPendingRobotActions.mockRejectedValue(new Error('actions unavailable'));
    mockApi.getRobotLogs.mockRejectedValue(new Error('logs unavailable'));
    mockApi.getRobotTelemetry.mockRejectedValue(new Error('telemetry unavailable'));

    const { result } = renderHook(() =>
      useDashboardRobotPolling({ accessToken: 'token', robotId: 'robot-1' }),
    );

    await waitFor(() => expect(mockApi.getRobotTelemetry).toHaveBeenCalled());
    expect(result.current.pendingActionTypes).toEqual([]);
    expect(result.current.diagLogs).toEqual([]);
    expect(result.current.telemetry.latest).toBeNull();
    expect(result.current.onboarding).toBeNull();
  });
});
