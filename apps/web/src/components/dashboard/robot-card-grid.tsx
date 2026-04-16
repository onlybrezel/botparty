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
        return (
          <button
            key={robot.id}
            type="button"
            onClick={() => onSelect(robot.id)}
            aria-label={`Open dashboard for ${robot.name}`}
            className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition hover:border-violet-500/40 hover:-translate-y-0.5"
          >
            <div
              className="relative flex h-28 items-center justify-center overflow-hidden"
              style={!robot.thumbnailUrl ? { background: `linear-gradient(135deg, hsla(${hue}, 75%, 55%, 0.25), hsla(${(hue + 50) % 360}, 80%, 50%, 0.08))` } : undefined}
            >
              {robot.thumbnailUrl ? (
                <Image
                  src={robot.thumbnailUrl}
                  alt={robot.name}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <>
                  <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.25), transparent 45%)' }} />
                  <span className="relative text-3xl font-black text-white/60">{robot.name.trim().charAt(0).toUpperCase()}</span>
                </>
              )}
              <div className="absolute left-2 top-2">
                {robot.status === 'ONLINE' ? (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--live)]/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse-dot" />
                    LIVE
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-700/90 px-2 py-0.5 text-[10px] font-medium text-zinc-300">Offline</span>
                )}
              </div>
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-semibold transition-colors group-hover:text-violet-400">{robot.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">/{robot.slug}</p>
              {robot.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {robot.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">{tag}</span>
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
