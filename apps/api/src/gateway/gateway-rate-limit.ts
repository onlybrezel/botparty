import { LIMITS } from '@botparty/shared';
import { isStaffRole } from '../common/robot-access';
import type { WsClient } from './gateway-types';
import { WS_EVENT_TYPE_LIMITS } from './gateway-payloads';

export function checkWsEventRateLimit(client: WsClient, eventType = 'generic'): boolean {
  const now = Date.now();
  if (!client.wsEventWindowStart || now - client.wsEventWindowStart > LIMITS.WS_EVENT_RATE_WINDOW_MS) {
    client.wsEventWindowStart = now;
    client.wsEventCount = 1;
    client.wsEventTypeCounts = { [eventType]: 1 };
    return true;
  }

  client.wsEventCount = (client.wsEventCount ?? 0) + 1;
  client.wsEventTypeCounts = client.wsEventTypeCounts ?? {};
  client.wsEventTypeCounts[eventType] = (client.wsEventTypeCounts[eventType] ?? 0) + 1;
  const isPrivileged = client.isRobot || isStaffRole(client.role);
  const globalLimit = isPrivileged ? LIMITS.WS_EVENT_RATE_LIMIT_ADMIN : LIMITS.WS_EVENT_RATE_LIMIT;
  const bucket = WS_EVENT_TYPE_LIMITS[eventType] ?? WS_EVENT_TYPE_LIMITS.generic!;
  const bucketLimit = isPrivileged ? bucket.privileged : bucket.normal;
  return client.wsEventCount <= globalLimit && client.wsEventTypeCounts[eventType] <= bucketLimit;
}
