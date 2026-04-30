'use client';

import Link from 'next/link';
import { type RefObject } from 'react';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { ModRuntimeOverview, AdminRecordingFile } from '@/lib/api-types';
import {
  formatPercent,
  formatAge,
  formatBitrate,
  formatBytes,
  formatUptime,
  formatDurationClock,
  formatClientBuild,
  statusClassName,
  successButtonClass,
  primaryButtonClass,
  dangerButtonClass,
} from './utils';

type RecordingEntry = Omit<AdminRecordingFile, 'recordedAt'> & {
  parsedRobotId: string | null;
  parsedCameraId: string | null;
  recordedAt: Date | null;
  robotName: string | null;
};

type RuntimeViewProps = {
  runtimeOverview: ModRuntimeOverview | null;
  selectedRuntimeRobotId: string;
  onSelectedRuntimeRobotIdChange: (id: string) => void;
  runtimeActionLoading: string | null;
  onRuntimeRobotUpdate: () => Promise<void>;
  viewerIsAdmin: boolean;
  activeRecordings: ModRuntimeOverview['robots'];
  recordingActionLoading: string | null;
  onStopRecording: (robotId: string) => Promise<void>;
  onStopAllRecordings: () => Promise<void>;
  recordingFiles: AdminRecordingFile[];
  recordingRobotFilter: string;
  onRecordingRobotFilterChange: (value: string) => void;
  recordingCameraFilter: string;
  onRecordingCameraFilterChange: (value: string) => void;
  recordingRobotOptions: Array<{ id: string; label: string }>;
  recordingCameraOptions: string[];
  filteredRecordingEntries: RecordingEntry[];
  recordingEntries: RecordingEntry[];
  selectedRecordingFile: string | null;
  onSelectRecordingFile: (fileName: string) => void;
  selectedRecording: AdminRecordingFile | null;
  selectedRecordingEntry: RecordingEntry | null;
  recordingVideoRef: RefObject<HTMLVideoElement | null>;
  playerCurrentSec: number;
  onPlayerCurrentSecChange: (sec: number) => void;
  playerDurationSec: number;
  onPlayerDurationSecChange: (sec: number) => void;
  selectedRecordingClock: Date | null;
  selectedRecordingEndClock: Date | null;
  playerProgressPercent: number;
};

