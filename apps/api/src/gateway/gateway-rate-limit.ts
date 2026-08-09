import { LIMITS } from '@botparty/shared';
import { isStaffRole } from '../common/robot-access';
import type { WsClient } from './gateway-types';
import { WS_EVENT_TYPE_LIMITS } from './gateway-payloads';

type SharedBucketState = {
  count: number;
  windowStart: number;
  typeCounts: Record<string, number>;
};

const sharedBuckets = new Map<string, SharedBucketState>();

function resolveSharedBucketKey(client: WsClient): string {
  if (client.isRobot && client.robotId) {
    return `robot:${client.robotId}`;
  }
  if (client.userId) {
    return `user:${client.userId}`;
  }
  if (client.remoteIp && client.remoteIp !== 'unknown') {
    return `ip:${client.remoteIp}`;
  }
  return `socket:${client.id}`;
}

function advanceBucket(
  current: SharedBucketState | undefined,
  now: number,
  eventType: string,
): SharedBucketState {
  if (!current || now - current.windowStart > LIMITS.WS_EVENT_RATE_WINDOW_MS) {
    return {
      count: 1,
      windowStart: now,
      typeCounts: { [eventType]: 1 },
    };
  }

  return {
    count: current.count + 1,
    windowStart: current.windowStart,
    typeCounts: {
      ...current.typeCounts,
      [eventType]: (current.typeCounts[eventType] ?? 0) + 1,
    },
  };
}

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
  const sharedKey = resolveSharedBucketKey(client);
  const nextSharedBucket = advanceBucket(sharedBuckets.get(sharedKey), now, eventType);
  sharedBuckets.set(sharedKey, nextSharedBucket);
  if (sharedBuckets.size > 10_000) {
    for (const [key, bucket] of sharedBuckets.entries()) {
      if (now - bucket.windowStart > LIMITS.WS_EVENT_RATE_WINDOW_MS * 2) {
        sharedBuckets.delete(key);
      }
    }
  }
  const isPrivileged = client.isRobot || isStaffRole(client.role);
  const globalLimit = isPrivileged ? LIMITS.WS_EVENT_RATE_LIMIT_ADMIN : LIMITS.WS_EVENT_RATE_LIMIT;
  const bucket = WS_EVENT_TYPE_LIMITS[eventType] ?? {
    normal: LIMITS.WS_EVENT_RATE_LIMIT,
    privileged: LIMITS.WS_EVENT_RATE_LIMIT_ADMIN,
  };
  const bucketLimit = isPrivileged ? bucket.privileged : bucket.normal;
  return client.wsEventCount <= globalLimit
    && client.wsEventTypeCounts[eventType] <= bucketLimit
    && nextSharedBucket.count <= globalLimit
    && (nextSharedBucket.typeCounts[eventType] ?? 0) <= bucketLimit;
}
