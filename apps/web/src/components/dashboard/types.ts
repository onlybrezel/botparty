import type { ControlButtonRecord } from '@/lib/api';
import type { RobotManaged } from '@/lib/api';
import type { ControlButtonAccess } from '@botparty/shared';
import { ControlButtonAccess as ControlButtonAccessEnum, isValidTimezone } from '@botparty/shared';

export type RemoteActionType =
  | 'restart_video'
  | 'restart_control'
  | 'restart_chat'
  | 'update_client'
  | 'set_log_stream';

export type ControlPresetKey = 'ptz-pan' | 'ptz-tilt' | 'drive-speed' | 'gripper' | 'arm-xy';

export type RoomMode = 'PUBLIC' | 'UNLISTED' | 'LINK_ONLY' | 'PASSWORD' | 'ALLOWED_USERS' | 'PRIVATE';

export type ControlButtonDraft = {
  label: string;
  command: string;
  hotKey: string;
  icon: string;
  controlKind: 'button' | 'slider' | 'xy';
  sliderMin: string;
  sliderMax: string;
  sliderStart: string;
  sliderStep: string;
  sliderDirection: 'horizontal' | 'vertical';
  widgetReturn: 'none' | 'center';
  resetOnQueueLoss: boolean;
  resetOnOffline: boolean;
  resetAfterMs: string;
  xyXMin: string;
  xyXMax: string;
  xyXStart: string;
  xyYMin: string;
  xyYMax: string;
  xyYStart: string;
  cooldownMs: string;
  costCredits: string;
  access: ControlButtonAccess;
  color: string;
};

export type RobotFormState = {
  name: string;
  slug: string;
  description: string;
  thumbnailUrl: string;
  roomMode: RoomMode;
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  aclVideo: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclControl: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclChat: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclEStop: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  targetBitrateKbps: string;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  timezone: string;
  maxTurnTime: number;
  maxViewers: number;
  maxControllers: number;
  tags: string;
  accessPassword: string;
};

function detectDefaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function toLocalDateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export const LOCAL_SETTINGS_KEY = 'botparty.settings.v1';

export const DEFAULT_CREATE_FORM: RobotFormState = {
  name: '',
  slug: '',
  description: '',
  thumbnailUrl: '',
  roomMode: 'PRIVATE',
  queueMode: 'FIRST_COME',
  aclVideo: 'AUTHENTICATED',
  aclControl: 'AUTHENTICATED',
  aclChat: 'AUTHENTICATED',
  aclEStop: 'AUTHENTICATED',
  targetBitrateKbps: '1800',
  scheduleEnabled: false,
  scheduleStart: '',
  scheduleEnd: '',
  timezone: detectDefaultTimezone(),
  maxTurnTime: 60000,
  maxViewers: 1000,
  maxControllers: 10,
  tags: '',
  accessPassword: '',
};

export const DEFAULT_CONTROL_DRAFT: ControlButtonDraft = {
  label: '',
  command: '',
  hotKey: '',
  icon: '',
  controlKind: 'button',
  sliderMin: '-100',
  sliderMax: '100',
  sliderStart: '0',
  sliderStep: '1',
  sliderDirection: 'horizontal',
  widgetReturn: 'none',
  resetOnQueueLoss: false,
  resetOnOffline: true,
  resetAfterMs: '',
  xyXMin: '-100',
  xyXMax: '100',
  xyXStart: '0',
  xyYMin: '-100',
  xyYMax: '100',
  xyYStart: '0',
  cooldownMs: '200',
  costCredits: '0',
  access: ControlButtonAccessEnum.QUEUE_TURN,
  color: '',
};

export const accessModeOptions: Array<{
  value: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  title: string;
  description: string;
}> = [
  { value: 'ALL', title: 'Everyone', description: 'Guests and signed-in users can access this' },
  { value: 'AUTHENTICATED', title: 'Signed-in users only', description: 'Requires an account login' },
  { value: 'DISABLED', title: 'Disabled', description: 'Function is disabled' },
];

