export const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value > 0 && value < 1) return '<1%';
  if (value < 10) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
};

export const formatAge = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value < 60) return `${value}s ago`;
  if (value < 3600) return `${Math.floor(value / 60)}m ago`;
  return `${Math.floor(value / 3600)}h ago`;
};

export const formatBitrate = (value: number | null | undefined) => {
  if (typeof value !== 'number') return '-';
  if (value <= 0) return '0 kbps';
  if (value >= 1000) return `${(value / 1000).toFixed(1)} Mbps`;
  return `${value.toFixed(value < 10 ? 1 : 0)} kbps`;
};

export const formatBytes = (value: number | null | undefined) => {
  if (typeof value !== 'number' || value <= 0) return '-';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

export const formatUptime = (value: number | null | undefined) => {
  if (typeof value !== 'number' || value < 0) return '-';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export const formatDurationClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

export const formatClientBuild = (
  telemetry:
    | {
        clientVersion: string | null;
        botpartyStreamerVersion?: string | null;
        gitBranch: string | null;
        gitCommit: string | null;
        gitDirty: boolean;
      }
    | null
    | undefined,
) => {
  if (!telemetry) return '-';
  const parts: string[] = [];
  if (telemetry.clientVersion) parts.push(`v${telemetry.clientVersion}`);
  if (telemetry.gitBranch) parts.push(telemetry.gitBranch);
  if (telemetry.gitCommit) parts.push(telemetry.gitCommit);
  if (telemetry.gitDirty) parts.push('dirty');
  return parts.length > 0 ? parts.join(' • ') : '-';
};

export const statusClassName = (status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE') => {
  switch (status) {
    case 'ONLINE':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'BUSY':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'MAINTENANCE':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    default:
      return 'border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]';
  }
};

export const baseButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition duration-200 hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100';

export const secondaryButtonClass = `${baseButtonClass} border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]`;
export const primaryButtonClass = `${baseButtonClass} border-sky-400/40 bg-sky-500/10 text-sky-200`;
export const successButtonClass = `${baseButtonClass} border-emerald-500/40 bg-emerald-500/10 text-emerald-200`;
export const dangerButtonClass = `${baseButtonClass} border-red-500/40 bg-red-500/10 text-red-200`;

export function detectRoomMode(robot: { visibility: string; accessMode: string }) {
  if (robot.visibility === 'PRIVATE') return 'PRIVATE' as const;
  if (robot.accessMode === 'ALLOWED_USERS') return 'ALLOWED_USERS' as const;
  if (robot.accessMode === 'LINK_ONLY') return 'LINK_ONLY' as const;
  if (robot.accessMode === 'PASSWORD') return 'PASSWORD' as const;
  return 'PUBLIC' as const;
}

export type RoomMode = 'PUBLIC' | 'LINK_ONLY' | 'PASSWORD' | 'ALLOWED_USERS' | 'PRIVATE';

export function roomModeToFields(mode: RoomMode) {
  switch (mode) {
    case 'PUBLIC':
      return { visibility: 'PUBLIC' as const, accessMode: 'OPEN' as const };
    case 'LINK_ONLY':
      return { visibility: 'UNLISTED' as const, accessMode: 'LINK_ONLY' as const };
    case 'PASSWORD':
      return { visibility: 'PUBLIC' as const, accessMode: 'PASSWORD' as const };
    case 'ALLOWED_USERS':
      return { visibility: 'UNLISTED' as const, accessMode: 'ALLOWED_USERS' as const };
    case 'PRIVATE':
      return { visibility: 'PRIVATE' as const, accessMode: 'OPEN' as const };
  }
}

export function queueModeDescription(mode: 'FIRST_COME' | 'VOTING' | 'DISABLED') {
  if (mode === 'VOTING') {
    return 'Viewers vote who gets the next turn.';
  }
  if (mode === 'DISABLED') {
    return 'No queue rotation. Controls stay directly available.';
  }
  return 'First come, first served turn rotation.';
}

export function roomModeDescription(mode: RoomMode) {
  switch (mode) {
    case 'PUBLIC':
      return 'Everyone can open the room directly.';
    case 'LINK_ONLY':
      return 'The room stays unlisted and requires the invite link.';
    case 'PASSWORD':
      return 'The room stays public, but viewers need the shared room password.';
    case 'ALLOWED_USERS':
      return 'Only explicitly allowed accounts can enter.';
    case 'PRIVATE':
      return 'The room is hidden and only visible to the owner and staff.';
  }
}
