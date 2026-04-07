'use client';

import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useRoomContext, useTracks } from '@livekit/components-react';
import { Track, type RemoteVideoTrack } from 'livekit-client';
import type { TrackReference } from '@livekit/components-core';
import type { RobotStreamCameraConfig } from '@botparty/shared';
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
  jitterBufferMs: number | null;
  audioJitterBufferMs: number | null;
  roundTripMs: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  readyState: number | null;
  audioLevel: number | null;
  concealedSamples: number | null;
  audioMuted: string;
  transportProtocol: string;
  localCandidateType: string;
  remoteCandidateType: string;
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

type CandidateStats = RTCStats & {
  candidateType?: string;
  protocol?: string;
};

type StreamConfig = {
  activeCameraId?: string;
  cameras?: RobotStreamCameraConfig[];
} | null | undefined;

type CameraTrackView = {
  id: string;
  label: string;
  role: string | null;
  order: number;
  trackRef: TrackReference;
  trackName: string;
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

function prettifyCameraId(id: string) {
  return id
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (part) => part.toUpperCase()) || 'Camera';
}

function readTrackName(trackRef: TrackReference) {
  const publication = trackRef.publication as { trackName?: string; name?: string } | undefined;
  return publication?.trackName ?? publication?.name ?? '';
}

function parseCameraIdFromTrackName(trackName: string) {
  const trimmed = trackName.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'camera') {
    return 'front';
  }

  const match = /^camera[.:]([a-zA-Z0-9_-]+)$/.exec(trimmed);
  if (match) {
    return match[1];
  }

  return null;
}

function buildCameraTracks(trackRefs: TrackReference[], streamConfig?: StreamConfig): CameraTrackView[] {
  const configuredCameras = streamConfig?.cameras ?? [];

  return trackRefs
    .map((trackRef, index) => {
      const trackName = readTrackName(trackRef);
      const parsedCameraId = parseCameraIdFromTrackName(trackName);
      const configured =
        (parsedCameraId ? configuredCameras.find((camera) => camera.id === parsedCameraId) : undefined)
        ?? configuredCameras[index];
      const id = configured?.id ?? parsedCameraId ?? `camera-${index + 1}`;
      const label = configured?.label?.trim() || prettifyCameraId(id);
      const role = configured?.role?.trim() || (index === 0 ? 'primary' : null);
      const order = configuredCameras.findIndex((camera) => camera.id === id);

      return {
        id,
        label,
        role,
        order: order >= 0 ? order : index,
        trackRef,
        trackName,
      };
    })
    .sort((left, right) => {
      const leftPrimary = streamConfig?.activeCameraId === left.id || left.role === 'primary';
      const rightPrimary = streamConfig?.activeCameraId === right.id || right.role === 'primary';
      if (leftPrimary !== rightPrimary) {
        return leftPrimary ? -1 : 1;
      }
      return left.order - right.order;
    });
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
    `Video jitter buffer: ${formatStat(stats.jitterBufferMs, ' ms')}`,
    `Audio jitter buffer: ${formatStat(stats.audioJitterBufferMs, ' ms')}`,
    `RTT: ${formatStat(stats.roundTripMs, ' ms')}`,
    `Transport: ${stats.transportProtocol}`,
    `Local candidate: ${stats.localCandidateType}`,
    `Remote candidate: ${stats.remoteCandidateType}`,
    `Video readyState: ${formatStat(stats.readyState)}`,
    `Audio level: ${formatPercent(stats.audioLevel)}`,
    `Concealed samples: ${formatStat(stats.concealedSamples)}`,
    `Audio muted: ${stats.audioMuted}`,
  ].join('\n');
}

