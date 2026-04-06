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
  audioTrackSid: string;
  mimeType: string;
  audioMimeType: string;
  source: string;
  subscription: string;
  streamState: string;
  bitrateKbps: number | null;
  audioBitrateKbps: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesDropped: number | null;
  packetsLost: number | null;
  audioPacketsLost: number | null;
  jitterMs: number | null;
  audioJitterMs: number | null;
  roundTripMs: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  readyState: number | null;
  audioLevel: number | null;
  concealedSamples: number | null;
  audioMuted: string;
};

type PanelPosition = {
  x: number;
  y: number;
};

type DragState = {
  offsetX: number;
  offsetY: number;
};

type StatHistoryPoint = {
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  roundTripMs: number | null;
};

type SparklineBounds = {
  min: number;
  max: number;
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

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  return `${value}%`;
}

function getSparklineBounds(
  values: Array<number | null>,
  {
    baseline = 0,
    minRange = 1,
    paddingRatio = 0.12,
  }: {
    baseline?: number;
    minRange?: number;
    paddingRatio?: number;
  } = {},
): SparklineBounds | null {
  const numericValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (numericValues.length === 0) {
    return null;
  }

  let min = Math.min(...numericValues, baseline);
  let max = Math.max(...numericValues, baseline);
  const rawRange = max - min;
  const paddedRange = Math.max(rawRange, minRange);
  const padding = paddedRange * paddingRatio;

  min -= padding;
  max += padding;

  if (baseline >= 0) {
    min = Math.max(0, min);
  }

  if (max - min < minRange) {
    const deficit = minRange - (max - min);
    min = Math.max(baseline >= 0 ? 0 : Number.NEGATIVE_INFINITY, min - deficit / 2);
    max += deficit / 2;
  }

  return { min, max };
}

function buildSparklinePath(values: Array<number | null>, width: number, height: number, bounds: SparklineBounds | null) {
  const numericValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (numericValues.length < 2 || !bounds) {
    return '';
  }

  const { min, max } = bounds;
  const range = Math.max(max - min, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  let path = '';
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      return;
    }
    const x = index * stepX;
    const y = height - ((value - min) / range) * height;
    path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
  });

  return path;
}

function Sparkline({
  label,
  value,
  suffix,
  values,
  stroke,
  baseline = 0,
  minRange = 1,
}: {
  label: string;
  value: number | null;
  suffix: string;
  values: Array<number | null>;
  stroke: string;
  baseline?: number;
  minRange?: number;
}) {
  const width = 132;
  const height = 36;
  const bounds = getSparklineBounds(values, { baseline, minRange });
  const path = buildSparklinePath(values, width, height, bounds);

  return (
    <div className="rounded-xl border border-white/8 bg-white/4 px-2 py-2">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <p className="text-xs font-semibold text-white">{formatStat(value, suffix)}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full overflow-visible">
        <path
          d={`M 0 ${height} L ${width} ${height}`}
          fill="none"
          stroke="rgba(148, 163, 184, 0.22)"
          strokeWidth="1"
        />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <text x="0" y="22" fill="rgba(148, 163, 184, 0.8)" fontSize="10">
            collecting...
          </text>
        )}
      </svg>
    </div>
  );
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
    `Audio track: ${stats.audioTrackSid}`,
    `Mime: ${stats.mimeType}`,
    `Audio mime: ${stats.audioMimeType}`,
    `Source: ${stats.source}`,
    `Subscription: ${stats.subscription}`,
    `Stream state: ${stats.streamState}`,
    `Video bitrate: ${formatStat(stats.bitrateKbps, ' kbps')}`,
    `Audio bitrate: ${formatStat(stats.audioBitrateKbps, ' kbps')}`,
    `FPS: ${formatStat(stats.framesPerSecond)}`,
    `Inbound size: ${formatStat(stats.frameWidth)} x ${formatStat(stats.frameHeight)}`,
    `Rendered size: ${formatStat(stats.videoWidth)} x ${formatStat(stats.videoHeight)}`,
    `Frames dropped: ${formatStat(stats.framesDropped)}`,
    `Video packets lost: ${formatStat(stats.packetsLost)}`,
    `Audio packets lost: ${formatStat(stats.audioPacketsLost)}`,
    `Video jitter: ${formatStat(stats.jitterMs, ' ms')}`,
    `Audio jitter: ${formatStat(stats.audioJitterMs, ' ms')}`,
    `RTT: ${formatStat(stats.roundTripMs, ' ms')}`,
    `Video readyState: ${formatStat(stats.readyState)}`,
    `Audio level: ${formatPercent(stats.audioLevel)}`,
    `Concealed samples: ${formatStat(stats.concealedSamples)}`,
    `Audio muted: ${stats.audioMuted}`,
  ].join('\n');
}

