import Link from 'next/link';
import { Bot, Gamepad2, Video } from 'lucide-react';
import type { RobotPublic } from '@botparty/shared';
import { RobotPageHeader } from './robot-page-header';
import { OfflineRobotRefresh } from './offline-robot-refresh';

export function OfflineRobotView({ robot }: { robot: RobotPublic }) {
  const ownerName = robot.owner.displayName ?? robot.owner.username;
  const statusLabel = robot.status === 'MAINTENANCE' ? 'Maintenance' : 'Offline';
  const viewerLabel = robot.viewerCount > 0 ? `${robot.viewerCount} watching` : 'No viewers';

  return (
    <div className="safe-pb mx-auto max-w-7xl px-4 py-4 sm:py-6">
      <OfflineRobotRefresh />
      <RobotPageHeader
        robotName={robot.name}
        connected={false}
        viewerLabel={viewerLabel}
        reconnectNotice={null}
        reconnectSeconds={null}
        robotStatus={robot.status}
        queueSummary="Paused"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-black text-[var(--muted-foreground)]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
              <Bot className="h-7 w-7" />
            </div>
            <p className="text-sm">{robot.status === 'MAINTENANCE' ? 'Robot is in maintenance' : 'Robot is offline'}</p>
          </div>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-violet-300" />
              <h2 className="font-semibold">Controls</h2>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Join the queue to control this robot.
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Queue, chat, and controls resume automatically when the robot reconnects.
            </p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold leading-tight">{robot.name}</h1>
                <p className="text-sm text-[var(--muted-foreground)]">by {ownerName}</p>
              </div>
              <span className="rounded-full bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-300">
                {statusLabel}
              </span>
            </div>

            {robot.description ? (
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
                {robot.description}
              </p>
            ) : null}

            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex items-center gap-2 rounded-lg bg-[var(--background)] px-3 py-2">
                <Video className="h-3.5 w-3.5 text-violet-300" />
                Live stream paused
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-[var(--background)] px-3 py-2">
                <Gamepad2 className="h-3.5 w-3.5 text-violet-300" />
                Queue control
              </div>
            </div>

            {robot.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {robot.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/explore/search?tag=${encodeURIComponent(tag)}`}
                    prefetch={false}
                    className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--secondary-foreground)]/80"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