export const controlAccessOptions: Array<{ value: ControlButtonAccess; label: string }> = [
  { value: ControlButtonAccessEnum.EVERYONE, label: 'Everyone (guests + signed-in)' },
  { value: ControlButtonAccessEnum.QUEUE_TURN, label: 'Current turn' },
  { value: ControlButtonAccessEnum.MODERATOR, label: 'Moderator' },
  { value: ControlButtonAccessEnum.OWNER, label: 'Owner' },
];

export const DASHBOARD_SECTIONS = [
  { id: 'section-settings', label: 'Settings' },
  { id: 'section-token', label: 'Token & Links' },
  { id: 'section-controls', label: 'Controls' },
  { id: 'section-operations', label: 'Operations' },
  { id: 'section-webhooks', label: 'Webhooks' },
  { id: 'section-monitoring', label: 'Monitoring' },
] as const;

export const CONTROL_PRESETS: Array<{ key: ControlPresetKey; label: string }> = [
  { key: 'ptz-pan', label: 'PTZ Pan (Horizontal slider)' },
  { key: 'ptz-tilt', label: 'PTZ Tilt (Vertical slider)' },
  { key: 'drive-speed', label: 'Drive Speed (0..100 slider)' },
  { key: 'gripper', label: 'Gripper (Center slider)' },
  { key: 'arm-xy', label: 'Arm XY Pad' },
];

export function applyControlPreset(draft: ControlButtonDraft, preset: ControlPresetKey): ControlButtonDraft {
  const base = {
    ...draft,
    icon: '',
    resetAfterMs: '',
    resetOnQueueLoss: false,
    resetOnOffline: true,
    widgetReturn: 'none' as const,
  };

  switch (preset) {
    case 'ptz-pan':
      return { ...base, label: base.label || 'Pan', command: base.command || 'ptz_pan', controlKind: 'slider', sliderMin: '-100', sliderMax: '100', sliderStart: '0', sliderStep: '1', sliderDirection: 'horizontal' };
    case 'ptz-tilt':
      return { ...base, label: base.label || 'Tilt', command: base.command || 'ptz_tilt', controlKind: 'slider', sliderMin: '-100', sliderMax: '100', sliderStart: '0', sliderStep: '1', sliderDirection: 'vertical' };
    case 'drive-speed':
      return { ...base, label: base.label || 'Speed', command: base.command || 'set_speed', controlKind: 'slider', sliderMin: '0', sliderMax: '100', sliderStart: '50', sliderStep: '1', sliderDirection: 'horizontal' };
    case 'gripper':
      return { ...base, label: base.label || 'Gripper', command: base.command || 'gripper', controlKind: 'slider', sliderMin: '-100', sliderMax: '100', sliderStart: '0', sliderStep: '1', sliderDirection: 'horizontal', widgetReturn: 'center' };
    case 'arm-xy':
      return { ...base, label: base.label || 'Arm XY', command: base.command || 'arm_xy', controlKind: 'xy', xyXMin: '-100', xyXMax: '100', xyXStart: '0', xyYMin: '-100', xyYMax: '100', xyYStart: '0' };
  }
}

export function detectRoomMode(robot: { visibility: string; accessMode: string }): RoomMode {
  if (robot.visibility === 'PRIVATE') return 'PRIVATE';
  if (robot.visibility === 'UNLISTED' && robot.accessMode === 'OPEN') return 'UNLISTED';
  if (robot.accessMode === 'ALLOWED_USERS') return 'ALLOWED_USERS';
  if (robot.accessMode === 'LINK_ONLY') return 'LINK_ONLY';
  if (robot.accessMode === 'PASSWORD') return 'PASSWORD';
  return 'PUBLIC';
}

export function roomModeToFields(mode: RoomMode): {
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  accessMode: 'OPEN' | 'PASSWORD' | 'LINK_ONLY' | 'ALLOWED_USERS';
} {
  switch (mode) {
    case 'PUBLIC': return { visibility: 'PUBLIC', accessMode: 'OPEN' };
    case 'UNLISTED': return { visibility: 'UNLISTED', accessMode: 'OPEN' };
    case 'LINK_ONLY': return { visibility: 'UNLISTED', accessMode: 'LINK_ONLY' };
    case 'PASSWORD': return { visibility: 'PUBLIC', accessMode: 'PASSWORD' };
    case 'ALLOWED_USERS': return { visibility: 'UNLISTED', accessMode: 'ALLOWED_USERS' };
    case 'PRIVATE': return { visibility: 'PRIVATE', accessMode: 'OPEN' };
  }
}

