'use client';

import { formatClientBuild } from './telemetry-utils';
import type { RemoteActionType } from './types';
import type { RobotTelemetryPoint } from '@/lib/api';
import type { RobotOnboardingStatus } from '@botparty/shared';

type Props = {
  telemetry: { latest: RobotTelemetryPoint | null };
  onboarding: RobotOnboardingStatus | null;
  opLoading: string | null;
  pendingActionTypes: RemoteActionType[];
  logsLoading: boolean;
  diagLogs: Array<{ ts: number; line: string }>;
  onRunAction: (type: RemoteActionType, durationSec?: number) => void;
  onRefreshLogs: () => void;
};

export function DashboardOperationsSection({
  telemetry,
  onboarding,
  opLoading,
  pendingActionTypes,
  logsLoading,
  diagLogs,
  onRunAction,
  onRefreshLogs,
}: Props) {
  return (
    <>
      <div id="section-operations" className="order-4 scroll-mt-4 flex items-center gap-3 pt-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          Operations
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="order-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Go-live checks</p>
            <span className={`text-xs font-semibold ${onboarding?.canPublish ? 'text-emerald-300' : 'text-amber-300'}`}>
              {onboarding?.canPublish ? 'Ready to publish' : 'Checks pending'}
            </span>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {(onboarding?.steps ?? []).map((step) => (
              <li key={step.id} className="flex items-center gap-2 text-xs">
                <span aria-hidden="true" className={step.complete ? 'text-emerald-300' : step.required ? 'text-amber-300' : 'text-[var(--muted-foreground)]'}>
                  {step.complete ? '✓' : step.required ? '○' : '–'}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
          {!onboarding ? <p className="text-xs text-[var(--muted-foreground)]">Waiting for robot diagnostics.</p> : null}
        </div>
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Remote Operations</p>
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Restart robot services, install client updates, or collect short diagnostic logs.
        </p>

        {telemetry.latest && (
          <div className="mb-3 rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <p>
              Client build: <span className="font-semibold text-[var(--foreground)]">{formatClientBuild(telemetry.latest)}</span>
            </p>
            {telemetry.latest.pythonVersion && (
              <p className="mt-1">
                Python: <span className="font-semibold text-[var(--foreground)]">{telemetry.latest.pythonVersion}</span>
              </p>
            )}
            <p className="mt-1">
              Streamer: <span className="font-semibold text-[var(--foreground)]">{telemetry.latest.botpartyStreamerVersion ?? '-'}</span>
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRunAction('restart_video')}
            disabled={opLoading !== null || pendingActionTypes.includes('restart_video')}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {opLoading === 'restart_video'
              ? 'Queueing...'
              : pendingActionTypes.includes('restart_video')
                ? 'Queued, waiting for pickup'
                : 'Restart Video'}
          </button>
          <button
            type="button"
            onClick={() => onRunAction('restart_control')}
            disabled={opLoading !== null || pendingActionTypes.includes('restart_control')}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {opLoading === 'restart_control'
              ? 'Queueing...'
              : pendingActionTypes.includes('restart_control')
                ? 'Queued, waiting for pickup'
                : 'Restart Control'}
          </button>
          <button
            type="button"
            onClick={() => onRunAction('restart_chat')}
            disabled={opLoading !== null || pendingActionTypes.includes('restart_chat')}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {opLoading === 'restart_chat'
              ? 'Queueing...'
              : pendingActionTypes.includes('restart_chat')
                ? 'Queued, waiting for pickup'
                : 'Restart Chat Bridge'}
          </button>
          <button
            type="button"
            onClick={() => onRunAction('update_client')}
            disabled={opLoading !== null || pendingActionTypes.includes('update_client')}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-60"
          >
            {opLoading === 'update_client'
              ? 'Queueing...'
              : pendingActionTypes.includes('update_client')
                ? 'Queued, waiting for pickup'
                : 'Update Client'}
          </button>
          <button
            type="button"
            onClick={() => onRunAction('set_log_stream', 120)}
            disabled={opLoading !== null || pendingActionTypes.includes('set_log_stream')}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-60"
          >
            {opLoading === 'set_log_stream'
              ? 'Queueing...'
              : pendingActionTypes.includes('set_log_stream')
                ? 'Queued, waiting for pickup'
                : 'Enable 2min Diagnostics'}
          </button>
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Diagnostics Log</p>
            <button
              type="button"
              onClick={onRefreshLogs}
              disabled={logsLoading}
              className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)] disabled:opacity-60"
            >
              {logsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <div className="max-h-48 overflow-auto rounded border border-[var(--border)] bg-black/70 p-2 font-mono text-[11px] leading-5 text-emerald-300">
            {diagLogs.length === 0 ? (
              <p className="text-[var(--muted-foreground)]">No logs. Enable diagnostics above.</p>
            ) : (
              diagLogs.map((row, idx) => (
                <p key={`${row.ts}-${idx}`}>[{new Date(row.ts).toLocaleTimeString()}] {row.line}</p>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
