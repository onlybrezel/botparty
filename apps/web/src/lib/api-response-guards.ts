import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value['every']((entry) => typeof entry === 'string');

const isRobotStatus = (value: unknown): value is RobotPublic['status'] =>
  value === 'ONLINE' || value === 'OFFLINE' || value === 'BUSY' || value === 'MAINTENANCE';

const isQueueMode = (value: unknown): value is RobotPublic['queueMode'] =>
  value === 'FIRST_COME' || value === 'VOTING' || value === 'DISABLED';

function isOwner(value: unknown): value is RobotPublic['owner'] {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['username'] === 'string'
    && (value['displayName'] === null || typeof value['displayName'] === 'string')
    && (value['avatarUrl'] === null || typeof value['avatarUrl'] === 'string');
}

export function isRobotPublic(value: unknown): value is RobotPublic {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && typeof value['slug'] === 'string'
    && (value['description'] === null || typeof value['description'] === 'string')
    && (value['thumbnailUrl'] === null || typeof value['thumbnailUrl'] === 'string')
    && isRobotStatus(value['status'])
    && (value['visibility'] === 'PUBLIC' || value['visibility'] === 'UNLISTED' || value['visibility'] === 'PRIVATE')
    && (value['accessMode'] === 'OPEN' || value['accessMode'] === 'PASSWORD' || value['accessMode'] === 'ALLOWED_USERS' || value['accessMode'] === 'LINK_ONLY')
    && isQueueMode(value['queueMode'])
    && typeof value['maxTurnTime'] === 'number'
    && typeof value['maxViewers'] === 'number'
    && typeof value['maxControllers'] === 'number'
    && isStringArray(value['tags'])
    && typeof value['viewerCount'] === 'number'
    && isOwner(value['owner'])
    && typeof value['createdAt'] === 'string';
}

function isOverviewRobot(value: unknown, includeQueueMode: boolean): boolean {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && typeof value['slug'] === 'string'
    && isRobotStatus(value['status'])
    && typeof value['viewerCount'] === 'number'
    && isStringArray(value['tags'])
    && isRecord(value['owner'])
    && typeof value['owner']['username'] === 'string'
    && (value['owner']['displayName'] === null || typeof value['owner']['displayName'] === 'string')
    && (!includeQueueMode || isQueueMode(value['queueMode']));
}

export function isPublicRobotOverview(value: unknown): value is PublicRobotOverview {
  if (!isRecord(value) || !isRecord(value['totals']) || !isRecord(value['statusBreakdown'])) return false;
  const totals = value['totals'];
  const statusBreakdown = value['statusBreakdown'];
  const totalKeys = ['publicRobots', 'liveRobots', 'featuredRobots', 'totalViewers', 'queueEntries'];
  const statusKeys = ['online', 'busy', 'offline', 'maintenance'];
  return totalKeys.every((key) => typeof totals[key] === 'number')
    && statusKeys.every((key) => typeof statusBreakdown[key] === 'number')
    && Array.isArray(value['featured'])
    && value['featured'].every((entry) => isOverviewRobot(entry, false))
    && Array.isArray(value['liveNow'])
    && value['liveNow'].every((entry) => isOverviewRobot(entry, true))
    && Array.isArray(value['topTags'])
    && value['topTags'].every((entry) => isRecord(entry) && typeof entry['tag'] === 'string' && typeof entry['count'] === 'number');
}

export function parseJsonArray<T>(value: unknown, guard: (entry: unknown) => entry is T): T[] {
  return Array.isArray(value) ? value['filter'](guard) : [];
}
