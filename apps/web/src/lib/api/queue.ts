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

export class QueueApi {
  constructor(private readonly req: RequestFn) {}

  async getQueue(robotId: string) {
    const roomAccessToken =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(`botparty.room-access.${robotId}`) : null;
    const guestSessionId =
      typeof window !== 'undefined' ? window.localStorage.getItem('botparty.guestSessionId.v1') : null;
    const rows = await this.req<
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
    return this.req<{ position: number }>(`/queue/${robotId}/join`, {
      method: 'POST',
      body: JSON.stringify(roomAccessToken ? { roomAccessToken } : {}),
    });
  }

  async leaveQueue(robotId: string) {
    return this.req(`/queue/${robotId}/leave`, { method: 'DELETE', expectNoContent: true });
  }

  async voteQueue(robotId: string, targetUserId: string, roomAccessToken?: string | null) {
    return this.req<{ userId: string; votes: number }>(`/queue/${robotId}/vote/${targetUserId}`, {
      method: 'POST',
      body: JSON.stringify(roomAccessToken ? { roomAccessToken } : {}),
    });
  }
}
