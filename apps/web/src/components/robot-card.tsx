import Link from 'next/link';
import Image from 'next/image';
import { Bot } from 'lucide-react';
import type { RobotPublic } from '@botparty/shared';

function StatusBadge({ status }: { status: RobotPublic['status'] }) {
  if (status === 'ONLINE') {
    return (
      <span className="flex items-center gap-1 rounded-md bg-[var(--live)]/90 px-2 py-0.5 text-xs font-semibold text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" />
        LIVE
      </span>
    );
  }
  if (status === 'BUSY') {
    return (
      <span className="flex items-center gap-1 rounded-md bg-amber-500/90 px-2 py-0.5 text-xs font-semibold text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
        BUSY
      </span>
    );
  }
  if (status === 'MAINTENANCE') {
    return (
      <span className="flex items-center gap-1 rounded-md bg-orange-600/90 px-2 py-0.5 text-xs font-semibold text-white">
        MAINTENANCE
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-md bg-zinc-700/90 px-2 py-0.5 text-xs font-medium text-zinc-300">
      Offline
    </span>
  );
}

interface Props {
  robot: RobotPublic;
}

export default function RobotCard({ robot }: Props) {
  const seed = robot.slug
    .split('')
    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const hue = seed % 360;
  const initial = robot.name.trim().charAt(0).toUpperCase() || 'R';
  const summary = robot.description?.trim()
    ? robot.description.trim().slice(0, 108)
    : 'Live room with queue-based robot control.';
  const isTrimmed = Boolean(robot.description?.trim() && robot.description.trim().length > 108);
  const isUnoptimizedThumbnail =
    robot.thumbnailUrl?.startsWith('/api/') || robot.thumbnailUrl?.startsWith('http') || false;

  return (
    <Link
      href={`/robot/${robot.owner.username}/${robot.slug}`}
      prefetch={false}
      className="group block overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] transition-colors hover:border-[var(--muted-foreground)]"
    >
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden bg-[var(--muted)]">
        {robot.thumbnailUrl ? (
          <Image
            src={robot.thumbnailUrl}
            alt={robot.name}
            fill
            unoptimized={isUnoptimizedThumbnail}
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div
            className="relative flex h-full w-full items-center justify-center"
            style={{
              background: `hsla(${hue}, 55%, 45%, 0.2)`,
            }}
          >
            <div className="relative flex h-14 w-14 items-center justify-center rounded-lg border border-white/20 bg-black/20 text-xl font-bold text-white">
              {initial}
            </div>
            <Bot className="absolute bottom-2 right-2 h-5 w-5 text-white/45" />
          </div>
        )}

        {/* Overlays */}
        <div className="absolute left-2 top-2">
          <StatusBadge status={robot.status} />
        </div>

        {robot.viewerCount > 0 && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
            <span className="sr-only">{robot.viewerCount} watching</span>
            <span aria-hidden>{robot.viewerCount}</span>
          </div>
        )}
        </div>

        {/* Info */}
        <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--foreground)] transition-colors group-hover:text-violet-400">
              {robot.name}
            </h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              by{' '}
              <span className="text-[var(--foreground)]/70">
                {robot.owner.displayName ?? robot.owner.username}
              </span>
            </p>
          </div>
        </div>

        {robot.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {robot.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-[var(--secondary)] px-2 py-1 text-xs text-[var(--secondary-foreground)]/80"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {summary}
          {isTrimmed ? '...' : ''}
        </p>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-foreground)]">
          <span>
            {robot.queueMode === 'VOTING'
              ? 'Voting queue'
              : robot.queueMode === 'DISABLED'
                ? 'Direct control'
                : 'Turn queue'}
          </span>
          <span>
            {robot.accessMode === 'OPEN'
              ? 'Open room'
              : robot.accessMode === 'PASSWORD'
                ? 'Password room'
                : robot.accessMode === 'ALLOWED_USERS'
                  ? 'Allow-list room'
                  : 'Link-only room'}
          </span>
        </div>
        </div>
    </Link>
  );
}
