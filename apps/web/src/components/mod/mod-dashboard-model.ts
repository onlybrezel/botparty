import { isValidTimezone } from '@botparty/shared';
import type { api } from '@/lib/api';
import { detectRoomMode } from './utils';

export type StaffUser = {
  id: string;
  username: string;
  displayName: string | null;
  email?: string;
  role: 'ADMIN' | 'MOD' | 'USER';
  isActive: boolean;
  credits?: number;
  balance?: number;
  lastLoginAt?: string | null;
};

export type UserDraft = {
  username: string;
  email: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'MOD' | 'USER';
  isActive: boolean;
  credits: string;
  balance: string;
};

export type RobotDraft = {
  name: string;
  slug: string;
  description: string;
  roomMode: 'PUBLIC' | 'LINK_ONLY' | 'PASSWORD' | 'ALLOWED_USERS' | 'PRIVATE';
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  timezone: string;
  aclVideo: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclControl: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclChat: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclEStop: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  targetBitrateKbps: string;
  maxTurnTime: string;
  maxViewers: string;
  maxControllers: string;
  tags: string;
  accessPassword: string;
};

export type ModView = 'moderation' | 'runtime' | 'robots' | 'users';

export type AdminRecording = Awaited<ReturnType<typeof api.moderation.listAdminRecordings>>[number];

function parseCompactRecordingTime(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseRecordingMeta(file: Pick<AdminRecording, 'fileName' | 'robotId' | 'modifiedAt' | 'cameraId' | 'recordedAt'>) {
  if (file.cameraId || file.recordedAt) {
    return {
      robotId: file.robotId,
      cameraId: file.cameraId ?? null,
      recordedAt: file.recordedAt ? new Date(file.recordedAt) : null,
    };
  }

  const nameWithoutExt = file.fileName.replace(/\.mp4$/i, '');
  const strict = nameWithoutExt.match(/^robot-([0-9a-f-]{36})(?:-([a-zA-Z0-9._-]+))?-(\d{4}-\d{2}-\d{2}T\d{6})$/i);
  if (strict) {
    const [, robotIdFromName, cameraIdRaw, compactTime] = strict;
    return {
      robotId: file.robotId ?? robotIdFromName,
      cameraId: cameraIdRaw ? cameraIdRaw.replace(/^camera[-_]?/i, '') : null,
      recordedAt: compactTime ? parseCompactRecordingTime(compactTime) : null,
    };
  }

  const fallbackTimeToken = nameWithoutExt.match(/(\d{4}-\d{2}-\d{2}T\d{6})(?!.*\d{4}-\d{2}-\d{2}T\d{6})/)?.[1] ?? null;
  const cameraMatch = nameWithoutExt.match(/(?:^|[-_])(camera|cam|stream)[-_]?([a-zA-Z0-9._-]+)/i);
  return {
    robotId: file.robotId,
    cameraId: cameraMatch?.[2] ?? null,
    recordedAt: fallbackTimeToken ? parseCompactRecordingTime(fallbackTimeToken) : null,
  };
}

export const detectDefaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function toLocalDateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIsoDateTime(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateRobotDraftSchedule(draft: RobotDraft) {
  if (!draft.scheduleEnabled) return null;
  if (!draft.scheduleStart || !draft.scheduleEnd) return 'Select both a schedule start and end time.';
  const start = Date.parse(draft.scheduleStart);
  const end = Date.parse(draft.scheduleEnd);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'Schedule dates must be valid.';
  if (end <= start) return 'Schedule end must be later than the start time.';
  if (!draft.timezone.trim()) return 'Timezone is required when scheduling is enabled.';
  if (!isValidTimezone(draft.timezone)) return 'Timezone must be a valid IANA timezone.';
  return null;
}

export function createRobotDraft(
  robot: NonNullable<Awaited<ReturnType<typeof api.moderation.getModerationOverview>>['robots']>[number],
): RobotDraft {
  const access = robot.metadata?.access;
  const stream = robot.metadata?.stream;
  return {
    name: robot.name,
    slug: robot.slug,
    description: robot.description ?? '',
    roomMode: detectRoomMode(robot),
    queueMode: robot.queueMode,
    scheduleEnabled: Boolean(robot.scheduleStart && robot.scheduleEnd),
    scheduleStart: toLocalDateTimeInput(robot.scheduleStart),
    scheduleEnd: toLocalDateTimeInput(robot.scheduleEnd),
    timezone: robot.timezone || detectDefaultTimezone(),
    aclVideo: access?.video ?? 'AUTHENTICATED',
    aclControl: access?.control ?? 'AUTHENTICATED',
    aclChat: access?.chat ?? 'AUTHENTICATED',
    aclEStop: access?.estop ?? 'AUTHENTICATED',
    targetBitrateKbps: typeof stream?.targetBitrateKbps === 'number' ? String(stream.targetBitrateKbps) : '',
    maxTurnTime: String(robot.maxTurnTime),
    maxViewers: String(robot.maxViewers),
    maxControllers: String(robot.maxControllers),
    tags: robot.tags.join(', '),
    accessPassword: '',
  };
}
