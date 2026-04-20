import { useAuth } from '@/lib/store';
import { AuthApi } from './api/auth';
import { UsersApi } from './api/users';
import { RobotsApi } from './api/robots';
import { ModerationApi } from './api/moderation';
import { QueueApi } from './api/queue';
import { ControlsApi } from './api/controls';
import type { ApiRequestOptions, AuthSessionResponse, RequestFn } from './api/types';
import type { PlatformStats } from './api-types';

export type {
  ActiveSessionRecord,
  AdminRecordingFile,
  AdminRobotRecordingStatus,
  AllowedUserRecord,
  ControlButtonRecord,
  ModRuntimeOverview,
  PlatformStats,
  RobotChatHistoryPage,
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
  private csrfToken: string | null = null;
  private csrfPromise: Promise<string | null> | null = null;

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
      const csrfToken = await this.ensureCsrfToken();
      const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
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

  async request(path: string, options: ApiRequestOptions & { expectNoContent: true }): Promise<void>;
  async request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T | void> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) ?? {}),
    };

    if (options.body !== undefined && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }

    const method = (options.method ?? 'GET').toUpperCase();
    if (path.startsWith('/auth/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = await this.ensureCsrfToken();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
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
    if (res.status === 204 || options.expectNoContent) return;
    return res.json() as Promise<T>;
  }

  private async ensureCsrfToken(): Promise<string | null> {
    if (typeof window === 'undefined') {
      return null;
    }
    if (this.csrfToken) {
      return this.csrfToken;
    }
    if (this.csrfPromise) {
      return this.csrfPromise;
    }

    this.csrfPromise = (async () => {
      const response = await fetch(`${this.baseUrl}/auth/csrf`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as { csrfToken?: string } | null;
      this.csrfToken = payload?.csrfToken?.trim() || null;
      return this.csrfToken;
    })().finally(() => {
      this.csrfPromise = null;
    });

    return this.csrfPromise;
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  async health() {
    return this.request<{ status: string }>('/health');
  }

  async getPlatformStats() {
    return this.request<PlatformStats>('/health/stats');
  }
}

export const api = new ApiClient(API_URL);
export function createApiClient(baseUrl = API_URL) {
  return new ApiClient(baseUrl);
}
export { ApiError };
