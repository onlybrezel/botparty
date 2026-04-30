import type { UserSessionDetail, UserSessionRecord } from '../api-types';
import type { RequestFn } from './types';

export class SessionsApi {
  constructor(private readonly req: RequestFn) {}

  async getMySessions(limit = 50) {
    return this.req<UserSessionRecord[]>(`/sessions/my?limit=${encodeURIComponent(String(limit))}`);
  }

  async getMySession(sessionId: string) {
    return this.req<UserSessionDetail>(`/sessions/my/${encodeURIComponent(sessionId)}`);
  }
}