export function queueModeDescription(mode: RobotFormState['queueMode']): string {
  if (mode === 'VOTING') return 'Viewers can vote who should control next. The highest-voted person takes the next turn.';
  if (mode === 'DISABLED') return 'There is no queue. Controls are handled without turn rotation.';
  return 'First come, first served. The next person in line gets control when the current turn ends.';
}

export function toUpdatePayload(form: RobotFormState) {
  const bitrate = Number(form.targetBitrateKbps);
  const hasBitrate = Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 3000;
  const { visibility, accessMode } = roomModeToFields(form.roomMode);
  const scheduleStart = form.scheduleEnabled ? toIsoDateTime(form.scheduleStart) : null;
  const scheduleEnd = form.scheduleEnabled ? toIsoDateTime(form.scheduleEnd) : null;

  return {
    name: form.name.trim(),
    slug: form.slug.trim() || undefined,
    description: form.description.trim() || undefined,
    thumbnailUrl: form.thumbnailUrl.trim() || undefined,
    visibility,
    accessMode,
    queueMode: form.queueMode,
    acl: {
      video: form.aclVideo,
      control: form.aclControl,
      chat: form.aclChat,
      estop: form.aclEStop,
    },
    stream: {
      targetBitrateKbps: hasBitrate ? Math.round(bitrate) : undefined,
    },
    scheduleStart,
    scheduleEnd,
    timezone: form.timezone.trim() || detectDefaultTimezone(),
    maxTurnTime: Number(form.maxTurnTime),
    maxViewers: Number(form.maxViewers),
    maxControllers: Number(form.maxControllers),
    tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    accessPassword: form.accessPassword.trim() || undefined,
  };
}

export function validateRobotFormSchedule(form: RobotFormState) {
  if (!form.scheduleEnabled) {
    return null;
  }

  if (!form.scheduleStart || !form.scheduleEnd) {
    return 'Select both a schedule start and end time.';
  }

  const scheduleStart = Date.parse(form.scheduleStart);
  const scheduleEnd = Date.parse(form.scheduleEnd);
  if (Number.isNaN(scheduleStart) || Number.isNaN(scheduleEnd)) {
    return 'Schedule dates must be valid.';
  }

  if (scheduleEnd <= scheduleStart) {
    return 'Schedule end must be later than the start time.';
  }

  if (!form.timezone.trim()) {
    return 'Timezone is required when scheduling is enabled.';
  }

  if (!isValidTimezone(form.timezone)) {
    return 'Timezone must be a valid IANA timezone.';
  }

  return null;
}

export function formFromRobot(robot: RobotManaged): RobotFormState {
  const access = robot.metadata?.access;
  const stream = robot.metadata?.stream;
  const scheduleEnabled = Boolean(robot.scheduleStart && robot.scheduleEnd);

  return {
    name: robot.name,
    slug: robot.slug,
    description: robot.description ?? '',
    thumbnailUrl: robot.thumbnailUrl ?? '',
    roomMode: detectRoomMode(robot),
    queueMode: robot.queueMode,
    aclVideo: access?.video ?? 'AUTHENTICATED',
    aclControl: access?.control ?? 'AUTHENTICATED',
    aclChat: access?.chat ?? 'AUTHENTICATED',
    aclEStop: access?.estop ?? 'AUTHENTICATED',
    targetBitrateKbps: typeof stream?.targetBitrateKbps === 'number' ? String(stream.targetBitrateKbps) : '',
    scheduleEnabled,
    scheduleStart: toLocalDateTimeInput(robot.scheduleStart),
    scheduleEnd: toLocalDateTimeInput(robot.scheduleEnd),
    timezone: robot.timezone ?? detectDefaultTimezone(),
    maxTurnTime: robot.maxTurnTime,
    maxViewers: robot.maxViewers,
    maxControllers: robot.maxControllers,
    tags: robot.tags.join(', '),
    accessPassword: '',
  };
}

