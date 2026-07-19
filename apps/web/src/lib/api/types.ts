import type { UserPublic } from '@botparty/shared';

export type AuthSessionResponse = {
  accessToken?: string;
  user: UserPublic;
  requiresEmailVerification?: boolean;
  message?: string;
};

export type ApiRequestOptions = RequestInit & {
  expectNoContent?: boolean;
  authentication?: 'default' | 'anonymous';
};

export type RequestFn = {
  <T>(path: string, options?: ApiRequestOptions): Promise<T>;
  (path: string, options: ApiRequestOptions & { expectNoContent: true }): Promise<void>;
};
