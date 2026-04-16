import type { RobotStreamCameraConfig } from '@botparty/shared';
import type {
  ActiveSessionRecord,
  AdminRecordingFile,
  AdminRobotRecordingStatus,
  ModRuntimeOverview,
} from '../api-types';
import type { RequestFn } from './types';

export class ModerationApi {
  constructor(
    private readonly req: RequestFn,
    private readonly baseUrl: string,
  ) {}

  async moderateRobotUser(
    robotId: string,
    data: {
      targetUserId: string;
      action: 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'WARN';
      reason?: string;
      durationSec?: number;
    },
  ) {
    return this.req<{ id?: string; action?: string; userId?: string }>(`/moderation/robot/${robotId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getModerationOverview(robotId?: string) {
    const qs = robotId ? `?robotId=${encodeURIComponent(robotId)}` : '';
    return this.req<{
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
        thumbnailUrl: string | null;
        visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
        accessMode: 'OPEN' | 'PASSWORD' | 'LINK_ONLY' | 'ALLOWED_USERS';
        queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
        maxTurnTime: number;
        maxViewers: number;
        maxControllers: number;
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
        tags: string[];
        owner: { id: string; username: string; displayName: string | null };
      }>;
      counts: { bans: number; timeouts: number; kicks: number };
    }>(`/moderation/admin/overview${qs}`);
  }

  async getModRuntimeOverview() {
    return this.req<ModRuntimeOverview>('/moderation/admin/runtime-overview');
  }

  async getRobotProfanityOverview(robotId: string) {
    return this.req<{
      total: number;
      byUser: Array<{ userId: string; count: number }>;
      events: Array<{ ts: number; userId: string; username: string; content: string }>;
    }>(`/moderation/robot/${robotId}/profanity`);
  }

  async getGlobalProfanityOverview() {
    return this.req<{
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

  async enqueueStaffRobotAction(
    robotId: string,
    data: { type: 'restart_video' | 'restart_control' | 'restart_chat' | 'update_client' | 'set_log_stream'; durationSec?: number },
  ) {
    return this.req<{ id: string; type: string; createdAt: number; alreadyQueued?: boolean }>(
      `/moderation/admin/robot/${robotId}/actions`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  async getAdminRobotRecordingStatus(robotId: string) {
    return this.req<AdminRobotRecordingStatus>(`/moderation/admin/robot/${robotId}/recording`);
  }

  async startAdminRobotRecording(robotId: string) {
    return this.req<AdminRobotRecordingStatus>(`/moderation/admin/robot/${robotId}/recording/start`, {
      method: 'POST',
      body: '{}',
    });
  }

  async stopAdminRobotRecording(robotId: string) {
    return this.req<AdminRobotRecordingStatus>(`/moderation/admin/robot/${robotId}/recording/stop`, {
      method: 'POST',
      body: '{}',
    });
  }

  async listAdminRecordings() {
    return this.req<AdminRecordingFile[]>('/moderation/admin/recordings');
  }

  getAdminRecordingStreamUrl(fileName: string) {
    const encoded = encodeURIComponent(fileName);
    return `${this.baseUrl}/moderation/admin/recordings/${encoded}`;
  }

  async getActiveSession(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    const qs = new URLSearchParams();
    if (roomAccessToken) qs.set('roomAccessToken', roomAccessToken);
    if (guestSessionId) qs.set('guestSessionId', guestSessionId);
    const qstr = qs.toString() ? `?${qs.toString()}` : '';
    return this.req<ActiveSessionRecord | null>(`/sessions/robot/${robotId}/active${qstr}`);
  }
}
