import { useAuth } from '@/lib/store';
import { AuthApi } from './api/auth';
import { UsersApi } from './api/users';
import { RobotsApi } from './api/robots';
import { ModerationApi } from './api/moderation';
import { QueueApi } from './api/queue';
import { ControlsApi } from './api/controls';
import { SessionsApi } from './api/sessions';
import { WalletApi } from './api/wallet';
import { NotificationsApi } from './api/notifications';
import { AnalyticsApi } from './api/analytics';
import type { ApiRequestOptions, AuthSessionResponse, RequestFn } from './api/types';
import type { PlatformStats } from './api-types';
import { isRecord } from './api-response-guards';

export type {
  ActiveSessionRecord,
  AdminRecordingFile,
  AdminRobotRecordingStatus,
  AllowedUserRecord,
  ControlButtonRecord,
  ModRuntimeOverview,
  PlatformStats,
  RobotWebhookCreateResponse,
  RobotWebhookRecord,
  RobotChatHistoryPage,
  RobotCameraIngress,
  RobotManaged,
  RobotMutationInput,
  RobotTelemetryPoint,
  RoomAccessGrant,
  UserSessionDetail,
  UserSessionRecord,
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

type RefreshSessionResult = {
  token: string | null;
  retryable: boolean;
};

const RESTORE_RETRY_DELAYS_MS = [150, 400] as const;

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

function resolveApiUrl() {
  const configured = process.env['NEXT_PUBLIC_API_URL'];

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
  private refreshPromise: Promise<RefreshSessionResult> | null = null;
  private refreshSignal: AbortSignal | undefined;
  private csrfToken: string | null = null;
  private csrfPromise: Promise<string> | null = null;
  private csrfSignal: AbortSignal | undefined;

  readonly auth: AuthApi;
  readonly users: UsersApi;
  readonly robots: RobotsApi;
  readonly moderation: ModerationApi;
  readonly queue: QueueApi;
  readonly controls: ControlsApi;
  readonly sessions: SessionsApi;
  readonly wallet: WalletApi;
  readonly notifications: NotificationsApi;
  readonly analytics: AnalyticsApi;

  constructor(baseUrl: string) {
    this.baseUrl = `${baseUrl}/api/v1`;
    const req = this.request.bind(this) as RequestFn;
    this.auth = new AuthApi(req);
    this.users = new UsersApi(req);
    this.robots = new RobotsApi(req);
    this.moderation = new ModerationApi(req, this.baseUrl);
    this.queue = new QueueApi(req);
    this.controls = new ControlsApi(req);
    this.sessions = new SessionsApi(req);
    this.wallet = new WalletApi(req);
    this.notifications = new NotificationsApi(req);
    this.analytics = new AnalyticsApi(req);
  }

  setToken(token: string | null) {
    this.accessToken = token;
  }

  syncTokenFromStore() {
    if (typeof window === 'undefined') return;
    this.accessToken = useAuth.getState().accessToken;
  }

  private async parseError(res: Response): Promise<ApiError> {
    const error: unknown = await res.json().catch(() => null);
    return new ApiError(
      isRecord(error) && typeof error['message'] === 'string'
        ? error['message']
        : res.statusText || `API error: ${res.status}`,
      res.status,
    );
  }

  private async refreshSession(signal?: AbortSignal): Promise<RefreshSessionResult> {
    if (typeof window === 'undefined') return { token: null, retryable: false };
    if (this.refreshPromise && !this.refreshSignal?.aborted) return this.refreshPromise;

    const refreshPromise = (async () => {
      try {
        const csrfToken = await this.ensureCsrfToken(signal);
        if (signal?.aborted) return { token: null, retryable: false };
        const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: '{}',
          credentials: 'include',
          ...(signal ? { signal } : {}),
        });

        if (signal?.aborted) return { token: null, retryable: false };
        if (!refreshRes.ok) {
          if (refreshRes.status === 401 || refreshRes.status === 403) {
            useAuth.getState().logout();
            this.setToken(null);
            return { token: null, retryable: false };
          }
          return {
            token: null,
            retryable: refreshRes.status === 429 || refreshRes.status >= 500,
          };
        }

        const refreshed: unknown = await refreshRes.json();
        if (signal?.aborted) return { token: null, retryable: false };
        if (!isAuthSessionResponse(refreshed) || !refreshed.accessToken) {
          useAuth.getState().logout();
          this.setToken(null);
          return { token: null, retryable: false };
        }
        this.setToken(refreshed.accessToken);
        useAuth.getState().login({
          accessToken: refreshed.accessToken,
          username: refreshed.user['username'],
          userId: refreshed.user['id'],
          displayName: refreshed.user['displayName'],
          role: refreshed.user['role'],
        });

        return { token: refreshed.accessToken, retryable: false };
      } catch {
        // Temporary network / proxy / CSRF bootstrap issues should not look
        // like an explicit sign-out. A later retry can still recover cleanly.
        return { token: null, retryable: !signal?.aborted };
      }
    })().finally(() => {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = null;
        this.refreshSignal = undefined;
      }
    });

    this.refreshPromise = refreshPromise;
    this.refreshSignal = signal;
    return refreshPromise;
  }

  async restoreSession(signal?: AbortSignal): Promise<boolean> {
    let restored = false;

    for (let attempt = 0; attempt <= RESTORE_RETRY_DELAYS_MS.length; attempt += 1) {
      if (signal?.aborted) return false;
      const result = await this.refreshSession(signal);
      if (signal?.aborted) return false;
      if (result.token) {
        restored = true;
        break;
      }
      if (!result.retryable || attempt === RESTORE_RETRY_DELAYS_MS.length) {
        break;
      }
      const retryDelayMs = RESTORE_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs === undefined) {
        break;
      }
      await wait(retryDelayMs);
    }

    if (signal?.aborted) return false;
    useAuth.getState().setHasHydrated(true);
    return restored;
  }

  async request(
    path: string,
    options: ApiRequestOptions & { expectNoContent: true },
  ): Promise<void>;
  async request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T | void> {
    const { authentication = 'default', expectNoContent = false, ...requestOptions } = options;
    const headers: Record<string, string> = {
      ...((requestOptions.headers as Record<string, string>) ?? {}),
    };

    if (requestOptions.body !== undefined && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }

    const method = (requestOptions.method ?? 'GET').toUpperCase();
    if (path.startsWith('/auth/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = await this.ensureCsrfToken();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    if (authentication === 'default' && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const makeRequest = () =>
      fetch(`${this.baseUrl}${path}`, { ...requestOptions, headers, credentials: 'include' });

    const performRequest = async () => {
      try {
        return await makeRequest();
      } catch (error) {
        if (error instanceof DOMException && error['name'] === 'AbortError') {
          throw error;
        }
        throw new ApiError('Cannot reach the service. Check your connection and try again.', 0);
      }
    };

    let res = await performRequest();

    if (
      res.status === 401 &&
      authentication === 'default' &&
      path !== '/auth/login' &&
      path !== '/auth/register' &&
      path !== '/auth/refresh' &&
      path !== '/auth/forgot-password' &&
      path !== '/auth/reset-password'
    ) {
      const refreshed = await this.refreshSession();
      if (refreshed.token) {
        headers['Authorization'] = `Bearer ${refreshed.token}`;
        res = await performRequest();
      }
    }

    if (!res.ok) throw await this.parseError(res);
    if (res.status === 204 || expectNoContent) return;
    return res.json() as Promise<T>;
  }

  private async ensureCsrfToken(signal?: AbortSignal): Promise<string> {
    if (typeof window === 'undefined') {
      throw new ApiError('A security token can only be requested in the browser.', 503);
    }
    if (this.csrfToken) {
      return this.csrfToken;
    }
    if (this.csrfPromise && !this.csrfSignal?.aborted) {
      return this.csrfPromise;
    }

    const csrfPromise = (async () => {
      const csrfUrl = `${this.baseUrl}/auth/csrf`;
      const requestMode = new URL(csrfUrl).origin === window.location.origin ? 'same-origin' : 'cors';
      const response = await fetch(csrfUrl, {
        method: 'GET',
        credentials: 'include',
        mode: requestMode,
        ...(signal ? { signal } : {}),
      });
      signal?.throwIfAborted();
      if (!response.ok) {
        throw new ApiError('Could not establish a secure session. Try again.', response.status);
      }

      const payload: unknown = await response.json().catch(() => null);
      signal?.throwIfAborted();
      const csrfToken = isRecord(payload) && typeof payload['csrfToken'] === 'string'
        ? payload['csrfToken'].trim()
        : '';
      if (!csrfToken) {
        throw new ApiError('Could not establish a secure session. Try again.', 503);
      }

      this.csrfToken = csrfToken;
      return this.csrfToken;
    })().finally(() => {
      if (this.csrfPromise === csrfPromise) {
        this.csrfPromise = null;
        this.csrfSignal = undefined;
      }
    });

    this.csrfPromise = csrfPromise;
    this.csrfSignal = signal;
    return csrfPromise;
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

function isAuthSessionResponse(value: unknown): value is AuthSessionResponse {
  if (!isRecord(value) || !isRecord(value['user'])) return false;
  const user = value['user'];
  return (value['accessToken'] === undefined || typeof value['accessToken'] === 'string')
    && typeof user['id'] === 'string'
    && typeof user['username'] === 'string'
    && (user['displayName'] === null || typeof user['displayName'] === 'string')
    && (user['avatarUrl'] === null || typeof user['avatarUrl'] === 'string')
    && (user['role'] === 'USER' || user['role'] === 'MOD' || user['role'] === 'ADMIN')
    && typeof user['createdAt'] === 'string';
}
