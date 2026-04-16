import { useAuth } from '@/lib/store';
import { AuthApi } from './api/auth';
import { UsersApi } from './api/users';
import { RobotsApi } from './api/robots';
import { ModerationApi } from './api/moderation';
import { QueueApi } from './api/queue';
import { ControlsApi } from './api/controls';
import type { AuthSessionResponse, RequestFn } from './api/types';
import type { PlatformStats } from './api-types';

export type {
  ActiveSessionRecord,
  AdminRecordingFile,
  AdminRobotRecordingStatus,
  AllowedUserRecord,
  ControlButtonRecord,
  ModRuntimeOverview,
  PlatformStats,
  RobotCameraIngress,
  RobotManaged,
  RobotMutationInput,
  RobotTelemetryPoint,
  RoomAccessGrant,
} from './api-types';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function resolveApiUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  // Server-side: use env var or localhost default.
  if (typeof window === 'undefined') {
    return configured ?? 'http://localhost:4000';
  }

  // Client-side with no explicit config: derive from current origin (same-domain proxy).
  if (!configured) {
    return window.location.origin;
  }

  // Env var is explicitly set — always trust it, even when it points to a different domain.
  return configured;
}

const API_URL = resolveApiUrl();

class ApiClient {
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  readonly auth: AuthApi;
  readonly users: UsersApi;
  readonly robots: RobotsApi;
  readonly moderation: ModerationApi;
  readonly queue: QueueApi;
  readonly controls: ControlsApi;

  constructor(baseUrl: string) {
    this.baseUrl = `${baseUrl}/api/v1`;
    const req = this.request.bind(this) as RequestFn;
    this.auth = new AuthApi(req);
    this.users = new UsersApi(req);
    this.robots = new RobotsApi(req);
    this.moderation = new ModerationApi(req, this.baseUrl);
    this.queue = new QueueApi(req);
    this.controls = new ControlsApi(req);
  }

  setToken(token: string | null) {
    this.accessToken = token;
  }

  syncTokenFromStore() {
    if (typeof window === 'undefined') return;
    this.accessToken = useAuth.getState().accessToken;
  }

  private async parseError(res: Response): Promise<ApiError> {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    return new ApiError(
      (error as { message?: string }).message ?? `API error: ${res.status}`,
      res.status,
    );
  }

