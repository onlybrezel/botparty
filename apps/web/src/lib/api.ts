import type {
  ControlButtonAccess,
  PublicRobotOverview,
  RobotPublic,
  RobotStreamCameraConfig,
  UserPublic,
} from '@botparty/shared';
import { useAuth } from '@/lib/store';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RobotManaged extends RobotPublic {
  claimToken: string;
  inviteCode: string | null;
  streamKey: string;
  metadata: {
    access?: {
      video?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      control?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      chat?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      estop?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    };
    stream?: {
      targetBitrateKbps?: number;
      activeCameraId?: string;
      cameras?: RobotStreamCameraConfig[];
    };
  } | null;
  accessPassword: string | null;
  livekitRoom: string | null;
  isFeatured: boolean;
  recordSessions: boolean;
  aiAssistEnabled: boolean;
  ros2Enabled: boolean;
  updatedAt: string;
}

export interface RobotMutationInput {
  name?: string;
  slug?: string;
  description?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  accessMode?: 'OPEN' | 'PASSWORD' | 'LINK_ONLY' | 'ALLOWED_USERS';
  queueMode?: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  maxTurnTime?: number;
  maxViewers?: number;
  maxControllers?: number;
  tags?: string[];
  acl?: {
    video: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    control: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    chat: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    estop: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  };
  stream?: {
    targetBitrateKbps?: number;
    activeCameraId?: string;
    cameras?: RobotStreamCameraConfig[];
  };
  accessPassword?: string;
}

export interface RobotCameraIngress {
  type: 'WHIP';
  ingressId: string;
  url: string;
  streamKey: string;
  endpointUrl: string;
  participantIdentity?: string;
  participantName?: string;
  enableTranscoding: boolean;
  cameraId: string | null;
  isLive: boolean;
}

export interface PlatformStats {
  totalUsers: number;
  totalRobots: number;
  liveRobots: number;
  totalLiveViewers: number;
  activeQueueEntries: number;
  totalSessions: number;
  timestamp: string;
}

export interface RobotTelemetryPoint {
  ts: number;
  clientVersion: string | null;
  botpartyStreamerVersion?: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
  gitDirty: boolean;
  pythonVersion: string | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  temperatureC: number | null;
  uptimeSec: number | null;
  controlConnected: boolean;
  livekitConnected: boolean;
  commandsReceived: number;
  cameraFrames: number;
}

export interface ModRuntimeOverview {
  generatedAt: string;
  summary: {
    totalRobots: number;
    onlineRobots: number;
    busyRobots: number;
    offlineRobots: number;
    maintenanceRobots: number;
    totalViewers: number;
    queuedUsers: number;
    activeSessions: number;
    telemetryFreshRobots: number;
    controlConnectedRobots: number;
    livekitConnectedRobots: number;
    avgCpuPercent: number | null;
    avgMemoryPercent: number | null;
    totalIngressKbps: number;
    totalEgressKbps: number;
  };
  platform: {
    available: boolean;
    error: string | null;
    host: {
      cpuCores: number | null;
      memoryBytes: number | null;
      cpuPercent: number | null;
      memoryUsageBytes: number | null;
      memoryPercent: number | null;
      rxKbps: number | null;
      txKbps: number | null;
    } | null;
    containers: Array<{
      service: string;
      containerName: string | null;
      cpuPercent: number | null;
      memoryUsageBytes: number | null;
      memoryLimitBytes: number | null;
      memoryPercent: number | null;
      rxKbps: number | null;
      txKbps: number | null;
    }>;
  };
  livekit: {
    available: boolean;
    error: string | null;
    totals: {
      rooms: number;
      participants: number;
      publishers: number;
      subscribers: number;
      estimatedIngressKbps: number;
    };
    rooms: Array<{
      roomName: string;
      robotId: string | null;
      sid: string;
      participants: number;
      publishers: number;
      subscribers: number;
      activeRecording: boolean;
      createdAt: string | null;
      estimatedIngressKbps: number;
      participantNames: string[];
      participantDetails: Array<{
        identity: string;
        name: string;
        isPublisher: boolean;
        joinedAt: string | null;
        trackCount: number;
      }>;
    }>;
  };
  robots: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
    visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
    queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
    viewerCount: number;
    lastOnlineAt: string | null;
    heartbeatAgeSec: number | null;
    telemetryAgeSec: number | null;
    queueLength: number;
    queueHead: {
      id: string;
      username: string;
      displayName: string | null;
    } | null;
    activeSession: {
      id: string;
      startedAt: string;
      user: {
        id: string;
        username: string;
        displayName: string | null;
      };
    } | null;
    owner: {
      id: string;
      username: string;
      displayName: string | null;
    };
    telemetry: RobotTelemetryPoint | null;
    livekit: {
      roomName: string;
      robotId: string | null;
      sid: string;
      participants: number;
      publishers: number;
      subscribers: number;
      activeRecording: boolean;
      createdAt: string | null;
      estimatedIngressKbps: number;
      participantNames: string[];
      participantDetails: Array<{
        identity: string;
        name: string;
        isPublisher: boolean;
        joinedAt: string | null;
        trackCount: number;
      }>;
    } | null;
  }>;
}

