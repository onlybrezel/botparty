import type { RobotTelemetryPoint } from '@/lib/api-types';

export function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

export function formatUptime(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-';

  const totalSeconds = Math.floor(value);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatClientBuild(telemetry: RobotTelemetryPoint | null | undefined) {
  if (!telemetry) return '-';

  const parts: string[] = [];
  if (telemetry.clientVersion) parts.push(`v${telemetry.clientVersion}`);
  if (telemetry.gitBranch) parts.push(telemetry.gitBranch);
  if (telemetry.gitCommit) parts.push(telemetry.gitCommit);
  if (telemetry.gitDirty) parts.push('dirty');

  return parts.length > 0 ? parts.join(' \u2022 ') : '-';
}