  private async refreshSession(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });

      if (!refreshRes.ok) {
        useAuth.getState().logout();
        this.setToken(null);
        return null;
      }

      const refreshed = (await refreshRes.json()) as AuthSessionResponse;
      this.setToken(refreshed.accessToken);
      useAuth.getState().login({
        accessToken: refreshed.accessToken,
        username: refreshed.user.username,
        userId: refreshed.user.id,
        displayName: refreshed.user.displayName,
        role: refreshed.user.role,
      });

      return refreshed.accessToken;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async restoreSession(): Promise<boolean> {
    const restored = Boolean(await this.refreshSession());
    useAuth.getState().setHasHydrated(true);
    return restored;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (options.body !== undefined && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const makeRequest = () =>
      fetch(`${this.baseUrl}${path}`, { ...options, headers, credentials: 'include' });

    let res = await makeRequest();

    if (
      res.status === 401 &&
      path !== '/auth/login' &&
      path !== '/auth/register' &&
      path !== '/auth/refresh' &&
      path !== '/auth/forgot-password' &&
      path !== '/auth/reset-password'
    ) {
      const refreshedToken = await this.refreshSession();
      if (refreshedToken) {
        headers.Authorization = `Bearer ${refreshedToken}`;
        res = await makeRequest();
      }
    }

    if (!res.ok) throw await this.parseError(res);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  async health() {
    return this.request<{ status: string }>('/health');
  }

  async getPlatformStats() {
    return this.request<PlatformStats>('/health/stats');
  }

  // ─── Backward-compatible flat methods ────────────────────────────────────

  register = (...args: Parameters<AuthApi['register']>) => this.auth.register(...args);
  login = (...args: Parameters<AuthApi['login']>) => this.auth.login(...args);
  refresh = (...args: Parameters<AuthApi['refresh']>) => this.auth.refresh(...args);
  logout = () => this.auth.logout();
  forgotPassword = (...args: Parameters<AuthApi['forgotPassword']>) => this.auth.forgotPassword(...args);
  resetPassword = (...args: Parameters<AuthApi['resetPassword']>) => this.auth.resetPassword(...args);

  getMe = () => this.users.getMe();
  exportMe = () => this.users.exportMe();
  updateMe = (...args: Parameters<UsersApi['updateMe']>) => this.users.updateMe(...args);
  deleteMe = () => this.users.deleteMe();
  getAdminUsers = (...args: Parameters<UsersApi['getAdminUsers']>) => this.users.getAdminUsers(...args);
  updateAdminUser = (...args: Parameters<UsersApi['updateAdminUser']>) => this.users.updateAdminUser(...args);
  deleteAdminUser = (...args: Parameters<UsersApi['deleteAdminUser']>) => this.users.deleteAdminUser(...args);
  getUser = (...args: Parameters<UsersApi['getUser']>) => this.users.getUser(...args);

  getRobots = (...args: Parameters<RobotsApi['getRobots']>) => this.robots.getRobots(...args);
  getRobot = (...args: Parameters<RobotsApi['getRobot']>) => this.robots.getRobot(...args);
  getRobotBySlug = (...args: Parameters<RobotsApi['getRobotBySlug']>) => this.robots.getRobotBySlug(...args);
  getFeaturedRobots = () => this.robots.getFeaturedRobots();
  getRobotsOverview = () => this.robots.getRobotsOverview();
  getMyRobots = () => this.robots.getMyRobots();
  createRobot = (...args: Parameters<RobotsApi['createRobot']>) => this.robots.createRobot(...args);
  updateRobot = (...args: Parameters<RobotsApi['updateRobot']>) => this.robots.updateRobot(...args);
  updateRobotAsStaff = (...args: Parameters<RobotsApi['updateRobotAsStaff']>) => this.robots.updateRobotAsStaff(...args);
  deleteRobot = (...args: Parameters<RobotsApi['deleteRobot']>) => this.robots.deleteRobot(...args);
  deleteRobotAsStaff = (...args: Parameters<RobotsApi['deleteRobotAsStaff']>) => this.robots.deleteRobotAsStaff(...args);
  regenerateRobotToken = (...args: Parameters<RobotsApi['regenerateRobotToken']>) => this.robots.regenerateRobotToken(...args);
  regenerateRobotInviteCode = (...args: Parameters<RobotsApi['regenerateRobotInviteCode']>) => this.robots.regenerateRobotInviteCode(...args);
  ensureRobotInviteCode = (...args: Parameters<RobotsApi['ensureRobotInviteCode']>) => this.robots.ensureRobotInviteCode(...args);
  getAllowedUsers = (...args: Parameters<RobotsApi['getAllowedUsers']>) => this.robots.getAllowedUsers(...args);
  addAllowedUser = (...args: Parameters<RobotsApi['addAllowedUser']>) => this.robots.addAllowedUser(...args);
  removeAllowedUser = (...args: Parameters<RobotsApi['removeAllowedUser']>) => this.robots.removeAllowedUser(...args);
  getRobotIngressCameras = (...args: Parameters<RobotsApi['getRobotIngressCameras']>) => this.robots.getRobotIngressCameras(...args);
  createRobotIngressCamera = (...args: Parameters<RobotsApi['createRobotIngressCamera']>) => this.robots.createRobotIngressCamera(...args);
  deleteRobotIngressCamera = (...args: Parameters<RobotsApi['deleteRobotIngressCamera']>) => this.robots.deleteRobotIngressCamera(...args);
  uploadRobotThumbnail = (...args: Parameters<RobotsApi['uploadRobotThumbnail']>) => this.robots.uploadRobotThumbnail(...args);
  deleteRobotThumbnail = (...args: Parameters<RobotsApi['deleteRobotThumbnail']>) => this.robots.deleteRobotThumbnail(...args);
  getPrivateRobot = (...args: Parameters<RobotsApi['getPrivateRobot']>) => this.robots.getPrivateRobot(...args);
  getPrivateRobotBySlug = (...args: Parameters<RobotsApi['getPrivateRobotBySlug']>) => this.robots.getPrivateRobotBySlug(...args);
  verifyRobotAccess = (...args: Parameters<RobotsApi['verifyRobotAccess']>) => this.robots.verifyRobotAccess(...args);
  getViewerToken = (...args: Parameters<RobotsApi['getViewerToken']>) => this.robots.getViewerToken(...args);
  getPublicViewerToken = (...args: Parameters<RobotsApi['getPublicViewerToken']>) => this.robots.getPublicViewerToken(...args);
  getPendingRobotActions = (...args: Parameters<RobotsApi['getPendingRobotActions']>) => this.robots.getPendingRobotActions(...args);
  enqueueRobotAction = (...args: Parameters<RobotsApi['enqueueRobotAction']>) => this.robots.enqueueRobotAction(...args);
  getRobotLogs = (...args: Parameters<RobotsApi['getRobotLogs']>) => this.robots.getRobotLogs(...args);
  getRobotTelemetry = (...args: Parameters<RobotsApi['getRobotTelemetry']>) => this.robots.getRobotTelemetry(...args);

  moderateRobotUser = (...args: Parameters<ModerationApi['moderateRobotUser']>) => this.moderation.moderateRobotUser(...args);
  getModerationOverview = (...args: Parameters<ModerationApi['getModerationOverview']>) => this.moderation.getModerationOverview(...args);
  getModRuntimeOverview = () => this.moderation.getModRuntimeOverview();
  getRobotProfanityOverview = (...args: Parameters<ModerationApi['getRobotProfanityOverview']>) => this.moderation.getRobotProfanityOverview(...args);
  getGlobalProfanityOverview = () => this.moderation.getGlobalProfanityOverview();
  enqueueStaffRobotAction = (...args: Parameters<ModerationApi['enqueueStaffRobotAction']>) => this.moderation.enqueueStaffRobotAction(...args);
  getAdminRobotRecordingStatus = (...args: Parameters<ModerationApi['getAdminRobotRecordingStatus']>) => this.moderation.getAdminRobotRecordingStatus(...args);
  startAdminRobotRecording = (...args: Parameters<ModerationApi['startAdminRobotRecording']>) => this.moderation.startAdminRobotRecording(...args);
  stopAdminRobotRecording = (...args: Parameters<ModerationApi['stopAdminRobotRecording']>) => this.moderation.stopAdminRobotRecording(...args);
  listAdminRecordings = () => this.moderation.listAdminRecordings();
  getAdminRecordingStreamUrl = (...args: Parameters<ModerationApi['getAdminRecordingStreamUrl']>) => this.moderation.getAdminRecordingStreamUrl(...args);
  getActiveSession = (...args: Parameters<ModerationApi['getActiveSession']>) => this.moderation.getActiveSession(...args);

  getQueue = (...args: Parameters<QueueApi['getQueue']>) => this.queue.getQueue(...args);
  joinQueue = (...args: Parameters<QueueApi['joinQueue']>) => this.queue.joinQueue(...args);
  leaveQueue = (...args: Parameters<QueueApi['leaveQueue']>) => this.queue.leaveQueue(...args);
  voteQueue = (...args: Parameters<QueueApi['voteQueue']>) => this.queue.voteQueue(...args);

  getControls = (...args: Parameters<ControlsApi['getControls']>) => this.controls.getControls(...args);
  getAllControls = (...args: Parameters<ControlsApi['getAllControls']>) => this.controls.getAllControls(...args);
  createControl = (...args: Parameters<ControlsApi['createControl']>) => this.controls.createControl(...args);
  updateControl = (...args: Parameters<ControlsApi['updateControl']>) => this.controls.updateControl(...args);
  deleteControl = (...args: Parameters<ControlsApi['deleteControl']>) => this.controls.deleteControl(...args);
  reorderControls = (...args: Parameters<ControlsApi['reorderControls']>) => this.controls.reorderControls(...args);
}

export const api = new ApiClient(API_URL);
export { ApiError };
