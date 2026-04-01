import type { RobotPublic, UserPublic } from '@botparty/shared';

export interface RobotManaged extends RobotPublic {
  claimToken: string;
  streamKey: string;
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

  constructor(baseUrl: string) {
    this.baseUrl = `${baseUrl}/api/v1`;
  }

  setToken(token: string | null) {
    this.accessToken = token;
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

    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error((error as { message?: string }).message ?? `API error: ${res.status}`);
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