function VideoRenderer({ onStreamStalled }: { onStreamStalled?: () => void }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const audioTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }]);
  const room = useRoomContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<NerdStats | null>(null);
  const [history, setHistory] = useState<StatHistoryPoint[]>([]);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const hadTrackRef = useRef(false);
  const stallNotifiedRef = useRef(false);
  // Filter out placeholder tracks (no publication)
  const robotTrack = tracks.find((t) => t.publication !== undefined) as TrackReference | undefined;
  const robotAudioTracks = audioTracks.filter((t) => t.publication !== undefined) as TrackReference[];
  const videoPublication = robotTrack?.publication;
  const videoTrack = videoPublication?.videoTrack;
  const audioPublication = robotAudioTracks[0]?.publication;
  const audioTrack = audioPublication?.audioTrack;

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
    if (!videoTrack || !videoPublication) {
      return;
    }

    let cancelled = false;

    const collectStats = async () => {
      const videoElement = containerRef.current?.querySelector('video') ?? null;
      const report = await videoTrack.getRTCStatsReport().catch(() => undefined);
      const audioReport = audioTrack ? await audioTrack.getRTCStatsReport().catch(() => undefined) : undefined;

      let inbound: RTCInboundRtpStreamStats | undefined;
      let audioInbound: RTCInboundRtpStreamStats | undefined;
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

      audioReport?.forEach((entry) => {
        if (entry.type === 'inbound-rtp' && (entry as RTCInboundRtpStreamStats).kind === 'audio') {
          audioInbound = entry as RTCInboundRtpStreamStats;
        }
      });

      if (cancelled) {
        return;
      }

      const nextStats: NerdStats = {
        timestamp: new Date().toLocaleTimeString(),
        connectionState: String(room.state),
        participantQuality: String(robotTrack.participant.connectionQuality),
        trackSid: maskIdentifier(videoPublication.trackSid),
        audioTrackSid: maskIdentifier(audioPublication?.trackSid),
        mimeType: videoPublication.mimeType ?? 'n/a',
        audioMimeType: audioPublication?.mimeType ?? 'n/a',
        source: String(videoPublication.source),
        subscription: videoPublication.isSubscribed ? 'subscribed' : 'not-subscribed',
        streamState: String(videoTrack.streamState),
        bitrateKbps: videoTrack.currentBitrate ? Math.round(videoTrack.currentBitrate / 1000) : null,
        audioBitrateKbps: audioTrack?.currentBitrate ? Math.round(audioTrack.currentBitrate / 1000) : null,
        framesPerSecond:
          typeof inbound?.framesPerSecond === 'number' ? Math.round(inbound.framesPerSecond * 10) / 10 : null,
        frameWidth: inbound?.frameWidth ?? videoPublication.dimensions?.width ?? null,
        frameHeight: inbound?.frameHeight ?? videoPublication.dimensions?.height ?? null,
        framesDropped: inbound?.framesDropped ?? null,
        packetsLost: inbound?.packetsLost ?? null,
        audioPacketsLost: audioInbound?.packetsLost ?? null,
        jitterMs: typeof inbound?.jitter === 'number' ? Math.round(inbound.jitter * 1000) : null,
        audioJitterMs: typeof audioInbound?.jitter === 'number' ? Math.round(audioInbound.jitter * 1000) : null,
        roundTripMs:
          typeof candidatePair?.currentRoundTripTime === 'number'
            ? Math.round(candidatePair.currentRoundTripTime * 1000)
            : null,
        videoWidth: videoElement?.videoWidth ?? null,
        videoHeight: videoElement?.videoHeight ?? null,
        readyState: videoElement?.readyState ?? null,
        audioLevel:
          typeof robotAudioTracks[0]?.participant.audioLevel === 'number'
            ? Math.round(robotAudioTracks[0].participant.audioLevel * 100)
            : null,
        concealedSamples: (audioInbound as RTCInboundRtpStreamStats & { concealedSamples?: number } | undefined)
          ?.concealedSamples ?? null,
        audioMuted: audioPublication?.isMuted ? 'muted' : 'live',
      };

      setStats(nextStats);
      setHistory((previous) => [
        ...previous.slice(-29),
        {
          videoBitrateKbps: nextStats.bitrateKbps,
          audioBitrateKbps: nextStats.audioBitrateKbps,
          roundTripMs: nextStats.roundTripMs,
        },
      ]);
    };

    void collectStats();
    const interval = window.setInterval(() => {
      void collectStats();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [audioPublication, audioTrack, robotTrack, room.state, videoPublication, videoTrack]);

  useEffect(() => {
    if (videoTrack) {
      return;
    }

    setStats(null);
    setHistory([]);
  }, [videoTrack]);

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
    if (!panelPosition || !dragState) {
      return;
    }

    const move = (event: MouseEvent) => {
      const panelWidth = Math.min(672, window.innerWidth - 16);
      const panelHeight = Math.min(420, window.innerHeight - 16);
      setPanelPosition({
        x: Math.max(8, Math.min(event.clientX - dragState.offsetX, window.innerWidth - panelWidth - 8)),
        y: Math.max(8, Math.min(event.clientY - dragState.offsetY, window.innerHeight - panelHeight - 8)),
      });
    };

    const stop = () => setDragState(null);

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
  }, [panelPosition, dragState]);

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
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 680)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 420)),
    });
  };

  const startDraggingPanel = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!panelPosition) {
      return;
    }
    event.preventDefault();
    setDragState({
      offsetX: event.clientX - panelPosition.x,
      offsetY: event.clientY - panelPosition.y,
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
          className="fixed z-[70] w-[min(42rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950/92 text-[11px] text-slate-100 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.max(8, Math.min(panelPosition.x, window.innerWidth - 680)),
            top: Math.max(8, Math.min(panelPosition.y, window.innerHeight - 420)),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="flex cursor-move items-center justify-between border-b border-white/10 bg-cyan-400/10 px-3 py-2"
            onMouseDown={startDraggingPanel}
          >
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

          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 md:grid-cols-[auto_1fr_auto_1fr]">
              <p className="text-slate-400">Updated</p>
              <p>{stats?.timestamp ?? 'collecting...'}</p>
              <p className="text-slate-400">Room state</p>
              <p>{formatStat(stats?.connectionState)}</p>
              <p className="text-slate-400">Connection quality</p>
              <p>{formatStat(stats?.participantQuality)}</p>
              <p className="text-slate-400">Track</p>
              <p>{formatStat(stats?.trackSid)}</p>
              <p className="text-slate-400">Audio track</p>
              <p>{formatStat(stats?.audioTrackSid)}</p>
              <p className="text-slate-400">Source</p>
              <p>{formatStat(stats?.source)}</p>
              <p className="text-slate-400">Video bitrate</p>
              <p>{formatStat(stats?.bitrateKbps, ' kbps')}</p>
              <p className="text-slate-400">Audio bitrate</p>
              <p>{formatStat(stats?.audioBitrateKbps, ' kbps')}</p>
              <p className="text-slate-400">FPS</p>
              <p>{formatStat(stats?.framesPerSecond)}</p>
              <p className="text-slate-400">RTT</p>
              <p>{formatStat(stats?.roundTripMs, ' ms')}</p>
              <p className="text-slate-400">Inbound size</p>
              <p>{formatStat(stats?.frameWidth)} x {formatStat(stats?.frameHeight)}</p>
              <p className="text-slate-400">Rendered size</p>
              <p>{formatStat(stats?.videoWidth)} x {formatStat(stats?.videoHeight)}</p>
              <p className="text-slate-400">Frames dropped</p>
              <p>{formatStat(stats?.framesDropped)}</p>
              <p className="text-slate-400">Video loss</p>
              <p>{formatStat(stats?.packetsLost)}</p>
              <p className="text-slate-400">Audio loss</p>
              <p>{formatStat(stats?.audioPacketsLost)}</p>
              <p className="text-slate-400">Video jitter</p>
              <p>{formatStat(stats?.jitterMs, ' ms')}</p>
              <p className="text-slate-400">Audio jitter</p>
              <p>{formatStat(stats?.audioJitterMs, ' ms')}</p>
              <p className="text-slate-400">Audio level</p>
              <p>{formatPercent(stats?.audioLevel)}</p>
              <p className="text-slate-400">Audio state</p>
              <p>{formatStat(stats?.audioMuted)}</p>
              <p className="text-slate-400">Mime</p>
              <p className="truncate">{formatStat(stats?.mimeType)}</p>
              <p className="text-slate-400">Audio mime</p>
              <p className="truncate">{formatStat(stats?.audioMimeType)}</p>
              <p className="text-slate-400">Stream state</p>
              <p>{formatStat(stats?.streamState)}</p>
              <p className="text-slate-400">Ready</p>
              <p>{formatStat(stats?.readyState)}</p>
              <p className="text-slate-400">Concealed</p>
              <p>{formatStat(stats?.concealedSamples)}</p>
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-white/8 px-3 py-3 md:border-l md:border-t-0">
              <Sparkline
                label="Video bitrate"
                value={stats?.bitrateKbps ?? null}
                suffix=" kbps"
                values={history.map((point) => point.videoBitrateKbps)}
                stroke="#22d3ee"
                minRange={120}
              />
              <Sparkline
                label="Audio bitrate"
                value={stats?.audioBitrateKbps ?? null}
                suffix=" kbps"
                values={history.map((point) => point.audioBitrateKbps)}
                stroke="#f59e0b"
                minRange={24}
              />
              <Sparkline
                label="RTT"
                value={stats?.roundTripMs ?? null}
                suffix=" ms"
                values={history.map((point) => point.roundTripMs)}
                stroke="#fb7185"
                minRange={40}
              />
            </div>
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
