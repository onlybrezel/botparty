import type { UserPublic } from '@botparty/shared';
import type { RequestFn } from './types';

export class UsersApi {
  constructor(private readonly req: RequestFn) {}

  async getMe() {
    return this.req<UserPublic>('/users/me');
  }

  async updateMe(data: { displayName?: string; avatarUrl?: string }) {
    return this.req<UserPublic>('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async exportMe() {
    return this.req<{
      exportedAt: string;
      profile: UserPublic & {
        email: string;
        balance: number;
        credits: number;
        emailVerified: boolean;
        robots: Array<Record<string, unknown>>;
        sessions: Array<Record<string, unknown>>;
        queueEntries: Array<Record<string, unknown>>;
      };
    }>('/users/me/export');
  }

  async deleteMe() {
    return this.req('/users/me', { method: 'DELETE', expectNoContent: true });
  }

  async getAdminUsers(params?: { q?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.limit) qs.set('limit', String(params.limit));
    return this.req<
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
    return this.req<
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
    return this.req(`/users/admin/${id}`, {
      method: 'DELETE',
      expectNoContent: true,
    });
  }

  async getUser(username: string) {
    return this.req<UserPublic>(`/users/${encodeURIComponent(username)}`);
  }
}
