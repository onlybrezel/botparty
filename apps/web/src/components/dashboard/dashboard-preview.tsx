'use client';

import type { RefObject } from 'react';
import { ExternalLink } from 'lucide-react';
import type { RobotManaged } from '@/lib/api';
import { LiveKitPlayer } from '@/components/livekit-player';

type Props = {
  robot: RobotManaged;
  roomHref: string;
  preview: { token: string; url: string } | null;
  previewVersion: number;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  onStreamStalled: () => void;
};

export function DashboardPreview({
  robot,
  roomHref,
  preview,
  previewVersion,
  previewContainerRef,
  onStreamStalled,
}: Props) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-[var(--border)] bg-black">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          {robot.status === 'ONLINE' ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
              LIVE
            </span>
          ) : (
            <span className="text-xs text-zinc-300">Offline</span>
          )}
        </div>
        <a
          href={roomHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-zinc-300 transition hover:text-white"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </a>
      </div>

      <div
        ref={previewContainerRef}
        className={`relative w-full bg-zinc-950 ${preview || robot.status === 'ONLINE' ? 'aspect-video' : 'h-36 sm:h-48'}`}
      >
        {preview ? (
          <LiveKitPlayer
            key={`${robot.id}-${previewVersion}`}
            token={preview.token}
            livekitUrl={preview.url}
            streamConfig={robot.metadata?.stream}
            onStreamStalled={onStreamStalled}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-300">
            {robot.status === 'ONLINE' ? 'Connecting...' : 'Robot is offline'}
          </div>
        )}
      </div>
    </div>
  );
}
