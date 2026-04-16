import type { UserPublic } from '@botparty/shared';

export type AuthSessionResponse = {
  accessToken: string;
  user: UserPublic;
};

export type RequestFn = <T>(path: string, options?: RequestInit) => Promise<T>;
