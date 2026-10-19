import type * as SchemaModule from '@botparty/shared/schemas/auth';

export type AuthSchemas = typeof SchemaModule;

export function loadAuthSchemas(): Promise<AuthSchemas> {
  return import('@botparty/shared/schemas/auth');
}
