'use client';

import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useRoomContext, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-core';
import { Check, Copy, Radio, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

type NerdStats = {
  timestamp: string;
  connectionState: string;
  participantQuality: string;
  trackSid: string;
  mimeType: string;
  source: string;
  subscription: string;
  streamState: string;
  bitrateKbps: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesDropped: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
  roundTripMs: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  readyState: number | null;
};

type PanelPosition = {
  x: number;
  y: number;
};

function formatStat(value: string | number | null | undefined, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  return `${value}${suffix}`;
}

function maskIdentifier(value: string | undefined, visible = 8) {
  if (!value) {
    return 'n/a';
  }
  if (value.length <= visible) {
    return value;
  }
  return `${value.slice(0, visible)}...`;
}

function statsToClipboardText(stats: NerdStats | null) {
  if (!stats) {
    return 'Stats for nerds: no data yet';
  }

  return [
    `Updated: ${stats.timestamp}`,
    `Room state: ${stats.connectionState}`,
    `Connection quality: ${stats.participantQuality}`,
    `Track: ${stats.trackSid}`,
    `Mime: ${stats.mimeType}`,
    `Source: ${stats.source}`,
    `Subscription: ${stats.subscription}`,
    `Stream state: ${stats.streamState}`,
    `Bitrate: ${formatStat(stats.bitrateKbps, ' kbps')}`,
    `FPS: ${formatStat(stats.framesPerSecond)}`,
    `Inbound size: ${formatStat(stats.frameWidth)} x ${formatStat(stats.frameHeight)}`,
    `Rendered size: ${formatStat(stats.videoWidth)} x ${formatStat(stats.videoHeight)}`,
    `Frames dropped: ${formatStat(stats.framesDropped)}`,
    `Packets lost: ${formatStat(stats.packetsLost)}`,
    `Jitter: ${formatStat(stats.jitterMs, ' ms')}`,
    `RTT: ${formatStat(stats.roundTripMs, ' ms')}`,
    `Video readyState: ${formatStat(stats.readyState)}`,
  ].join('\n');
}

function VideoRenderer({ onStreamStalled }: { onStreamStalled?: () => void }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const audioTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }]);
  const room = useRoomContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<NerdStats | null>(null);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const hadTrackRef = useRef(false);
  const stallNotifiedRef = useRef(false);
  // Filter out placeholder tracks (no publication)
  const robotTrack = tracks.find((t) => t.publication !== undefined) as TrackReference | undefined;
  const robotAudioTracks = audioTracks.filter((t) => t.publication !== undefined) as TrackReference[];

  useEffect(() => {
    const nextVolume = isMuted ? 0 : volume / 100;
    for (const track of robotAudioTracks) {
      const audioTrack = track.publication?.audioTrack as { setVolume?: (value: number) => void } | undefined;
      if (typeof audioTrack?.setVolume === 'function') {
        audioTrack.setVolume(nextVolume);
      }
    }
  }, [robotAudioTracks, volume, isMuted]);

  useEffect(() => {
    const connected = String(room.state).toLowerCase() === 'connected';

    if (robotTrack) {
      hadTrackRef.current = true;
      stallNotifiedRef.current = false;
      return;
    }

    if (!connected || !hadTrackRef.current || stallNotifiedRef.current || !onStreamStalled) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (stallNotifiedRef.current) {
        return;
      }
      stallNotifiedRef.current = true;
      onStreamStalled();
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [robotTrack, room.state, onStreamStalled]);

  useEffect(() => {
    if (!panelPosition || !robotTrack?.publication?.videoTrack) {
      return;
    }

    let cancelled = false;

    const collectStats = async () => {
      const publication = robotTrack.publication;
      const remoteVideoTrack = publication.videoTrack;
      if (!remoteVideoTrack) {
        return;
      }

      const videoElement = containerRef.current?.querySelector('video') ?? null;
      const report = await remoteVideoTrack.getRTCStatsReport().catch(() => undefined);

      let inbound: RTCInboundRtpStreamStats | undefined;
      let candidatePair: RTCIceCandidatePairStats | undefined;

      report?.forEach((entry) => {
        if (entry.type === 'inbound-rtp' && (entry as RTCInboundRtpStreamStats).kind === 'video') {
          inbound = entry as RTCInboundRtpStreamStats;
        }
        if (entry.type === 'candidate-pair' && (entry as RTCIceCandidatePairStats).state === 'succeeded') {
          const selected = (entry as RTCIceCandidatePairStats & { selected?: boolean }).selected;
          if (selected === true || candidatePair === undefined) {
            candidatePair = entry as RTCIceCandidatePairStats;
          }
        }
      });

      if (cancelled) {
        return;
      }

      setStats({
        timestamp: new Date().toLocaleTimeString(),
        connectionState: String(room.state),
        participantQuality: String(robotTrack.participant.connectionQuality),
        trackSid: maskIdentifier(publication.trackSid),
        mimeType: publication.mimeType ?? 'n/a',
        source: String(publication.source),
        subscription: publication.isSubscribed ? 'subscribed' : 'not-subscribed',
        streamState: String(remoteVideoTrack.streamState),
        bitrateKbps: remoteVideoTrack.currentBitrate ? Math.round(remoteVideoTrack.currentBitrate / 1000) : null,
        framesPerSecond:
          typeof inbound?.framesPerSecond === 'number' ? Math.round(inbound.framesPerSecond * 10) / 10 : null,
        frameWidth: inbound?.frameWidth ?? publication.dimensions?.width ?? null,
        frameHeight: inbound?.frameHeight ?? publication.dimensions?.height ?? null,
        framesDropped: inbound?.framesDropped ?? null,
        packetsLost: inbound?.packetsLost ?? null,
        jitterMs: typeof inbound?.jitter === 'number' ? Math.round(inbound.jitter * 1000) : null,
        roundTripMs:
          typeof candidatePair?.currentRoundTripTime === 'number'
            ? Math.round(candidatePair.currentRoundTripTime * 1000)
            : null,
        videoWidth: videoElement?.videoWidth ?? null,
        videoHeight: videoElement?.videoHeight ?? null,
        readyState: videoElement?.readyState ?? null,
      });
    };

    void collectStats();
    const interval = window.setInterval(() => {
      void collectStats();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [panelPosition, robotTrack, room]);

  useEffect(() => {
    if (!panelPosition) {
      return;
    }

    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') {
        return;
      }
      setPanelPosition(null);
    };

    window.addEventListener('click', close);
    window.addEventListener('keydown', close);

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [panelPosition]);

  useEffect(() => {
    if (copyState === 'idle') {
      return;
    }

    const timeout = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const openPanel = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPanelPosition({
      x: Math.min(event.clientX, window.innerWidth - 20),
      y: Math.min(event.clientY, window.innerHeight - 20),
    });
  };

  const copyStats = async () => {
    try {
      await navigator.clipboard.writeText(statsToClipboardText(stats));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  if (!robotTrack) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted-foreground)]">
        <Radio className="h-8 w-8 text-violet-300/60" />
        <p className="text-sm">Waiting for robot video stream...</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} onContextMenu={openPanel} className="relative h-full w-full select-none">
      <VideoTrack
        trackRef={robotTrack}
        className="h-full w-full object-cover"
      />

      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-3 py-2 text-white backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setIsMuted((value) => !value)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label={isMuted ? 'Unmute stream audio' : 'Mute stream audio'}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          onChange={(event) => {
            const nextValue = Number(event.target.value);
            setVolume(nextValue);
            if (nextValue > 0 && isMuted) {
              setIsMuted(false);
            }
          }}
          className="h-1.5 w-24 accent-cyan-300"
          aria-label="Stream volume"
          title={`Volume ${volume}%`}
        />
        <span className="min-w-10 text-right text-xs tabular-nums text-white/90">{isMuted ? 0 : volume}%</span>
      </div>

      {panelPosition && (
        <div
          className="fixed z-[70] w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950/92 text-[11px] text-slate-100 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.max(8, Math.min(panelPosition.x, window.innerWidth - 392)),
            top: Math.max(8, Math.min(panelPosition.y, window.innerHeight - 320)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-cyan-400/10 px-3 py-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/70">Stats</p>
              <p className="mt-1 text-xs font-semibold text-white">Local stream diagnostics</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void copyStats()}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                {copyState === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Retry' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setPanelPosition(null)}
                className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Close stats panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3">
            <p className="text-slate-400">Updated</p>
            <p>{stats?.timestamp ?? 'collecting...'}</p>
            <p className="text-slate-400">Room state</p>
            <p>{formatStat(stats?.connectionState)}</p>
            <p className="text-slate-400">Connection quality</p>
            <p>{formatStat(stats?.participantQuality)}</p>
            <p className="text-slate-400">Track</p>
            <p>{formatStat(stats?.trackSid)}</p>
            <p className="text-slate-400">Mime</p>
            <p className="truncate">{formatStat(stats?.mimeType)}</p>
            <p className="text-slate-400">Source</p>
            <p>{formatStat(stats?.source)}</p>
            <p className="text-slate-400">Subscription</p>
            <p>{formatStat(stats?.subscription)}</p>
            <p className="text-slate-400">Stream state</p>
            <p>{formatStat(stats?.streamState)}</p>
            <p className="text-slate-400">Bitrate</p>
            <p>{formatStat(stats?.bitrateKbps, ' kbps')}</p>
            <p className="text-slate-400">FPS</p>
            <p>{formatStat(stats?.framesPerSecond)}</p>
            <p className="text-slate-400">Inbound size</p>
            <p>{formatStat(stats?.frameWidth)} x {formatStat(stats?.frameHeight)}</p>
            <p className="text-slate-400">Rendered size</p>
            <p>{formatStat(stats?.videoWidth)} x {formatStat(stats?.videoHeight)}</p>
            <p className="text-slate-400">Frames dropped</p>
            <p>{formatStat(stats?.framesDropped)}</p>
            <p className="text-slate-400">Packets lost</p>
            <p>{formatStat(stats?.packetsLost)}</p>
            <p className="text-slate-400">Jitter</p>
            <p>{formatStat(stats?.jitterMs, ' ms')}</p>
            <p className="text-slate-400">RTT</p>
            <p>{formatStat(stats?.roundTripMs, ' ms')}</p>
            <p className="text-slate-400">Video readyState</p>
            <p>{formatStat(stats?.readyState)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  token: string;
  livekitUrl: string;
  onStreamStalled?: () => void;
}

export function LiveKitPlayer({ token, livekitUrl, onStreamStalled }: Props) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      options={{ adaptiveStream: false }}
      video={false}
      audio={false}
      className="relative h-full w-full"
    >
      {/* Render remote participant audio tracks into hidden audio elements. */}
      <RoomAudioRenderer />
      <VideoRenderer onStreamStalled={onStreamStalled} />
    </LiveKitRoom>
  );
}
