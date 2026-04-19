'use client';

import { Trash2, Save, X } from 'lucide-react';
import Link from 'next/link';
import { Select } from '@/components/ui/select';
import type { api } from '@/lib/api';
import {
  primaryButtonClass,
  successButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
  queueModeDescription,
  roomModeDescription,
} from './utils';

type AclLevel = 'ALL' | 'AUTHENTICATED' | 'DISABLED';
type OverviewRobot = NonNullable<Awaited<ReturnType<typeof api.moderation.getModerationOverview>>['robots']>[number];

type RobotDraft = {
  name: string;
  slug: string;
  description: string;
  roomMode: 'PUBLIC' | 'LINK_ONLY' | 'PASSWORD' | 'ALLOWED_USERS' | 'PRIVATE';
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  timezone: string;
  aclVideo: AclLevel;
  aclControl: AclLevel;
  aclChat: AclLevel;
  aclEStop: AclLevel;
  targetBitrateKbps: string;
  maxTurnTime: string;
  maxViewers: string;
  maxControllers: string;
  tags: string;
  accessPassword: string;
};

type RobotsViewProps = {
  robots: OverviewRobot[];
  editingRobotId: string | null;
  robotDraft: RobotDraft | null;
  onStartRobotEdit: (robot: OverviewRobot) => void;
  onRobotDraftChange: (updater: (prev: RobotDraft | null) => RobotDraft | null) => void;
  onSaveRobotEdit: () => Promise<void>;
  onCancelRobotEdit: () => void;
  onDeleteRobot: (robotId: string, robotName: string) => Promise<void>;
};