export function buildWidgetSpec(draft: ControlButtonDraft): string | undefined {
  if (draft.controlKind === 'button') return draft.icon.trim() || undefined;

  const resetAfterMs = Number(draft.resetAfterMs);
  const ttl = Number.isFinite(resetAfterMs) && resetAfterMs >= 100 ? String(Math.round(resetAfterMs)) : null;

  if (draft.controlKind === 'slider') {
    return [
      'widget:s',
      `min=${Number(draft.sliderMin)}`,
      `max=${Number(draft.sliderMax)}`,
      `start=${Number(draft.sliderStart)}`,
      `step=${Number(draft.sliderStep)}`,
      `dir=${draft.sliderDirection === 'vertical' ? 'v' : 'h'}`,
      `r=${draft.widgetReturn === 'center' ? 'c' : 'n'}`,
      `rq=${draft.resetOnQueueLoss ? 1 : 0}`,
      `ro=${draft.resetOnOffline ? 1 : 0}`,
      ttl ? `ttl=${ttl}` : null,
    ].filter((entry): entry is string => Boolean(entry)).join(':');
  }

  return [
    'widget:xy',
    `xn=${Number(draft.xyXMin)}`,
    `xx=${Number(draft.xyXMax)}`,
    `x0=${Number(draft.xyXStart)}`,
    `yn=${Number(draft.xyYMin)}`,
    `yx=${Number(draft.xyYMax)}`,
    `y0=${Number(draft.xyYStart)}`,
    `r=${draft.widgetReturn === 'center' ? 'c' : 'n'}`,
    `rq=${draft.resetOnQueueLoss ? 1 : 0}`,
    `ro=${draft.resetOnOffline ? 1 : 0}`,
    ttl ? `ttl=${ttl}` : null,
  ].filter((entry): entry is string => Boolean(entry)).join(':');
}

export function draftFromControl(button: ControlButtonRecord): ControlButtonDraft {
  const draft: ControlButtonDraft = {
    ...DEFAULT_CONTROL_DRAFT,
    label: button.label,
    command: button.command,
    hotKey: button.hotKey ?? '',
    cooldownMs: String(button.cooldownMs),
    costCredits: String(button.costCredits ?? 0),
    access: button.access,
    color: button.color ?? '',
  };

  const icon = button.icon ?? '';
  if (!icon.startsWith('widget:')) {
    draft.icon = icon;
    draft.controlKind = 'button';
    return draft;
  }

  const parts = icon.split(':').map((part: string) => part.trim()).filter(Boolean);
  const kind = parts[1]?.toLowerCase();
  const kv = new Map<string, string>();
  for (const segment of parts.slice(2)) {
    const idx = segment.indexOf('=');
    if (idx <= 0) continue;
    kv.set(segment.slice(0, idx).toLowerCase(), segment.slice(idx + 1));
  }

  const get = (keys: string[], fallback: string) => {
    for (const key of keys) {
      const found = kv.get(key);
      if (found !== undefined) return found;
    }
    return fallback;
  };

  draft.widgetReturn = get(['r', 'return'], 'n').toLowerCase() === 'c' ? 'center' : 'none';
  draft.resetOnQueueLoss = get(['rq'], '0') === '1';
  draft.resetOnOffline = get(['ro'], '1') !== '0';
  draft.resetAfterMs = get(['ttl'], '');

  if (kind === 's' || kind === 'slider') {
    draft.controlKind = 'slider';
    draft.sliderMin = get(['min'], '-100');
    draft.sliderMax = get(['max'], '100');
    draft.sliderStart = get(['start', 'v0', 'c'], '0');
    draft.sliderStep = get(['step'], '1');
    draft.sliderDirection = get(['dir'], 'h').toLowerCase() === 'v' ? 'vertical' : 'horizontal';
    return draft;
  }

  draft.controlKind = 'xy';
  draft.xyXMin = get(['xn', 'xmin'], '-100');
  draft.xyXMax = get(['xx', 'xmax'], '100');
  draft.xyXStart = get(['x0', 'xstart'], '0');
  draft.xyYMin = get(['yn', 'ymin'], '-100');
  draft.xyYMax = get(['yx', 'ymax'], '100');
  draft.xyYStart = get(['y0', 'ystart'], '0');
  return draft;
}
