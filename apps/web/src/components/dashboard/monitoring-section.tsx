'use client';

import type { RobotTelemetryPoint } from '@/lib/api-types';
import { TelemetryBars } from './telemetry-bars';
import { formatPercent, formatUptime, formatClientBuild } from './telemetry-utils';

interface MonitoringSectionProps {
  telemetry: {
    latest: RobotTelemetryPoint | null;
    history: RobotTelemetryPoint[];
  };
}

export function MonitoringSection({ telemetry }: MonitoringSectionProps) {
  return (
    <>
      <div id="section-monitoring" className="order-5 scroll-mt-4 flex items-center gap-3 pt-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          Monitoring
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="order-5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Runtime Telemetry</p>
          <p className="text-[10px] text-[var(--muted-foreground)]">dashboard refreshes 5s, client updates ~30s</p>
        </div>
        {telemetry.latest ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">CPU</p>
                <p className="font-semibold">{formatPercent(telemetry.latest.cpuPercent)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">Memory</p>
                <p className="font-semibold">{formatPercent(telemetry.latest.memoryPercent)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">Temp</p>
                <p className="font-semibold">
                  {telemetry.latest.temperatureC === null
                    ? '-'
                    : `${telemetry.latest.temperatureC.toFixed(1)} C`}
                </p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">Uptime</p>
                <p className="font-semibold">{formatUptime(telemetry.latest.uptimeSec)}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
              <div className="rounded border border-[var(--border)] px-2 py-1.5 sm:col-span-2">
                <p className="text-[var(--muted-foreground)]">Client build</p>
                <p className="font-semibold">{formatClientBuild(telemetry.latest)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5 sm:col-span-2">
                <p className="text-[var(--muted-foreground)]">Python</p>
                <p className="font-semibold">{telemetry.latest.pythonVersion ?? '-'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5 sm:col-span-2">
                <p className="text-[var(--muted-foreground)]">Streamer Version</p>
                <p className="font-semibold">{telemetry.latest.botpartyStreamerVersion ?? '-'}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">LiveKit</p>
                <p className="font-semibold">{telemetry.latest.livekitConnected ? 'Connected' : 'Offline'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">Control WS</p>
                <p className="font-semibold">{telemetry.latest.controlConnected ? 'Connected' : 'Offline'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">Commands</p>
                <p className="font-semibold">{telemetry.latest.commandsReceived}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-2 py-1.5">
                <p className="text-[var(--muted-foreground)]">Frames</p>
                <p className="font-semibold">{telemetry.latest.cameraFrames}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TelemetryBars
                title="CPU trend"
                values={telemetry.history
                  .map((point) => point.cpuPercent)
                  .filter((value): value is number => typeof value === 'number')}
                suffix="%"
              />
              <TelemetryBars
                title="Memory trend"
                values={telemetry.history
                  .map((point) => point.memoryPercent)
                  .filter((value): value is number => typeof value === 'number')}
                suffix="%"
              />
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">
            No telemetry yet. Start your robot client to stream runtime stats.
          </p>
        )}
      </div>
    </>
  );
}
