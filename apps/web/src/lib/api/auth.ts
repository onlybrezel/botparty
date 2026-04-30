import type { RequestFn, AuthSessionResponse } from './types';

export class AuthApi {
  constructor(private readonly req: RequestFn) {}

  async register(data: { username: string; email: string; password: string; displayName?: string }) {
    return this.req<AuthSessionResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.req<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async refresh(refreshToken?: string) {
    return this.req<AuthSessionResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
  }

  async logout() {
    return this.req<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: '{}',
    });
  }

  async forgotPassword(email: string) {
    return this.req<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, password: string) {
    return this.req<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async verifyEmail(token: string) {
    return this.req<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  }

  async resendVerificationEmail(email: string) {
    return this.req<{ message: string }>('/auth/verify-email/resend', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }
}