export interface ControlButtonRecord {
  id: string;
  label: string;
  command: string;
  hotKey: string | null;
  icon: string | null;
  cooldownMs: number;
  access: ControlButtonAccess;
  position: number;
  color: string | null;
  isEnabled?: boolean;
}

export interface RoomAccessGrant {
  token: string;
  expiresAt: string;
}

export interface AllowedUserRecord {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  addedAt: string;
}

export interface ActiveSessionRecord {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  user: {
    id: string;
    username: string;
    displayName: string | null;
  };
}

export interface AdminRobotRecordingStatus {
  roomName: string;
  active: boolean;
  activeCount: number;
  egressId: string | null;
  startedAt: string | null;
  sessions: Array<{
    egressId: string;
    cameraId: string | null;
    videoTrackId: string | null;
    audioTrackId: string | null;
    startedAt: string | null;
  }>;
  updatedAt: string;
}

export interface AdminRecordingFile {
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
  robotId: string | null;
  cameraId?: string | null;
  recordedAt?: string | null;
}

type AuthSessionResponse = {
  accessToken: string;
  user: UserPublic;
};

function buildQueryString(params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) {
    return '';
  }

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    qs.set(key, String(value));
  }

  const serialized = qs.toString();
  return serialized ? `?${serialized}` : '';
}

function resolveApiUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (typeof window === 'undefined') {
    return configured ?? 'http://localhost:4000';
  }

  if (!configured) {
    return window.location.origin;
  }

  try {
    const url = new URL(configured);
    const isConfiguredLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isCurrentHostLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isConfiguredLocalhost && !isCurrentHostLocalhost) {
      return window.location.origin;
    }
  } catch {
    return window.location.origin;
  }

  return configured;
}

