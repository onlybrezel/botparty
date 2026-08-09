import { BadRequestException } from '@nestjs/common';
import type {
  GuestAccess,
  RobotAccessPolicy,
  RobotStreamCameraDescriptor,
  RobotStreamPolicy,
} from './robots.types';
import { mergeRobotMetadata, normalizeRobotMetadata } from './robot-metadata.schema';
import { normalizePublicRobotStatus, normalizePublicViewerCount } from './robot-public-state';
import { SLUG_PROFANITY_TERMS } from './profanity-terms';

const DEFAULT_ACCESS_POLICY: RobotAccessPolicy = {
  video: 'AUTHENTICATED',
  control: 'AUTHENTICATED',
  chat: 'AUTHENTICATED',
  estop: 'AUTHENTICATED',
};

const DEFAULT_STREAM_POLICY: RobotStreamPolicy = {
  targetBitrateKbps: null,
};

export const DEFAULT_ROBOT_CONTROLS = [
  { label: 'Forward', command: 'forward', hotKey: 'w', icon: '▲', position: 0 },
  { label: 'Left', command: 'left', hotKey: 'a', icon: '◀', position: 1 },
  { label: 'Back', command: 'backward', hotKey: 's', icon: '▼', position: 2 },
  { label: 'Right', command: 'right', hotKey: 'd', icon: '▶', position: 3 },
] as const;

const ROBOT_TEXT_PROFANITY_TERMS = Array.from(new Set(SLUG_PROFANITY_TERMS));

type RobotAclPatch = {
  video?: GuestAccess | undefined;
  control?: GuestAccess | undefined;
  chat?: GuestAccess | undefined;
  estop?: GuestAccess | undefined;
};

type RobotStreamPatch = {
  targetBitrateKbps?: number | undefined;
  activeCameraId?: string | undefined;
  cameras?: RobotStreamCameraDescriptor[] | undefined;
};

export function mergeRobotMetadataPatch(
  current: unknown,
  acl?: RobotAclPatch,
  stream?: RobotStreamPatch,
): Record<string, unknown> {
  return mergeRobotMetadata(current, {
    ...(acl ? { access: {
          ...DEFAULT_ACCESS_POLICY,
          ...acl,
        } } : {}),
    ...(stream ? { stream: {
          ...DEFAULT_STREAM_POLICY,
          ...stream,
        } } : {}),
  }) as Record<string, unknown>;
}

export function stripRobotWriteFields(data: {
  name?: string | undefined;
  description?: string | undefined;
  thumbnailUrl?: string | undefined;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | undefined;
  accessMode?: 'OPEN' | 'PASSWORD' | 'LINK_ONLY' | 'ALLOWED_USERS' | undefined;
  queueMode?: 'FIRST_COME' | 'VOTING' | 'DISABLED' | undefined;
  maxTurnTime?: number | undefined;
  maxViewers?: number | undefined;
  maxControllers?: number | undefined;
  tags?: string[] | undefined;
  scheduleStart?: string | null | undefined;
  scheduleEnd?: string | null | undefined;
  timezone?: string | undefined;
}) {
  return {
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(data.thumbnailUrl === undefined ? {} : { thumbnailUrl: data.thumbnailUrl }),
    ...(data.visibility === undefined ? {} : { visibility: data.visibility }),
    ...(data.accessMode === undefined ? {} : { accessMode: data.accessMode }),
    ...(data.queueMode === undefined ? {} : { queueMode: data.queueMode }),
    ...(data.maxTurnTime === undefined ? {} : { maxTurnTime: data.maxTurnTime }),
    ...(data.maxViewers === undefined ? {} : { maxViewers: data.maxViewers }),
    ...(data.maxControllers === undefined ? {} : { maxControllers: data.maxControllers }),
    ...(data.tags === undefined ? {} : { tags: data.tags }),
    ...(data.scheduleStart === undefined ? {} : { scheduleStart: data.scheduleStart }),
    ...(data.scheduleEnd === undefined ? {} : { scheduleEnd: data.scheduleEnd }),
    ...(data.timezone === undefined ? {} : { timezone: data.timezone }),
  };
}

export function withStreamKeyIssuedAt(metadata: unknown): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  base['streamKeyIssuedAt'] = new Date().toISOString();
  return base;
}

export function assertRobotTextAllowed(input: {
  name?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
}) {
  assertFieldModeration('name', input.name);
  assertFieldModeration('description', input.description);
  for (const tag of input.tags ?? []) {
    assertFieldModeration('tag', tag);
  }
}