export function RobotsView({
  robots,
  editingRobotId,
  robotDraft,
  onStartRobotEdit,
  onRobotDraftChange,
  onSaveRobotEdit,
  onCancelRobotEdit,
  onDeleteRobot,
}: RobotsViewProps) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="mb-4 text-lg font-bold">Manage Robots</h3>
      <div className="space-y-3">
        {robots.map((robot) => {
          const isEditing = editingRobotId === robot.id && robotDraft;
          return (
            <div key={robot.id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)]">
              <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-sm">
                <span className="font-medium">{robot.name}</span>
                <span className="text-[var(--muted-foreground)]">/{robot.slug}</span>
                <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">{robot.status}</span>
                <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">{robot.visibility}</span>
                <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">{robot.accessMode}</span>
                <span className="text-[var(--muted-foreground)]">Owner: {robot.owner.displayName ?? robot.owner.username}</span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Link href={`/robot/${robot.owner.username}/${robot.slug}`} className={primaryButtonClass}>
                    Preview
                  </Link>
                  <button type="button" onClick={() => onStartRobotEdit(robot)} className={successButtonClass}>
                    {isEditing ? 'Editing' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteRobot(robot.id, robot.name)}
                    className={dangerButtonClass}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              {isEditing ? (
                <div className="border-t border-[var(--border)] bg-[var(--card)]/80 p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Edit robot</p>
                      <p className="mt-1 text-sm font-semibold">{robot.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        This mirrors the current dashboard settings more closely, including slug, room access, queue mode, ACL and stream tuning.
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      <p>Status: {robot.status}</p>
                      <p>Owner: {robot.owner.displayName ?? robot.owner.username}</p>
                      <p>{queueModeDescription(robotDraft.queueMode)}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3 xl:col-span-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Identity</p>
                      <input
                        value={robotDraft.name}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                        placeholder="Name"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <input
                        value={robotDraft.slug}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, slug: event.target.value } : prev))}
                        placeholder="Slug"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <input
                        value={robotDraft.tags}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, tags: event.target.value } : prev))}
                        placeholder="Tags (comma separated)"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <textarea
                        value={robotDraft.description}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                        placeholder="Description"
                        rows={5}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3 xl:col-span-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Room access</p>
                      <Select
                        value={robotDraft.roomMode}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, roomMode: event.target.value as RobotDraft['roomMode'] } : prev))}
                        className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm"
                      >
                        <option value="PUBLIC">PUBLIC</option>
                        <option value="LINK_ONLY">LINK_ONLY</option>
                        <option value="PASSWORD">PASSWORD</option>
                        <option value="ALLOWED_USERS">ALLOWED_USERS</option>
                        <option value="PRIVATE">PRIVATE</option>
                      </Select>
                      <p className="text-xs text-[var(--muted-foreground)]">{roomModeDescription(robotDraft.roomMode)}</p>
                      {robotDraft.roomMode === 'PASSWORD' ? (
                        <input
                          value={robotDraft.accessPassword}
                          onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, accessPassword: event.target.value } : prev))}
                          placeholder="Set new room password"
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        />
                      ) : null}
                      <Select
                        value={robotDraft.queueMode}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, queueMode: event.target.value as RobotDraft['queueMode'] } : prev))}
                        className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm"
                      >
                        <option value="FIRST_COME">FIRST_COME</option>
                        <option value="VOTING">VOTING</option>
                        <option value="DISABLED">DISABLED</option>
                      </Select>
                      <p className="text-xs text-[var(--muted-foreground)]">{queueModeDescription(robotDraft.queueMode)}</p>
                      <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                        <span>Scheduling window</span>
                        <input
                          type="checkbox"
                          checked={robotDraft.scheduleEnabled}
                          onChange={(event) => onRobotDraftChange((prev) => (prev ? {
                            ...prev,
                            scheduleEnabled: event.target.checked,
                            scheduleStart: event.target.checked ? prev.scheduleStart : '',
                            scheduleEnd: event.target.checked ? prev.scheduleEnd : '',
                          } : prev))}
                          className="h-4 w-4"
                        />
                      </label>
                      {robotDraft.scheduleEnabled ? (
                        <>
                          <input
                            type="datetime-local"
                            value={robotDraft.scheduleStart}
                            onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, scheduleStart: event.target.value } : prev))}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          />
                          <input
                            type="datetime-local"
                            value={robotDraft.scheduleEnd}
                            onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, scheduleEnd: event.target.value } : prev))}
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          />
                          <input
                            value={robotDraft.timezone}
                            onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, timezone: event.target.value } : prev))}
                            placeholder="Timezone (e.g. Europe/Berlin)"
                            className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          />
                        </>
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select
                          value={robotDraft.aclVideo}
                          onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, aclVideo: event.target.value as AclLevel } : prev))}
                          className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm"
                        >
                          <option value="ALL">Video: ALL</option>
                          <option value="AUTHENTICATED">Video: AUTHENTICATED</option>
                          <option value="DISABLED">Video: DISABLED</option>
                        </Select>
                        <Select
                          value={robotDraft.aclControl}
                          onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, aclControl: event.target.value as AclLevel } : prev))}
                          className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm"
                        >
                          <option value="ALL">Control: ALL</option>
                          <option value="AUTHENTICATED">Control: AUTHENTICATED</option>
                          <option value="DISABLED">Control: DISABLED</option>
                        </Select>
                        <Select
                          value={robotDraft.aclChat}
                          onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, aclChat: event.target.value as AclLevel } : prev))}
                          className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm"
                        >
                          <option value="ALL">Chat: ALL</option>
                          <option value="AUTHENTICATED">Chat: AUTHENTICATED</option>
                          <option value="DISABLED">Chat: DISABLED</option>
                        </Select>
                        <Select
                          value={robotDraft.aclEStop}
                          onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, aclEStop: event.target.value as AclLevel } : prev))}
                          className="h-[42px] rounded-xl border bg-[var(--card)] px-3 py-2 text-sm"
                        >
                          <option value="ALL">E-Stop: ALL</option>
                          <option value="AUTHENTICATED">E-Stop: AUTHENTICATED</option>
                          <option value="DISABLED">E-Stop: DISABLED</option>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3 xl:col-span-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Limits & stream</p>
                      <input
                        value={robotDraft.maxTurnTime}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, maxTurnTime: event.target.value } : prev))}
                        placeholder="Max turn time (ms)"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <input
                        value={robotDraft.maxViewers}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, maxViewers: event.target.value } : prev))}
                        placeholder="Max viewers"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <input
                        value={robotDraft.maxControllers}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, maxControllers: event.target.value } : prev))}
                        placeholder="Max controllers"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <input
                        value={robotDraft.targetBitrateKbps}
                        onChange={(event) => onRobotDraftChange((prev) => (prev ? { ...prev, targetBitrateKbps: event.target.value } : prev))}
                        placeholder="Target bitrate kbps"
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                      />
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                        Leave bitrate empty to keep the current stream tuning. Valid values stay in the 150-3000 kbps range.
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void onSaveRobotEdit()} className={successButtonClass}>
                      <Save className="h-4 w-4" />
                      Save robot
                    </button>
                    <button type="button" onClick={onCancelRobotEdit} className={secondaryButtonClass}>
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