const API_URL = resolveApiUrl();

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = `${baseUrl}/api/v1`;
  }

  setToken(token: string | null) {
    this.accessToken = token;
  }

  syncTokenFromStore() {
    if (typeof window === 'undefined') {
      return;
    }

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
    if (typeof window === 'undefined') {
      return null;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

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

      const refreshed = await refreshRes.json() as AuthSessionResponse;
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

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

    if (!res.ok) {
      throw await this.parseError(res);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async register(data: { username: string; email: string; password: string; displayName?: string }) {
    return this.request<AuthSessionResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async refresh(refreshToken?: string) {
    return this.request<AuthSessionResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
  }

  async logout() {
    return this.request<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: '{}',
    });
  }

  async forgotPassword(email: string) {
    return this.request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, password: string) {
    return this.request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  async getMe() {
    return this.request<UserPublic>('/users/me');
  }

  async updateMe(data: { displayName?: string; avatarUrl?: string }) {
    return this.request<UserPublic>('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getAdminUsers(params?: { q?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.limit) qs.set('limit', String(params.limit));
    return this.request<
      Array<
        UserPublic & {
          email: string;
          isActive: boolean;
          credits: number;
          balance: number;
          lastLoginAt: string | null;
        }
      >
    >(`/users/admin/list${qs.toString() ? `?${qs.toString()}` : ''}`);
  }

  async updateAdminUser(
    id: string,
    data: {
      username?: string;
      email?: string;
      displayName?: string | null;
      password?: string;
      role?: 'ADMIN' | 'MOD' | 'USER';
      isActive?: boolean;
      credits?: number;
      balance?: number;
    },
  ) {
    return this.request<
      UserPublic & {
        email: string;
        isActive: boolean;
        credits: number;
        balance: number;
        lastLoginAt: string | null;
      }
    >(`/users/admin/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminUser(id: string) {
    return this.request<void>(`/users/admin/${id}`, {
      method: 'DELETE',
    });
  }

  async getUser(username: string) {
    return this.request<UserPublic>(`/users/${encodeURIComponent(username)}`);
  }

  // ─── Robots ────────────────────────────────────────────────────────────────

  async getRobots(params?: { status?: string; tag?: string; q?: string; sort?: string }) {
    return this.request<RobotPublic[]>(`/robots${buildQueryString(params)}`);
  }

  async getRobot(username: string, slug: string) {
    return this.request<RobotPublic>(`/robots/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  }

  async getRobotBySlug(slug: string) {
    return this.request<RobotPublic>(`/robots/${encodeURIComponent(slug)}`);
  }

  async getFeaturedRobots() {
    return this.request<RobotPublic[]>('/robots/featured');
  }

  async getRobotsOverview() {
    return this.request<PublicRobotOverview>('/robots/overview');
  }

  async getMyRobots() {
    return this.request<RobotManaged[]>('/robots/my');
  }

  async createRobot(data: RobotMutationInput) {
    return this.request<RobotManaged>('/robots', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRobot(id: string, data: RobotMutationInput) {
    return this.request<RobotManaged>(`/robots/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateRobotAsStaff(id: string, data: RobotMutationInput) {
    return this.request<RobotManaged>(`/robots/admin/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteRobot(id: string) {
    return this.request<void>(`/robots/${id}`, {
      method: 'DELETE',
    });
  }

  async deleteRobotAsStaff(id: string) {
    return this.request<void>(`/robots/admin/${id}`, {
      method: 'DELETE',
    });
  }

  async regenerateRobotToken(id: string) {
    return this.request<{ id: string; claimToken: string }>(`/robots/${id}/regenerate-token`, {
      method: 'POST',
    });
  }

  async getAllowedUsers(robotId: string) {
    return this.request<AllowedUserRecord[]>(`/robots/${robotId}/allowed-users`);
  }

  async addAllowedUser(robotId: string, username: string) {
    return this.request<AllowedUserRecord>(`/robots/${robotId}/allowed-users`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  async removeAllowedUser(robotId: string, userId: string) {
    return this.request<void>(`/robots/${robotId}/allowed-users/${userId}`, {
      method: 'DELETE',
    });
  }

  async getRobotIngressCameras(robotId: string) {
    return this.request<RobotCameraIngress[]>(`/robots/${robotId}/ingress-cameras`);
  }

  async createRobotIngressCamera(
    robotId: string,
    payload: { cameraId: string; label?: string; compatibilityMode?: boolean },
  ) {
    return this.request<RobotCameraIngress>(`/robots/${robotId}/ingress-cameras`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteRobotIngressCamera(robotId: string, ingressId: string) {
    return this.request<void>(`/robots/${robotId}/ingress-cameras/${encodeURIComponent(ingressId)}`, {
      method: 'DELETE',
    });
  }

  async getPrivateRobot(username: string, slug: string) {
    return this.request<RobotPublic>(`/robots/private/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  }

  async getPrivateRobotBySlug(slug: string) {
    return this.request<RobotPublic>(`/robots/private/${encodeURIComponent(slug)}`);
  }

  // ─── LiveKit ───────────────────────────────────────────────────────────────

  async getViewerToken(robotId: string, control = false) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    return this.request<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer/${robotId}${buildQueryString({ control, roomAccessToken })}`,
      { method: 'POST', body: '{}' },
    );
  }

  async getPublicViewerToken(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    return this.request<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer-public/${robotId}${buildQueryString({ roomAccessToken, guestSessionId })}`,
      { method: 'POST', body: '{}' },
    );
  }

  async verifyRobotAccess(
    robotId: string,
    data?: { password?: string; guestSessionId?: string; inviteCode?: string },
  ) {
    return this.request<RoomAccessGrant>(`/robots/${robotId}/access/verify`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
  }

  async moderateRobotUser(
    robotId: string,
    data: {
      targetUserId: string;
      action: 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'WARN';
      reason?: string;
      durationSec?: number;
    },
  ) {
    return this.request<{ id?: string; action?: string; userId?: string }>(`/moderation/robot/${robotId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getModerationOverview(robotId?: string) {
    const qs = robotId ? `?robotId=${encodeURIComponent(robotId)}` : '';
    return this.request<{
      recentActions: Array<{
        id: string;
        action: 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'WARN';
        reason: string | null;
        isActive: boolean;
        expiresAt: string | null;
        createdAt: string;
        robot: { id: string; name: string; slug: string };
        user: { id: string; username: string; displayName: string | null };
        moderator: { id: string; username: string } | null;
      }>;
      activeRestrictions: Array<{
        id: string;
        action: 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'WARN';
        reason: string | null;
        expiresAt: string | null;
        robot: { id: string; name: string; slug: string };
        user: { id: string; username: string; displayName: string | null };
        moderator: { id: string; username: string } | null;
      }>;
      robots: Array<{
        id: string;
        name: string;
        slug: string;
        status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
        description: string | null;
        visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
        tags: string[];
        owner: { id: string; username: string; displayName: string | null };
      }>;
      counts: { bans: number; timeouts: number; kicks: number };
    }>(`/moderation/admin/overview${qs}`);
  }

  async getModRuntimeOverview() {
    return this.request<ModRuntimeOverview>('/moderation/admin/runtime-overview');
  }

  async getRobotProfanityOverview(robotId: string) {
    return this.request<{
      total: number;
      byUser: Array<{ userId: string; count: number }>;
      events: Array<{ ts: number; userId: string; username: string; content: string }>;
    }>(`/moderation/robot/${robotId}/profanity`);
  }

  async getGlobalProfanityOverview() {
    return this.request<{
      total: number;
      byUser: Array<{ userId: string; count: number }>;
      byRobot: Array<{ robotId: string; robotName: string; robotSlug: string; count: number }>;
      events: Array<{
        ts: number;
        userId: string;
        username: string;
        content: string;
        robotId: string;
        robotName: string;
        robotSlug: string;
      }>;
    }>('/moderation/admin/profanity-overview');
  }

  async enqueueRobotAction(
    robotId: string,
    data: { type: 'restart_video' | 'restart_control' | 'restart_chat' | 'update_client' | 'set_log_stream'; durationSec?: number },
  ) {
    return this.request<{ id: string; type: string; createdAt: number; alreadyQueued?: boolean }>(`/robots/${robotId}/actions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async enqueueStaffRobotAction(
    robotId: string,
    data: { type: 'restart_video' | 'restart_control' | 'restart_chat' | 'update_client' | 'set_log_stream'; durationSec?: number },
  ) {
    return this.request<{ id: string; type: string; createdAt: number; alreadyQueued?: boolean }>(
      `/moderation/admin/robot/${robotId}/actions`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    );
  }

  async getAdminRobotRecordingStatus(robotId: string) {
    return this.request<AdminRobotRecordingStatus>(`/moderation/admin/robot/${robotId}/recording`);
  }

  async startAdminRobotRecording(robotId: string) {
    return this.request<AdminRobotRecordingStatus>(`/moderation/admin/robot/${robotId}/recording/start`, {
      method: 'POST',
      body: '{}',
    });
  }

  async stopAdminRobotRecording(robotId: string) {
    return this.request<AdminRobotRecordingStatus>(`/moderation/admin/robot/${robotId}/recording/stop`, {
      method: 'POST',
      body: '{}',
    });
  }

  async listAdminRecordings() {
    return this.request<AdminRecordingFile[]>('/moderation/admin/recordings');
  }

  getAdminRecordingStreamUrl(fileName: string) {
    const encoded = encodeURIComponent(fileName);
    return `${this.baseUrl}/moderation/admin/recordings/${encoded}`;
  }

  async getPendingRobotActions(robotId: string) {
    return this.request<{ robotId: string; actions: Array<{ id: string; type: string; createdAt: number }> }>(
      `/robots/${robotId}/actions/pending`,
    );
  }

  async getRobotLogs(robotId: string) {
    return this.request<{ logs: Array<{ ts: number; line: string }> }>(`/robots/${robotId}/logs`);
  }

  async getRobotTelemetry(robotId: string) {
    return this.request<{ latest: RobotTelemetryPoint | null; history: RobotTelemetryPoint[] }>(
      `/robots/${robotId}/telemetry`,
    );
  }

  async getActiveSession(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    return this.request<ActiveSessionRecord | null>(
      `/sessions/robot/${robotId}/active${buildQueryString({ roomAccessToken, guestSessionId })}`,
    );
  }

  // ─── Queue ─────────────────────────────────────────────────────────────────

  async getQueue(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    const rows = await this.request<
      Array<{
        userId: string;
        position: number;
        joinedAt: string;
        votes?: number;
        user?: { username?: string; displayName?: string | null };
      }>
    >(`/queue/${robotId}${buildQueryString({ roomAccessToken, guestSessionId })}`);

    return rows.map((row) => ({
      userId: row.userId,
      username: row.user?.displayName ?? row.user?.username ?? row.userId.slice(0, 8),
      position: row.position,
      joinedAt: row.joinedAt,
      votes: typeof row.votes === 'number' ? row.votes : 0,
    }));
  }

  async joinQueue(robotId: string, roomAccessToken?: string | null) {
    return this.request<{ position: number }>(`/queue/${robotId}/join`, {
      method: 'POST',
      body: JSON.stringify(roomAccessToken ? { roomAccessToken } : {}),
    });
  }

  async leaveQueue(robotId: string) {
    return this.request(`/queue/${robotId}/leave`, { method: 'DELETE' });
  }

  async voteQueue(robotId: string, targetUserId: string, roomAccessToken?: string | null) {
    return this.request<{ userId: string; votes: number }>(`/queue/${robotId}/vote/${targetUserId}`, {
      method: 'POST',
      body: JSON.stringify(roomAccessToken ? { roomAccessToken } : {}),
    });
  }

  // ─── Controls ──────────────────────────────────────────────────────────────

  async getControls(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;

    return this.request<ControlButtonRecord[]>(
      `/controls/robot/${robotId}${buildQueryString({ roomAccessToken, guestSessionId })}`,
    );
  }

  async getAllControls(robotId: string) {
    return this.request<ControlButtonRecord[]>(`/controls/robot/${robotId}/all`);
  }

  async createControl(
    robotId: string,
    data: {
      label: string;
      command: string;
      hotKey?: string;
      icon?: string;
      cooldownMs?: number;
      access?: ControlButtonAccess;
      position?: number;
      isEnabled?: boolean;
      color?: string;
    },
  ) {
    return this.request<ControlButtonRecord>(`/controls/robot/${robotId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateControl(
    buttonId: string,
    data: {
      label?: string;
      command?: string;
      hotKey?: string;
      icon?: string;
      cooldownMs?: number;
      access?: ControlButtonAccess;
      position?: number;
      isEnabled?: boolean;
      color?: string | null;
    },
  ) {
    return this.request<ControlButtonRecord>(`/controls/${buttonId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteControl(buttonId: string) {
    return this.request<void>(`/controls/${buttonId}`, {
      method: 'DELETE',
    });
  }

  async reorderControls(robotId: string, order: Array<{ id: string; position: number }>) {
    return this.request<void>(`/controls/robot/${robotId}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async health() {
    return this.request<{ status: string }>('/health');
  }

  async getPlatformStats() {
    return this.request<PlatformStats>('/health/stats');
  }
}

export const api = new ApiClient(API_URL);