function VideoRenderer({
  onStreamStalled,
  streamConfig,
}: {
  onStreamStalled?: () => void;
  streamConfig?: StreamConfig;
}) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const audioTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }]);
  const room = useRoomContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryVideoRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<NerdStats | null>(null);
  const [history, setHistory] = useState<StatHistoryPoint[]>([]);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [showVolumeControls, setShowVolumeControls] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(streamConfig?.activeCameraId ?? null);
  const hadTrackRef = useRef(false);
  const stallNotifiedRef = useRef(false);
  const volumeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishedTracks = tracks.filter((track) => track.publication !== undefined) as TrackReference[];
  const cameraTracks = buildCameraTracks(publishedTracks, streamConfig);
  const hasMultipleCameras = cameraTracks.length > 1;
  const cameraTrackIdsKey = cameraTracks.map((camera) => camera.id).join('|');
  const robotTrack =
    cameraTracks.find((camera) => camera.id === selectedCameraId)?.trackRef
    ?? cameraTracks[0]?.trackRef;
  const selectedCamera =
    cameraTracks.find((camera) => camera.trackRef.publication?.trackSid === robotTrack?.publication?.trackSid)
    ?? cameraTracks[0];
  const previewTracks = cameraTracks.filter((camera) => camera.id !== selectedCamera?.id).slice(0, 3);
  const robotAudioTracks = audioTracks.filter((t) => t.publication !== undefined) as TrackReference[];
  const videoPublication = robotTrack?.publication;
  const videoTrack = videoPublication?.videoTrack;
  const audioPublication = robotAudioTracks[0]?.publication;
  const audioTrack = audioPublication?.audioTrack;

  useEffect(() => {
    if (cameraTracks.length === 0) {
      setSelectedCameraId(null);
      return;
    }

    setSelectedCameraId((current) => {
      if (current && cameraTracks.some((camera) => camera.id === current)) {
        return current;
      }

      if (streamConfig?.activeCameraId && cameraTracks.some((camera) => camera.id === streamConfig.activeCameraId)) {
        return streamConfig.activeCameraId;
      }

      return cameraTracks[0]?.id ?? null;
    });
  }, [cameraTrackIdsKey, streamConfig?.activeCameraId]);

  useEffect(() => {
    let active = true;

    const startAudio = async () => {
      try {
        await room.startAudio();
      } catch {
        // Browser may require a user gesture before audio playback is allowed.
      }
    };

    void startAudio();

    const onUserGesture = () => {
      if (!active) {
        return;
      }
      void startAudio();
    };

    window.addEventListener('pointerdown', onUserGesture, { passive: true });
    window.addEventListener('keydown', onUserGesture);

    return () => {
      active = false;
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
    };
  }, [room]);

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

  // Minimize the browser WebRTC jitter buffer. playoutDelayHint is Chrome-specific
  // but silently ignored elsewhere. Setting it to 0 tells Chrome to target the
  // smallest possible playout queue, which alone can cut 300-600 ms of latency.
  useEffect(() => {
    if (!videoTrack) {
      return;
    }
    try {
      const receiver = (videoTrack as RemoteVideoTrack & { receiver?: RTCRtpReceiver }).receiver;
      if (receiver && 'playoutDelayHint' in receiver) {
        (receiver as RTCRtpReceiver & { playoutDelayHint: number }).playoutDelayHint = 0;
      }
    } catch {
      // best-effort, not supported in all browsers
    }
  }, [videoTrack]);

  useEffect(() => {
    if (!videoTrack || !videoPublication) {
      return;
    }

    let cancelled = false;

    const collectStats = async () => {
      const videoElement = primaryVideoRef.current?.querySelector('video') ?? null;
      const report = await videoTrack.getRTCStatsReport().catch(() => undefined);
      const audioReport = audioTrack ? await audioTrack.getRTCStatsReport().catch(() => undefined) : undefined;

      let inbound: RTCInboundRtpStreamStats | undefined;
      let audioInbound: RTCInboundRtpStreamStats | undefined;
      let candidatePair: RTCIceCandidatePairStats | undefined;
      let localCandidate: CandidateStats | undefined;
      let remoteCandidate: CandidateStats | undefined;

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
        if (entry.type === 'local-candidate') {
          localCandidate = entry as CandidateStats;
        }
        if (entry.type === 'remote-candidate') {
          remoteCandidate = entry as CandidateStats;
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
        jitterBufferMs:
          typeof inbound?.jitterBufferDelay === 'number' && typeof inbound?.jitterBufferEmittedCount === 'number' && inbound.jitterBufferEmittedCount > 0
            ? Math.round((inbound.jitterBufferDelay / inbound.jitterBufferEmittedCount) * 1000)
            : null,
        audioJitterBufferMs:
          typeof audioInbound?.jitterBufferDelay === 'number' &&
          typeof audioInbound?.jitterBufferEmittedCount === 'number' &&
          audioInbound.jitterBufferEmittedCount > 0
            ? Math.round((audioInbound.jitterBufferDelay / audioInbound.jitterBufferEmittedCount) * 1000)
            : null,
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
        transportProtocol: localCandidate?.protocol ?? remoteCandidate?.protocol ?? 'n/a',
        localCandidateType: localCandidate?.candidateType ?? 'n/a',
        remoteCandidateType: remoteCandidate?.candidateType ?? 'n/a',
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

  useEffect(() => {
    const scheduleHide = () => {
      if (volumeHideTimeoutRef.current) {
        clearTimeout(volumeHideTimeoutRef.current);
      }
      volumeHideTimeoutRef.current = setTimeout(() => {
        setShowVolumeControls(false);
      }, 2200);
    };

    scheduleHide();

    return () => {
      if (volumeHideTimeoutRef.current) {
        clearTimeout(volumeHideTimeoutRef.current);
      }
    };
  }, []);

  const revealVolumeControls = () => {
    setShowVolumeControls(true);
    if (volumeHideTimeoutRef.current) {
      clearTimeout(volumeHideTimeoutRef.current);
    }
    volumeHideTimeoutRef.current = setTimeout(() => {
      setShowVolumeControls(false);
    }, 2200);
  };

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
    <div
      ref={containerRef}
      onContextMenu={openPanel}
      onPointerMove={revealVolumeControls}
      onPointerDown={revealVolumeControls}
      className="relative h-full w-full select-none"
    >
      <div ref={primaryVideoRef} className="h-full w-full">
        <VideoTrack
          trackRef={robotTrack}
          className="h-full w-full object-cover"
        />
      </div>

      {selectedCamera && (
        <div className="absolute left-3 top-12 z-10 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          {selectedCamera.label}
        </div>
      )}

      {hasMultipleCameras && previewTracks.length > 0 && (
        <div className="absolute right-3 top-3 z-10 flex w-28 flex-col gap-2 sm:w-32">
          {previewTracks.map((camera) => (
            <button
              key={camera.id}
              type="button"
              onClick={() => setSelectedCameraId(camera.id)}
              className={`group overflow-hidden rounded-xl border bg-black/45 text-left text-white shadow-lg backdrop-blur-sm transition ${
                selectedCameraId === camera.id
                  ? 'border-cyan-300/70 ring-1 ring-cyan-300/40'
                  : 'border-white/15 hover:border-cyan-300/60'
              }`}
              aria-label={`Show ${camera.label}`}
              title={`Show ${camera.label}`}
            >
              <div className="aspect-video bg-black/50">
                <VideoTrack
                  trackRef={camera.trackRef}
                  className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                />
              </div>
              <div className="px-2 py-1.5 text-[11px] font-medium">
                {camera.label}
              </div>
            </button>
          ))}
        </div>
      )}

      <div
        className={`absolute bottom-3 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-2.5 py-2 text-white backdrop-blur-sm ${
          hasMultipleCameras ? 'right-3' : 'left-3'
        }`}
        onPointerEnter={revealVolumeControls}
      >
        <button
          type="button"
          onClick={() => {
            revealVolumeControls();
            setIsMuted((value) => !value);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label={isMuted ? 'Unmute stream audio' : 'Mute stream audio'}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <div
          className={`flex items-center gap-2 overflow-hidden transition-all duration-200 ${
            showVolumeControls ? 'max-w-28 opacity-100 sm:max-w-32' : 'max-w-0 opacity-0'
          }`}
          aria-hidden={!showVolumeControls}
        >
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(event) => {
              revealVolumeControls();
              const nextValue = Number(event.target.value);
              setVolume(nextValue);
              if (nextValue > 0 && isMuted) {
                setIsMuted(false);
              }
            }}
            className="h-1.5 w-16 accent-cyan-300 sm:w-20"
            aria-label="Stream volume"
            title={`Volume ${volume}%`}
          />
          <span className="min-w-8 text-right text-[11px] tabular-nums text-white/90">{isMuted ? 0 : volume}%</span>
        </div>
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
              <p className="text-slate-400">Video buffer</p>
              <p>{formatStat(stats?.jitterBufferMs, ' ms')}</p>
              <p className="text-slate-400">Audio buffer</p>
              <p>{formatStat(stats?.audioJitterBufferMs, ' ms')}</p>
              <p className="text-slate-400">Transport</p>
              <p>{formatStat(stats?.transportProtocol)}</p>
              <p className="text-slate-400">Local candidate</p>
              <p>{formatStat(stats?.localCandidateType)}</p>
              <p className="text-slate-400">Remote candidate</p>
              <p>{formatStat(stats?.remoteCandidateType)}</p>
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
  streamConfig?: StreamConfig;
}

export function LiveKitPlayer({ token, livekitUrl, onStreamStalled, streamConfig }: Props) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      options={{ adaptiveStream: false, dynacast: false }}
      video={false}
      audio={false}
      className="relative h-full w-full"
    >
      {/* Render remote participant audio tracks into hidden audio elements. */}
      <RoomAudioRenderer />
      <VideoRenderer onStreamStalled={onStreamStalled} streamConfig={streamConfig} />
    </LiveKitRoom>
  );
}
