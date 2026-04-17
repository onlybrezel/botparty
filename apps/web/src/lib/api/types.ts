import type { UserPublic } from '@botparty/shared';

export type AuthSessionResponse = {
  accessToken: string;
  user: UserPublic;
};

export type ApiRequestOptions = RequestInit & {
  expectNoContent?: boolean;
};

export type RequestFn = {
  <T>(path: string, options?: ApiRequestOptions): Promise<T>;
  (path: string, options: ApiRequestOptions & { expectNoContent: true }): Promise<void>;
};
