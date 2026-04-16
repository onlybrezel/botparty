'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RobotPublic } from '@botparty/shared';
import { api } from '@/lib/api';
import { LiveKitPlayer } from '@/components/livekit-player';

type Props = {
  robot: RobotPublic;
};

export function EmbedRobotView({ robot }: Props) {
  const [livekitCreds, setLivekitCreds] = useState<{ token: string; url: string } | null>(null);
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [version, setVersion] = useState(0);
  const refreshAttemptsRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const isOnline = robot.status === 'ONLINE' || robot.status === 'BUSY';

  const refreshViewerToken = useCallback(async (forceRemount = false) => {
    if (!isOnline || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    setVideoState('loading');
    try {
      api.setToken(null);
      const publicUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      const { token, livekitUrl } = await api.getPublicViewerToken(robot.id);
      setLivekitCreds({ token, url: publicUrl ?? livekitUrl });
      setVideoState('ready');
      refreshAttemptsRef.current = 0;
      if (forceRemount) {
        setVersion((prev) => prev + 1);
      }
    } catch {
      refreshAttemptsRef.current += 1;
      setLivekitCreds(null);
      setVideoState('error');
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [isOnline, robot.id]);

  useEffect(() => {
    if (!isOnline) {
      setVideoState('idle');
      setLivekitCreds(null);
      return;
    }

    void refreshViewerToken(false);
  }, [isOnline, refreshViewerToken]);

  useEffect(() => {
    if (!isOnline || livekitCreds || refreshInFlightRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshViewerToken(true);
    }, Math.min(3000 * Math.pow(1.5, refreshAttemptsRef.current), 30000));

    return () => window.clearTimeout(timer);
  }, [isOnline, livekitCreds, refreshViewerToken]);

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">{robot.name}</p>
          <p className="text-xs text-white/60">
            {isOnline ? 'Live robot stream' : 'Robot currently offline'}
          </p>
        </div>
        <Link
          href={`/robot/${robot.owner.username}/${robot.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/85 transition hover:border-white/30 hover:text-white"
        >
          Open full room
        </Link>
      </div>

      <div className="relative flex-1 bg-zinc-950">
        {isOnline && livekitCreds ? (
          <LiveKitPlayer
            key={`${robot.id}-${version}`}
            token={livekitCreds.token}
            livekitUrl={livekitCreds.url}
            streamConfig={robot.metadata?.stream}
            onStreamStalled={() => {
              void refreshViewerToken(true);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/65">
            {isOnline && videoState === 'loading'
              ? 'Connecting to the live robot feed...'
              : isOnline
                ? 'The live robot feed is temporarily unavailable.'
                : 'This robot is currently offline.'}
          </div>
        )}
      </div>
    </div>
  );
}
