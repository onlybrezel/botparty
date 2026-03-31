const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message ?? `API error: ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // Auth
  async register(data: { username: string; email: string; password: string }) {
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

  // Users
  async getMe() {
    return this.request<Record<string, unknown>>('/users/me');
  }

  // Robots
  async getRobots(params?: { status?: string; tag?: string }) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return this.request<Record<string, unknown>[]>(`/robots${qs ? `?${qs}` : ''}`);
  }

  async getRobot(slug: string) {
    return this.request<Record<string, unknown>>(`/robots/${slug}`);
  }

  async getMyRobots() {
    return this.request<Record<string, unknown>[]>('/robots/my');
  }

  async createRobot(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/robots', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // LiveKit
  async getViewerToken(robotId: string, control = false) {
    return this.request<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer/${robotId}?control=${control}`,
      { method: 'POST' },
    );
  }

  // Queue
  async getQueue(robotId: string) {
    return this.request<Record<string, unknown>[]>(`/queue/${robotId}`);
  }

  async joinQueue(robotId: string) {
    return this.request<Record<string, unknown>>(`/queue/${robotId}/join`, { method: 'POST' });
  }

  async leaveQueue(robotId: string) {
    return this.request(`/queue/${robotId}/leave`, { method: 'DELETE' });
  }

  // Health
  async health() {
    return this.request<{ status: string }>('/health');
  }
}

export const api = new ApiClient(API_URL);
