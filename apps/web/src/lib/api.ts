import type { RobotPublic, UserPublic } from '@botparty/shared';
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
  streamKey: string;
  metadata: {
    access?: {
      video?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      control?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      chat?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    };
    stream?: {
      targetBitrateKbps?: number;
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
  };
  stream?: {
    targetBitrateKbps?: number;
  };
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

    const auth = useAuth.getState();
    if (!auth.refreshToken) {
      auth.logout();
      this.setToken(null);
      return null;
    }

    this.refreshPromise = (async () => {
      const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });

      if (!refreshRes.ok) {
        auth.logout();
        this.setToken(null);
        return null;
      }

      const refreshed = await refreshRes.json() as { accessToken: string; refreshToken: string };
      this.setToken(refreshed.accessToken);

      const meRes = await fetch(`${this.baseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${refreshed.accessToken}` },
      });

      if (!meRes.ok) {
        auth.logout();
        this.setToken(null);
        return null;
      }

      const me = await meRes.json() as UserPublic;
      useAuth.getState().login({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        username: me.username,
        userId: me.id,
        displayName: me.displayName,
      });

      return refreshed.accessToken;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async restoreSession(): Promise<boolean> {
    return Boolean(await this.refreshSession());
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

    const makeRequest = () => fetch(`${this.baseUrl}${path}`, { ...options, headers });

    let res = await makeRequest();

    if (
      res.status === 401 &&
      path !== '/auth/login' &&
      path !== '/auth/register' &&
      path !== '/auth/refresh'
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
    return this.request<{ accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request<{ accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async refresh(refreshToken: string) {
    return this.request<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  // ─── Users ─────────────────────────────────────────────────────────────────

  async getMe() {
    return this.request<UserPublic>('/users/me');
  }

  // ─── Robots ────────────────────────────────────────────────────────────────

  async getRobots(params?: { status?: string; tag?: string }) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return this.request<RobotPublic[]>(`/robots${qs ? `?${qs}` : ''}`);
  }

  async getRobot(slug: string) {
    return this.request<RobotPublic>(`/robots/${slug}`);
  }

  async getFeaturedRobots() {
    return this.request<RobotPublic[]>('/robots/featured');
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

  async deleteRobot(id: string) {
    return this.request<void>(`/robots/${id}`, {
      method: 'DELETE',
    });
  }

  async regenerateRobotToken(id: string) {
    return this.request<{ id: string; claimToken: string }>(`/robots/${id}/regenerate-token`, {
      method: 'POST',
    });
  }

  // ─── LiveKit ───────────────────────────────────────────────────────────────

  async getViewerToken(robotId: string, control = false) {
    return this.request<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer/${robotId}?control=${control}`,
      { method: 'POST', body: '{}' },
    );
  }

  async getPublicViewerToken(robotId: string) {
    return this.request<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer-public/${robotId}`,
      { method: 'POST', body: '{}' },
    );
  }

  async enqueueRobotAction(
    robotId: string,
    data: { type: 'restart_video' | 'restart_control' | 'restart_chat' | 'set_log_stream'; durationSec?: number },
  ) {
    return this.request<{ id: string; type: string; createdAt: number }>(`/robots/${robotId}/actions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getRobotLogs(robotId: string) {
    return this.request<{ logs: Array<{ ts: number; line: string }> }>(`/robots/${robotId}/logs`);
  }

  // ─── Queue ─────────────────────────────────────────────────────────────────

  async getQueue(robotId: string) {
    return this.request<Array<{ userId: string; username: string; position: number; joinedAt: string }>>(
      `/queue/${robotId}`,
    );
  }

  async joinQueue(robotId: string) {
    return this.request<{ position: number }>(`/queue/${robotId}/join`, { method: 'POST' });
  }

  async leaveQueue(robotId: string) {
    return this.request(`/queue/${robotId}/leave`, { method: 'DELETE' });
  }

  // ─── Controls ──────────────────────────────────────────────────────────────

  async getControls(robotId: string) {
    return this.request<
      Array<{
        id: string;
        label: string;
        command: string;
        hotKey: string | null;
        icon: string | null;
        cooldownMs: number;
        access: string;
        position: number;
        color: string | null;
      }>
    >(`/controls/robot/${robotId}`);
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async health() {
    return this.request<{ status: string }>('/health');
  }
}

export const api = new ApiClient(API_URL);

