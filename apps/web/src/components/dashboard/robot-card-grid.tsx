'use client';

import Image from 'next/image';
import type { RobotManaged } from '@/lib/api';

type Props = {
  robots: RobotManaged[];
  onSelect: (id: string) => void;
};

export function RobotCardGrid({ robots, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {robots.map((robot) => {
        const seed = robot.slug.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0);
        const hue = seed % 360;
        const isUnoptimizedThumbnail = robot.thumbnailUrl?.startsWith('http') ?? false;
        return (
          <button
            key={robot.id}
            type="button"
            onClick={() => onSelect(robot.id)}
            aria-label={`Open dashboard for ${robot.name}`}
            className="group overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] text-left transition-colors hover:border-[var(--muted-foreground)]"
          >
            <div
              className="relative flex h-28 items-center justify-center overflow-hidden"
              style={!robot.thumbnailUrl ? { background: `hsla(${hue}, 55%, 45%, 0.2)` } : undefined}
            >
              {robot.thumbnailUrl ? (
                <Image
                  src={robot.thumbnailUrl}
                  alt={robot.name}
                  fill
                  unoptimized={isUnoptimizedThumbnail}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <>
                  <span className="relative text-3xl font-bold text-white/70">{robot.name.trim().charAt(0).toUpperCase()}</span>
                </>
              )}
              <div className="absolute left-2 top-2">
                {robot.status === 'ONLINE' ? (
                  <span className="flex items-center gap-1 rounded-md bg-[var(--live)]/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" />
                    LIVE
                  </span>
                ) : (
                  <span className="rounded-md bg-zinc-700/90 px-2 py-0.5 text-[10px] font-medium text-zinc-300">Offline</span>
                )}
              </div>
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-semibold transition-colors group-hover:text-violet-400">{robot.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">/{robot.slug}</p>
              {robot.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {robot.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