export function RuntimeView({
  runtimeOverview,
  selectedRuntimeRobotId,
  onSelectedRuntimeRobotIdChange,
  runtimeActionLoading,
  onRuntimeRobotUpdate,
  viewerIsAdmin,
  activeRecordings,
  recordingActionLoading,
  onStopRecording,
  onStopAllRecordings,
  recordingFiles,
  recordingRobotFilter,
  onRecordingRobotFilterChange,
  recordingCameraFilter,
  onRecordingCameraFilterChange,
  recordingRobotOptions,
  recordingCameraOptions,
  filteredRecordingEntries,
  recordingEntries,
  selectedRecordingFile,
  onSelectRecordingFile,
  selectedRecording,
  selectedRecordingEntry,
  recordingVideoRef,
  playerCurrentSec,
  onPlayerCurrentSecChange,
  playerDurationSec,
  onPlayerDurationSecChange,
  selectedRecordingClock,
  selectedRecordingEndClock,
  playerProgressPercent,
}: RuntimeViewProps) {
  const selectedRuntimeRobot = runtimeOverview?.robots.find((robot) => robot.id === selectedRuntimeRobotId)
    ?? runtimeOverview?.robots[0]
    ?? null;

  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Runtime Overview</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Host load from robot telemetry plus active LiveKit rooms, publishers, clients, and queue pressure.
          </p>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Snapshot {runtimeOverview ? new Date(runtimeOverview.generatedAt).toLocaleTimeString() : '-'}
        </p>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Fleet Status</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <p>Online: <span className="font-semibold">{runtimeOverview?.summary.onlineRobots ?? 0}</span></p>
            <p>Busy: <span className="font-semibold">{runtimeOverview?.summary.busyRobots ?? 0}</span></p>
            <p>Offline: <span className="font-semibold">{runtimeOverview?.summary.offlineRobots ?? 0}</span></p>
            <p>Maint: <span className="font-semibold">{runtimeOverview?.summary.maintenanceRobots ?? 0}</span></p>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">LiveKit</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <p>Rooms: <span className="font-semibold">{runtimeOverview?.livekit.totals.rooms ?? 0}</span></p>
            <p>Publishers: <span className="font-semibold">{runtimeOverview?.livekit.totals.publishers ?? 0}</span></p>
            <p>Subscribers: <span className="font-semibold">{runtimeOverview?.livekit.totals.subscribers ?? 0}</span></p>
            <p>Ingress est.: <span className="font-semibold">{formatBitrate(runtimeOverview?.livekit.totals.estimatedIngressKbps)}</span></p>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Connectivity</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <p>Telemetry fresh: <span className="font-semibold">{runtimeOverview?.summary.telemetryFreshRobots ?? 0}</span></p>
            <p>Control WS: <span className="font-semibold">{runtimeOverview?.summary.controlConnectedRobots ?? 0}</span></p>
            <p>LiveKit OK: <span className="font-semibold">{runtimeOverview?.summary.livekitConnectedRobots ?? 0}</span></p>
            <p>Active sessions: <span className="font-semibold">{runtimeOverview?.summary.activeSessions ?? 0}</span></p>
          </div>
        </div>
      </div>

      {!runtimeOverview?.livekit.available && runtimeOverview?.livekit.error ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          LiveKit room stats are currently unavailable: {runtimeOverview.livekit.error}
        </div>
      ) : null}

      {!runtimeOverview?.platform.available && runtimeOverview?.platform.error ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Container and host metrics are currently unavailable: {runtimeOverview.platform.error}
        </div>
      ) : null}

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold">Docker Host</h3>
          <p className="text-xs text-[var(--muted-foreground)]">cAdvisor snapshot</p>
        </div>
        {runtimeOverview?.platform.host ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
              <p className="text-[var(--muted-foreground)]">CPU</p>
              <p className="mt-1 text-sm font-semibold">{formatPercent(runtimeOverview.platform.host.cpuPercent)}</p>
            </div>
            <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
              <p className="text-[var(--muted-foreground)]">Memory</p>
              <p className="mt-1 text-sm font-semibold">{formatPercent(runtimeOverview.platform.host.memoryPercent)}</p>
              <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                {formatBytes(runtimeOverview.platform.host.memoryUsageBytes)} / {formatBytes(runtimeOverview.platform.host.memoryBytes)}
              </p>
            </div>
            <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
              <p className="text-[var(--muted-foreground)]">Ingress</p>
              <p className="mt-1 text-sm font-semibold">{formatBitrate(runtimeOverview.platform.host.rxKbps)}</p>
            </div>
            <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
              <p className="text-[var(--muted-foreground)]">Egress</p>
              <p className="mt-1 text-sm font-semibold">{formatBitrate(runtimeOverview.platform.host.txKbps)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">No Docker host metrics available right now.</p>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold">Docker Containers</h3>
          <p className="text-xs text-[var(--muted-foreground)]">API, web, LiveKit, nginx, redis, postgres, cAdvisor</p>
        </div>
        {(runtimeOverview?.platform.containers ?? []).length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {(runtimeOverview?.platform.containers ?? []).map((container) => (
              <div key={container.service} className="rounded border border-[var(--border)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{container.service}</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]">{container.containerName ?? 'container name unavailable'}</p>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">CPU {formatPercent(container.cpuPercent)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <p className="text-[var(--muted-foreground)]">CPU</p>
                    <p className="font-semibold">{formatPercent(container.cpuPercent)}</p>
                  </div>
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <p className="text-[var(--muted-foreground)]">Memory</p>
                    <p className="font-semibold">{formatPercent(container.memoryPercent)}</p>
                  </div>
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <p className="text-[var(--muted-foreground)]">Ingress</p>
                    <p className="font-semibold">{formatBitrate(container.rxKbps)}</p>
                  </div>
                  <div className="rounded border border-[var(--border)] px-2 py-1.5">
                    <p className="text-[var(--muted-foreground)]">Egress</p>
                    <p className="font-semibold">{formatBitrate(container.txKbps)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
                  Memory {formatBytes(container.memoryUsageBytes)} / {formatBytes(container.memoryLimitBytes)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">No Docker container metrics available right now.</p>
        )}
      </div>

      {viewerIsAdmin ? (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold">Recording Control (Admin)</h3>
              <p className="text-xs text-[var(--muted-foreground)]">Live view of active room recordings with direct stop controls.</p>
            </div>
            <button
              type="button"
              onClick={() => void onStopAllRecordings()}
              disabled={activeRecordings.length === 0 || recordingActionLoading !== null}
              className={dangerButtonClass}
            >
              {recordingActionLoading === '__all__' ? 'Stopping all...' : 'Stop all'}
            </button>
          </div>

          {activeRecordings.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No active recordings right now.</p>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {activeRecordings.map((robot) => (
                <div key={robot.id} className="rounded border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{robot.name}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">/{robot.slug}</p>
                    </div>
                    <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                      Recording
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Clients: {robot.livekit?.participants ?? 0} · Publishers: {robot.livekit?.publishers ?? 0}
                    </p>
                    <button
                      type="button"
                      onClick={() => void onStopRecording(robot.id)}
                      disabled={recordingActionLoading !== null}
                      className={dangerButtonClass}
                    >
                      {recordingActionLoading === robot.id ? 'Stopping...' : 'Stop'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {viewerIsAdmin ? (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold">Recordings Library (Admin)</h3>
              <p className="text-xs text-[var(--muted-foreground)]">Recent .mp4 files from livekit-egress output.</p>
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">{recordingFiles.length} files</span>
          </div>

          {recordingFiles.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No recordings found yet.</p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-[0.95fr,1.05fr]">
              <div className="rounded border border-[var(--border)] bg-[var(--card)]">
                <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 p-2 backdrop-blur">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={recordingRobotFilter}
                      onChange={(event) => onRecordingRobotFilterChange(event.target.value)}
                      className="h-8 bg-[var(--card)] text-xs"
                    >
                      <option value="ALL">All robots</option>
                      {recordingRobotOptions.map((robot) => (
                        <option key={robot.id} value={robot.id}>
                          {robot.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={recordingCameraFilter}
                      onChange={(event) => onRecordingCameraFilterChange(event.target.value)}
                      className="h-8 bg-[var(--card)] text-xs"
                    >
                      <option value="ALL">All cameras</option>
                      {recordingCameraOptions.map((cameraId) => (
                        <option key={cameraId} value={cameraId}>
                          {cameraId}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                    Showing {filteredRecordingEntries.length} of {recordingEntries.length}
                  </p>
                </div>
                <div className="max-h-[28rem] overflow-y-auto overscroll-contain">
                  {filteredRecordingEntries.slice(0, 200).map((file) => (
                    <button
                      key={file.fileName}
                      type="button"
                      onClick={() => onSelectRecordingFile(file.fileName)}
                      className={`w-full border-b border-[var(--border)] px-3 py-2 text-left text-xs hover:bg-[var(--muted)] ${
                        selectedRecordingFile === file.fileName ? 'bg-[var(--muted)]' : ''
                      }`}
                    >
                      <p className="truncate font-semibold text-[var(--foreground)]">{file.fileName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--muted-foreground)]">
                        <span>{new Date(file.modifiedAt).toLocaleString()}</span>
                        <span>· {(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                        {file.parsedCameraId ? <span>· cam: {file.parsedCameraId}</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--card)] p-3">
                {selectedRecording && selectedRecordingEntry ? (
                  <>
                    <p className="mb-2 text-xs text-[var(--muted-foreground)]">Previewing {selectedRecording.fileName}</p>
                    <video
                      ref={recordingVideoRef}
                      key={selectedRecording.fileName}
                      controls
                      preload="metadata"
                      className="h-auto w-full rounded border border-[var(--border)] bg-black"
                      src={api.moderation.getAdminRecordingStreamUrl(selectedRecording)}
                      onTimeUpdate={(event) => {
                        onPlayerCurrentSecChange(event.currentTarget.currentTime || 0);
                      }}
                      onLoadedMetadata={(event) => {
                        onPlayerDurationSecChange(event.currentTarget.duration || 0);
                      }}
                    />
                    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                      <input
                        type="range"
                        min={0}
                        max={playerDurationSec > 0 ? playerDurationSec : 0}
                        step={0.25}
                        value={Math.min(playerCurrentSec, playerDurationSec || playerCurrentSec)}
                        onChange={(event) => {
                          const nextTime = Number(event.target.value);
                          if (!Number.isFinite(nextTime)) return;
                          onPlayerCurrentSecChange(nextTime);
                          if (recordingVideoRef.current) {
                            recordingVideoRef.current.currentTime = nextTime;
                          }
                        }}
                        className="w-full accent-sky-400"
                        aria-label="Recording timeline"
                      />
                      <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                        <span className="text-[var(--muted-foreground)]">
                          Start: {selectedRecordingEntry.recordedAt ? selectedRecordingEntry.recordedAt.toLocaleTimeString() : '-'}
                        </span>
                        <span className="font-medium text-[var(--foreground)]">
                          {formatDurationClock(playerCurrentSec)} / {formatDurationClock(playerDurationSec)}
                        </span>
                        <span className="text-[var(--muted-foreground)]">
                          End: {selectedRecordingEndClock ? selectedRecordingEndClock.toLocaleTimeString() : '-'}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                        <div className="h-full rounded-full bg-sky-400 transition-[width]" style={{ width: `${playerProgressPercent}%` }} />
                      </div>
                    </div>
                    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--background)] p-2 text-xs">
                      <div className="grid gap-1 sm:grid-cols-2">
                        <span className="text-[var(--muted-foreground)]">Robot: {selectedRecordingEntry.robotName ?? selectedRecordingEntry.parsedRobotId ?? 'unknown'}</span>
                        <span className="text-[var(--muted-foreground)]">Camera: {selectedRecordingEntry.parsedCameraId ?? 'default'}</span>
                        <span className="text-[var(--muted-foreground)]">Recorded: {selectedRecordingEntry.recordedAt ? selectedRecordingEntry.recordedAt.toLocaleString() : new Date(selectedRecordingEntry.modifiedAt).toLocaleString()}</span>
                        <span className="text-[var(--muted-foreground)]">Duration: {playerDurationSec > 0 ? `${Math.floor(playerDurationSec / 60)}m ${Math.floor(playerDurationSec % 60)}s` : '-'}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
                        <span className="font-medium text-[var(--foreground)]">
                          Playback clock: {selectedRecordingClock ? selectedRecordingClock.toLocaleString() : '-'}
                        </span>
                        <span className="text-[var(--muted-foreground)]">
                          End clock: {selectedRecordingEndClock ? selectedRecordingEndClock.toLocaleString() : '-'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                      <a
                        href={api.moderation.getAdminRecordingStreamUrl(selectedRecording)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-[var(--border)] px-2 py-1 text-[var(--foreground)]"
                      >
                        Open in new tab
                      </a>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">Select a recording to preview.</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">Robot Runtime</h3>
            <p className="text-xs text-[var(--muted-foreground)]">Select one robot to inspect instead of rendering the full fleet list.</p>
          </div>
          <Select
            value={selectedRuntimeRobotId}
            onChange={(event) => onSelectedRuntimeRobotIdChange(event.target.value)}
            disabled={(runtimeOverview?.robots ?? []).length === 0}
            className="min-w-56 bg-[var(--card)] disabled:opacity-60"
          >
            {(runtimeOverview?.robots ?? []).map((robot) => (
              <option key={robot.id} value={robot.id}>
                {robot.name}
              </option>
            ))}
          </Select>
        </div>

        {selectedRuntimeRobot ? (
          <article key={selectedRuntimeRobot.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">{selectedRuntimeRobot.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClassName(selectedRuntimeRobot.status)}`}>
                    {selectedRuntimeRobot.status}
                  </span>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                    {selectedRuntimeRobot.visibility}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  /{selectedRuntimeRobot.slug} · owner {selectedRuntimeRobot.owner.displayName ?? selectedRuntimeRobot.owner.username}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Client {formatClientBuild(selectedRuntimeRobot.telemetry)} · Python {selectedRuntimeRobot.telemetry?.pythonVersion ?? '-'}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Streamer {selectedRuntimeRobot.telemetry?.botpartyStreamerVersion ?? '-'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onRuntimeRobotUpdate()}
                  disabled={runtimeActionLoading === selectedRuntimeRobot.id}
                  className={successButtonClass}
                >
                  {runtimeActionLoading === selectedRuntimeRobot.id ? 'Queueing...' : 'Force Update'}
                </button>
                <Link
                  href={`/robot/${selectedRuntimeRobot.owner.username}/${selectedRuntimeRobot.slug}`}
                  className={primaryButtonClass}
                >
                  Preview
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Viewers</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.viewerCount}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Queue</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.queueLength} · {selectedRuntimeRobot.queueMode}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Controller</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.activeSession?.user.displayName ?? selectedRuntimeRobot.activeSession?.user.username ?? selectedRuntimeRobot.queueHead?.displayName ?? selectedRuntimeRobot.queueHead?.username ?? '-'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Heartbeat</p>
                <p className="mt-1 text-sm font-semibold">{formatAge(selectedRuntimeRobot.heartbeatAgeSec)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Telemetry</p>
                <p className="mt-1 text-sm font-semibold">{formatAge(selectedRuntimeRobot.telemetryAgeSec)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">LiveKit Room</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.livekit ? `${selectedRuntimeRobot.livekit.participants} clients` : '-'}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">CPU</p>
                <p className="mt-1 text-sm font-semibold">{formatPercent(selectedRuntimeRobot.telemetry?.cpuPercent)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">RAM</p>
                <p className="mt-1 text-sm font-semibold">{formatPercent(selectedRuntimeRobot.telemetry?.memoryPercent)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Temp</p>
                <p className="mt-1 text-sm font-semibold">
                  {typeof selectedRuntimeRobot.telemetry?.temperatureC === 'number' ? `${selectedRuntimeRobot.telemetry.temperatureC.toFixed(1)} C` : '-'}
                </p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Uptime</p>
                <p className="mt-1 text-sm font-semibold">{formatUptime(selectedRuntimeRobot.telemetry?.uptimeSec)}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs xl:col-span-2">
                <p className="text-[var(--muted-foreground)]">Client Build</p>
                <p className="mt-1 text-sm font-semibold">{formatClientBuild(selectedRuntimeRobot.telemetry)}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs xl:col-span-2">
                <p className="text-[var(--muted-foreground)]">Python</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.pythonVersion ?? '-'}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Control WS</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.controlConnected ? 'Connected' : 'Offline'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">LiveKit</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.livekitConnected ? 'Connected' : 'Offline'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Commands</p>
                <p className="mt-1 text-sm font-semibold">{selectedRuntimeRobot.telemetry?.commandsReceived ?? '-'}</p>
              </div>
              <div className="rounded border border-[var(--border)] px-3 py-2 text-xs">
                <p className="text-[var(--muted-foreground)]">Ingress est.</p>
                <p className="mt-1 text-sm font-semibold">{formatBitrate(selectedRuntimeRobot.livekit?.estimatedIngressKbps)}</p>
              </div>
            </div>

            <div className="mt-3 rounded border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
              <p>
                LiveKit clients: {selectedRuntimeRobot.livekit?.participantNames.length ? selectedRuntimeRobot.livekit.participantNames.join(', ') : 'none'}
              </p>
              <p className="mt-1">
                Publishers {selectedRuntimeRobot.livekit?.publishers ?? 0} · Subscribers {selectedRuntimeRobot.livekit?.subscribers ?? 0} · Recording {selectedRuntimeRobot.livekit?.activeRecording ? 'on' : 'off'}
              </p>
            </div>
          </article>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">No robot runtime data available right now.</p>
        )}
      </div>
    </section>
  );
}
