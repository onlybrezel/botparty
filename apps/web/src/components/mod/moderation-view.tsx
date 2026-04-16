'use client';

import { Select } from '@/components/ui/select';
import { Ban, Clock3 } from 'lucide-react';
import type { api } from '@/lib/api';
import type { ModRuntimeOverview } from '@/lib/api-types';
import { successButtonClass } from './utils';

type Overview = Awaited<ReturnType<typeof api.getModerationOverview>>;
type ProfanityOverview = {
  total: number;
  byUser: Array<{ userId: string; count: number }>;
  byRobot: Array<{ robotId: string; robotName: string; robotSlug: string; count: number }>;
  events: Array<{
    ts: number;
    userId: string;
    username: string;
    content: string;
    robotId: string;
    robotName: string;
    robotSlug: string;
  }>;
};

type ModerationViewProps = {
  overview: Overview | null;
  profanity: ProfanityOverview | null;
  runtimeOverview: ModRuntimeOverview | null;
  selectedRobotId: string;
  onSelectedRobotIdChange: (id: string) => void;
  filteredProfanityEvents: ProfanityOverview['events'];
  onUnrestrict: (robotId: string, userId: string) => Promise<void>;
};

export function ModerationView({
  overview,
  profanity,
  runtimeOverview,
  selectedRobotId,
  onSelectedRobotIdChange,
  filteredProfanityEvents,
  onUnrestrict,
}: ModerationViewProps) {
  return (
    <section className="mb-6 grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
      <div className="space-y-6">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Active Restrictions</h2>
              <p className="text-sm text-[var(--muted-foreground)]">Robot-specific bans and timeouts that may need follow-up.</p>
            </div>
            <div className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-200">
              {(overview?.activeRestrictions ?? []).length} open
            </div>
          </div>
          <div className="space-y-2">
            {(overview?.activeRestrictions ?? []).length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">No active timeouts or bans.</p>
            ) : (
              overview?.activeRestrictions.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs font-semibold">{entry.action}</span>
                    <span>{entry.user.displayName ?? entry.user.username}</span>
                    <span className="text-[var(--muted-foreground)]">on /{entry.robot.slug}</span>
                    <span className="text-[var(--muted-foreground)]">by {entry.moderator?.username ?? 'unknown'}</span>
                    <button
                      type="button"
                      onClick={() => void onUnrestrict(entry.robot.id, entry.user.id)}
                      className={`ml-auto ${successButtonClass}`}
                    >
                      Unban
                    </button>
                  </div>
                  {entry.reason && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{entry.reason}</p>}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div>
              <h2 className="text-lg font-bold">Profanity Log</h2>
              <p className="text-sm text-[var(--muted-foreground)]">Recent blocked messages across the fleet.</p>
            </div>
            <Select
              value={selectedRobotId}
              onChange={(event) => onSelectedRobotIdChange(event.target.value || 'ALL')}
              className="ml-auto bg-[var(--background)]"
            >
              <option value="ALL">All robots</option>
              {(overview?.robots ?? []).map((robot) => (
                <option key={robot.id} value={robot.id}>{robot.name}</option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Top Users</p>
              {(profanity?.byUser ?? []).length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">No entries yet.</p>
              ) : (
                profanity?.byUser.slice(0, 12).map((entry) => (
                  <p key={entry.userId} className="text-sm">{entry.userId.slice(0, 8)}...: {entry.count}</p>
                ))
              )}
            </div>
            <div className="max-h-72 overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Recent Events</p>
              {filteredProfanityEvents.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">No events yet.</p>
              ) : (
                filteredProfanityEvents.map((event, idx) => (
                  <p key={`${event.ts}-${idx}`} className="mb-1 text-xs text-[var(--muted-foreground)]">
                    [{new Date(event.ts).toLocaleTimeString()}] <span className="text-[var(--foreground)]">{event.username}</span> in <span className="text-sky-300">{event.robotName}</span>: {event.content}
                  </p>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-lg font-bold">Moderation Snapshot</h2>
          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active bans</p>
              <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Ban className="h-5 w-5 text-red-300" />{overview?.counts.bans ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active timeouts</p>
              <p className="mt-2 flex items-center gap-2 text-2xl font-black"><Clock3 className="h-5 w-5 text-amber-300" />{overview?.counts.timeouts ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Blocked profanities</p>
              <p className="mt-2 text-2xl font-black">{profanity?.total ?? 0}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-lg font-bold">Escalation Signals</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="font-semibold">Queue pressure</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{runtimeOverview?.summary.queuedUsers ?? 0} users are waiting for control.</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="font-semibold">Robot availability</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {runtimeOverview?.summary.onlineRobots ?? 0} online, {runtimeOverview?.summary.maintenanceRobots ?? 0} in maintenance.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <p className="font-semibold">LiveKit health</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {runtimeOverview?.livekit.available ? `${runtimeOverview?.livekit.totals.publishers ?? 0} publishers active.` : runtimeOverview?.livekit.error ?? 'Unavailable'}
              </p>
            </div>
          </div>
        </section>
      </aside>
    </section>
  );
}
