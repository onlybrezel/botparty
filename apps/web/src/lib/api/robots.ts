import type { PublicRobotOverview, RobotOnboardingStatus, RobotPublic } from '@botparty/shared';
import type {
  AllowedUserRecord,
  RobotChatHistoryPage,
  RobotCameraIngress,
  RobotWebhookCreateResponse,
  RobotWebhookRecord,
  RobotManaged,
  RobotMutationInput,
  RobotTelemetryPoint,
  RoomAccessGrant,
} from '../api-types';
import type { RequestFn } from './types';

function buildQueryString(params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : '';
}

export class RobotsApi {
  constructor(private readonly req: RequestFn) {}

  async getRobots(params?: { status?: string; tag?: string; q?: string; sort?: string }) {
    return this.req<RobotPublic[]>(`/robots${buildQueryString(params)}`);
  }

  async getRobot(username: string, slug: string) {
    return this.req<RobotPublic>(`/robots/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  }

  async getRobotBySlug(slug: string) {
    return this.req<RobotPublic>(`/robots/${encodeURIComponent(slug)}`);
  }

  async getFeaturedRobots() {
    return this.req<RobotPublic[]>('/robots/featured');
  }

  async getRobotsOverview() {
    return this.req<PublicRobotOverview>('/robots/overview');
  }

  async getMyRobots() {
    return this.req<RobotManaged[]>('/robots/my');
  }

  async getOnboardingStatus(robotId: string) {
    return this.req<RobotOnboardingStatus>(`/robots/${robotId}/onboarding`);
  }

  async createRobot(data: RobotMutationInput) {
    return this.req<RobotManaged>('/robots', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRobot(id: string, data: RobotMutationInput) {
    return this.req<RobotManaged>(`/robots/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateRobotAsStaff(id: string, data: RobotMutationInput) {
    return this.req<RobotManaged>(`/robots/admin/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteRobot(id: string) {
    return this.req(`/robots/${id}`, { method: 'DELETE', expectNoContent: true });
  }

  async listRobotWebhooks(robotId: string) {
    return this.req<RobotWebhookRecord[]>(`/robots/${robotId}/webhooks`);
  }

  async createRobotWebhook(
    robotId: string,
    payload: { url: string; events: string[]; isActive?: boolean },
  ) {
    return this.req<RobotWebhookCreateResponse>(`/robots/${robotId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteRobotWebhook(robotId: string, webhookId: string) {
    return this.req(`/robots/${robotId}/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
      expectNoContent: true,
    });
  }

  async deleteRobotAsStaff(id: string) {
    return this.req(`/robots/admin/${id}`, { method: 'DELETE', expectNoContent: true });
  }

  async regenerateRobotToken(id: string) {
    return this.req<{ id: string; claimToken: string }>(`/robots/${id}/regenerate-token`, {
      method: 'POST',
    });
  }

  async regenerateRobotInviteCode(id: string) {
    return this.req<{ id: string; inviteCode: string }>(`/robots/${id}/regenerate-invite`, {
      method: 'POST',
    });
  }

  async ensureRobotInviteCode(id: string) {
    return this.req<{ id: string; inviteCode: string }>(`/robots/${id}/ensure-invite`, {
      method: 'POST',
    });
  }

  async getAllowedUsers(robotId: string) {
    return this.req<AllowedUserRecord[]>(`/robots/${robotId}/allowed-users`);
  }

  async addAllowedUser(robotId: string, username: string) {
    return this.req<AllowedUserRecord>(`/robots/${robotId}/allowed-users`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  async removeAllowedUser(robotId: string, userId: string) {
    return this.req(`/robots/${robotId}/allowed-users/${userId}`, {
      method: 'DELETE',
      expectNoContent: true,
    });
  }

  async getRobotIngressCameras(robotId: string) {
    return this.req<RobotCameraIngress[]>(`/robots/${robotId}/ingress-cameras`);
  }

  async createRobotIngressCamera(
    robotId: string,
    payload: { cameraId: string; label?: string; compatibilityMode?: boolean },
  ) {
    return this.req<RobotCameraIngress>(`/robots/${robotId}/ingress-cameras`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteRobotIngressCamera(robotId: string, ingressId: string) {
    return this.req(`/robots/${robotId}/ingress-cameras/${encodeURIComponent(ingressId)}`, {
      method: 'DELETE',
      expectNoContent: true,
    });
  }

  async uploadRobotThumbnail(robotId: string, dataUrl: string) {
    return this.req<RobotManaged>(`/robots/${robotId}/thumbnail`, {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    });
  }

  async deleteRobotThumbnail(robotId: string) {
    return this.req<RobotManaged>(`/robots/${robotId}/thumbnail`, {
      method: 'DELETE',
    });
  }

  async getPrivateRobot(username: string, slug: string) {
    return this.req<RobotPublic>(
      `/robots/private/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
    );
  }

  async getPrivateRobotBySlug(slug: string) {
    return this.req<RobotPublic>(`/robots/private/${encodeURIComponent(slug)}`);
  }

  async verifyRobotAccess(
    robotId: string,
    data?: { password?: string; guestSessionId?: string; inviteCode?: string },
  ) {
    return this.req<RoomAccessGrant>(`/robots/${robotId}/access/verify`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
  }

  async getRobotChatHistory(
    robotId: string,
    params?: { before?: number; beforeId?: string; limit?: number; roomAccessToken?: string; guestSessionId?: string },
  ) {
    return this.req<RobotChatHistoryPage>(`/robots/${robotId}/chat-messages${buildQueryString(params)}`);
  }

  async getViewerToken(robotId: string, control = false) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    return this.req<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer/${robotId}${buildQueryString({ control, roomAccessToken })}`,
      { method: 'POST', body: '{}' },
    );
  }

  async getPublicViewerToken(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    return this.req<{ token: string; livekitUrl: string }>(
      `/livekit/token/viewer-public/${robotId}${buildQueryString({ roomAccessToken, guestSessionId })}`,
      { method: 'POST', body: '{}' },
    );
  }

  async getPendingRobotActions(robotId: string) {
    return this.req<{ robotId: string; actions: Array<{ id: string; type: string; createdAt: number }> }>(
      `/robots/${robotId}/actions/pending`,
    );
  }

  async enqueueRobotAction(
    robotId: string,
    data: { type: 'restart_video' | 'restart_control' | 'restart_chat' | 'update_client' | 'set_log_stream'; durationSec?: number },
  ) {
    return this.req<{ id: string; type: string; createdAt: number; alreadyQueued?: boolean }>(`/robots/${robotId}/actions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getRobotLogs(robotId: string) {
    return this.req<{ logs: Array<{ ts: number; line: string }> }>(`/robots/${robotId}/logs`);
  }

  async getRobotTelemetry(robotId: string) {
    return this.req<{ latest: RobotTelemetryPoint | null; history: RobotTelemetryPoint[] }>(
      `/robots/${robotId}/telemetry`,
    );
  }
}
