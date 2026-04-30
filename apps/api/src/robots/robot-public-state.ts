export type PublicRobotStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';

export function staleRobotCutoff(): Date {
  return new Date(Date.now() - 45_000);
}

export function normalizePublicRobotStatus(
  status: string,
  lastOnlineAt: Date | null | undefined,
): PublicRobotStatus {
  if ((status === 'ONLINE' || status === 'BUSY') && (!lastOnlineAt || lastOnlineAt < staleRobotCutoff())) {
    return 'OFFLINE';
  }
  if (status === 'ONLINE' || status === 'OFFLINE' || status === 'BUSY' || status === 'MAINTENANCE') {
    return status;
  }
  return 'OFFLINE';
}

export function normalizePublicViewerCount(
  status: string,
  lastOnlineAt: Date | null | undefined,
  viewerCount: number,
) {
  return normalizePublicRobotStatus(status, lastOnlineAt) === 'OFFLINE' ? 0 : Math.max(0, viewerCount);
}

export function toCount(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}