function assertFieldModeration(field: 'name' | 'description' | 'tag', value?: string) {
  if (!value) {
    return;
  }

  const normalized = normalizeModerationText(value);
  if (!normalized) {
    return;
  }

  const compact = normalized.replace(/[\s_-]+/g, '');
  const blocked = ROBOT_TEXT_PROFANITY_TERMS.some((term) => normalized.includes(term) || compact.includes(term));
  if (!blocked) {
    return;
  }

  if (field === 'tag') {
    throw new BadRequestException('One or more tags are blocked by moderation policy');
  }

  throw new BadRequestException(`${field} blocked by moderation policy`);
}

function normalizeModerationText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeManagedRobot<
  T extends {
    accessPassword?: string | null;
    claimTokenHash?: string;
    streamKeyHash?: string;
  },
>(robot: T): Omit<T, 'claimTokenHash' | 'streamKeyHash'> & { claimToken: null; streamKey: null } {
  const { claimTokenHash: _claimTokenHash, streamKeyHash: _streamKeyHash, ...safeRobot } = robot;
  void _claimTokenHash;
  void _streamKeyHash;
  return {
    ...safeRobot,
    accessPassword: null,
    claimToken: null,
    streamKey: null,
  } as Omit<T, 'claimTokenHash' | 'streamKeyHash'> & { claimToken: null; streamKey: null };
}

export function toPublicRobot<
  T extends {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    thumbnailUrl: string | null;
    status: string;
    lastOnlineAt?: Date | null;
    visibility: string;
    accessMode: string;
    queueMode: string;
    scheduleStart?: Date | null;
    scheduleEnd?: Date | null;
    timezone?: string;
    maxTurnTime: number;
    maxViewers: number;
    maxControllers: number;
    metadata: unknown;
    recordSessions?: boolean;
    tags: string[];
    viewerCount: number;
    createdAt: Date;
    owner?: {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
  },
>(robot: T) {
  const baseMetadata = normalizeRobotMetadata(robot.metadata) ?? {};
  const metadata = robot.recordSessions
    ? {
        ...baseMetadata,
        recording: { ...(baseMetadata['recording'] ?? {}), enabled: true },
      }
    : baseMetadata;

  return {
    id: robot.id,
    name: robot.name,
    slug: robot.slug,
    description: robot.description,
    thumbnailUrl: robot.thumbnailUrl,
    visibility: robot.visibility,
    accessMode: robot.accessMode,
    queueMode: robot.queueMode,
    scheduleStart: robot.scheduleStart ? robot.scheduleStart.toISOString() : null,
    scheduleEnd: robot.scheduleEnd ? robot.scheduleEnd.toISOString() : null,
    timezone: robot.timezone ?? 'UTC',
    maxTurnTime: robot.maxTurnTime,
    maxViewers: robot.maxViewers,
    maxControllers: robot.maxControllers,
    metadata,
    tags: robot.tags,
    status: normalizePublicRobotStatus(
      robot.status,
      'lastOnlineAt' in robot ? (robot as { lastOnlineAt?: Date | null }).lastOnlineAt ?? null : null,
    ),
    viewerCount: normalizePublicViewerCount(
      robot.status,
      'lastOnlineAt' in robot ? (robot as { lastOnlineAt?: Date | null }).lastOnlineAt ?? null : null,
      robot.viewerCount,
    ),
    owner: robot.owner
      ? {
          id: robot.owner.id,
          username: robot.owner.username,
          displayName: robot.owner.displayName,
          avatarUrl: robot.owner.avatarUrl,
        }
      : {
          id: '',
          username: 'unknown',
          displayName: null,
          avatarUrl: null,
        },
    createdAt: robot.createdAt.toISOString(),
  } as const;
}

/**
 * Checks if a robot is currently within its scheduled time window.
 * If no schedule is set, returns true (always available).
 * If schedule is set, compares current time (converted to robot's timezone) against scheduleStart/End.
 */
export function isRobotInSchedule(robot: {
  scheduleStart: Date | null | undefined;
  scheduleEnd: Date | null | undefined;
  timezone: string | null | undefined;
}): boolean {
  if (!robot.scheduleStart || !robot.scheduleEnd) {
    return true; // No schedule set, always available
  }

  const start = robot.scheduleStart.getTime();
  const end = robot.scheduleEnd.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return false;
  }
  const now = Date.now();
  return now >= start && now <= end;
}
