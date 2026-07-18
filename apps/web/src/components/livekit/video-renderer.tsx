'use client';

import { VideoTrack, useRoomContext, useTracks } from '@livekit/components-react';
import { Track, RoomEvent, VideoQuality, type RemoteVideoTrack, type RemoteTrackPublication } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import { Maximize, Minimize, Radio, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  maskIdentifier,
  buildCameraTracks,
  clampFloatingPosition,
  type StreamConfig,
  type PanelPosition,
  type DragState,
  type VolumePreference,
} from './stats-utils';
import {
  StreamDiagnosticsPanel,
  type CandidateStats,
  type NerdStats,
  type StatHistoryPoint,
} from './stream-diagnostics-panel';


export function VideoRenderer({
  onStreamStalled,
  streamConfig,
  volumeStorageKey,
  volume,
  isMuted,
  onVolumeChange,
  onMutedChange,
}: {
  onStreamStalled?: () => void;
  streamConfig?: StreamConfig;
  volumeStorageKey?: string;
  volume: number;
  isMuted: boolean;
  onVolumeChange: (value: number) => void;
  onMutedChange: (value: boolean | ((value: boolean) => boolean)) => void;
}) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  const audioTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }]);
  const room = useRoomContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryVideoRef = useRef<HTMLDivElement>(null);
  const previewTrayRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<NerdStats | null>(null);
  const [history, setHistory] = useState<StatHistoryPoint[]>([]);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [showVolumeControls, setShowVolumeControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [previewTrayPosition, setPreviewTrayPosition] = useState<PanelPosition | null>(null);
  const [previewTrayDragState, setPreviewTrayDragState] = useState<DragState | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(streamConfig?.activeCameraId ?? null);
  const hadTrackRef = useRef(false);
  const stallNotifiedRef = useRef(false);
  const trackRecoveryTimeoutRef = useRef<number | null>(null);
  const volumeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishedTracks = useMemo(
    () => tracks.filter((track) => track.publication !== undefined) as TrackReference[],
    [tracks],
  );
  const cameraTracks = useMemo(
    () => buildCameraTracks(publishedTracks, streamConfig),
    [publishedTracks, streamConfig],
  );
  const hasMultipleCameras = cameraTracks.length > 1;
  const cameraTrackIdsKey = cameraTracks.map((camera) => camera.id).join('|');
  const robotTrack =
    cameraTracks.find((camera) => camera.id === selectedCameraId)?.trackRef
    ?? cameraTracks[0]?.trackRef;
  const selectedCamera =
    cameraTracks.find((camera) => camera.trackRef.publication?.trackSid === robotTrack?.publication?.trackSid)
    ?? cameraTracks[0];
  const previewTracks = useMemo(
    () => cameraTracks.filter((camera) => camera.id !== selectedCamera?.id).slice(0, 3),
    [cameraTracks, selectedCamera?.id],
  );
  const robotAudioTracks = useMemo(
    () => audioTracks.filter((track) => track.publication !== undefined) as TrackReference[],
    [audioTracks],
  );

  // Lazy track subscription: subscribe only to tracks that are displayed, unsubscribe hidden ones.
  // This avoids pulling bandwidth for cameras that aren't visible.
  useEffect(() => {
    const visibleSids = new Set<string>();
    if (selectedCamera?.trackRef.publication?.trackSid) {
      visibleSids.add(selectedCamera.trackRef.publication.trackSid);
    }
    for (const preview of previewTracks) {
      if (preview.trackRef.publication?.trackSid) {
        visibleSids.add(preview.trackRef.publication.trackSid);
      }
    }
    for (const camera of cameraTracks) {
      const pub = camera.trackRef.publication;
      if (!pub) continue;
      const shouldSubscribe = visibleSids.has(pub.trackSid);
      if (pub.isSubscribed !== shouldSubscribe) {
        (pub as RemoteTrackPublication).setSubscribed(shouldSubscribe);
      }
      if (shouldSubscribe) {
        const quality = pub.trackSid === selectedCamera?.trackRef.publication?.trackSid
          ? VideoQuality.HIGH
          : VideoQuality.LOW;
        (pub as RemoteTrackPublication).setVideoQuality(quality);
      }
    }
  }, [selectedCamera, previewTracks, cameraTracks]);
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
  }, [cameraTrackIdsKey, cameraTracks, streamConfig?.activeCameraId]);

  useLayoutEffect(() => {
    if (!hasMultipleCameras || previewTracks.length === 0) {
      setPreviewTrayPosition(null);
      return;
    }

    const container = containerRef.current;
    const tray = previewTrayRef.current;
    if (!container || !tray) {
      return;
    }

    const updatePosition = () => {
      const nextWidth = tray.offsetWidth;
      const nextHeight = tray.offsetHeight;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      setPreviewTrayPosition((current) => {
        if (!current) {
          return clampFloatingPosition(
            { x: containerWidth - nextWidth - 12, y: 12 },
            containerWidth,
            containerHeight,
            nextWidth,
            nextHeight,
          );
        }

        return clampFloatingPosition(
          current,
          containerWidth,
          containerHeight,
          nextWidth,
          nextHeight,
        );
      });
    };

    updatePosition();

    const resizeObserver = new ResizeObserver(() => {
      updatePosition();
    });
    resizeObserver.observe(container);
    resizeObserver.observe(tray);
    window.addEventListener('resize', updatePosition);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [hasMultipleCameras, previewTracks.length]);

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
    if (!volumeStorageKey || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      volumeStorageKey,
      JSON.stringify({
        volume,
        isMuted,
      } satisfies VolumePreference),
    );
  }, [isMuted, volume, volumeStorageKey]);

  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      void containerRef.current.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  };

  // Reset stall detection when the room successfully reconnects so a brief
  // SID update / network resume doesn't immediately trigger a token refresh.
  useEffect(() => {
    const onReconnected = () => {
      stallNotifiedRef.current = false;
    };
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room]);

  useEffect(() => {
    if (!onStreamStalled) {
      return;
    }

    const clearRecoveryTimeout = () => {
      if (trackRecoveryTimeoutRef.current) {
        window.clearTimeout(trackRecoveryTimeoutRef.current);
        trackRecoveryTimeoutRef.current = null;
      }
    };

    const scheduleTrackRecovery = (publication?: RemoteTrackPublication | null) => {
      const targetPublication = publication ?? (robotTrack?.publication as RemoteTrackPublication | undefined);
      if (!targetPublication || targetPublication.source !== Track.Source.Camera) {
        return;
      }

      stallNotifiedRef.current = false;
      clearRecoveryTimeout();
      trackRecoveryTimeoutRef.current = window.setTimeout(() => {
        const videoElement = primaryVideoRef.current?.querySelector('video') ?? null;
        const hasDecodedFrame = Boolean(videoElement && videoElement.readyState >= 2 && videoElement.videoWidth > 0);
        if (!hasDecodedFrame && !stallNotifiedRef.current) {
          stallNotifiedRef.current = true;
          onStreamStalled();
        }
      }, 3000);
    };

    const onTrackUnmuted = (...args: unknown[]) => {
      const publication =
        args.find(
          (value): value is RemoteTrackPublication =>
            typeof value === 'object'
            && value !== null
            && 'source' in value
            && 'trackSid' in value,
        ) ?? null;
      scheduleTrackRecovery(publication);
    };

    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted as never);
    return () => {
      clearRecoveryTimeout();
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted as never);
    };
  }, [onStreamStalled, robotTrack?.publication, room]);

  useEffect(() => {
    const connected = String(room.state).toLowerCase() === 'connected';

    if (robotTrack) {
      hadTrackRef.current = true;
      stallNotifiedRef.current = false;
      return;
    }

    if (!connected || stallNotifiedRef.current || !onStreamStalled) {
      return;
    }

    // If we already had video before, recover quickly. For initial joins with
    // no track yet, wait a bit longer before forcing a token refresh.
    const stallDelayMs = hadTrackRef.current ? 8000 : 15000;
    const timeout = window.setTimeout(() => {
      if (stallNotifiedRef.current) {
        return;
      }
      stallNotifiedRef.current = true;
      onStreamStalled();
    }, stallDelayMs);

    return () => window.clearTimeout(timeout);
  }, [robotTrack, room.state, onStreamStalled]);

  // Ask supported browsers for the smallest practical WebRTC playout buffer.
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
    }, panelPosition ? 1000 : 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [audioPublication, audioTrack, panelPosition, robotAudioTracks, robotTrack, room.state, videoPublication, videoTrack]);

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
    if (!previewTrayPosition || !previewTrayDragState) {
      return;
    }

    const move = (event: MouseEvent) => {
      const container = containerRef.current;
      const tray = previewTrayRef.current;
      if (!container || !tray) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const nextPosition = clampFloatingPosition(
        {
          x: event.clientX - rect.left - previewTrayDragState.offsetX,
          y: event.clientY - rect.top - previewTrayDragState.offsetY,
        },
        rect.width,
        rect.height,
        tray.offsetWidth,
        tray.offsetHeight,
      );

      setPreviewTrayPosition(nextPosition);
    };

    const stop = () => setPreviewTrayDragState(null);

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
  }, [previewTrayPosition, previewTrayDragState]);

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

  const startDraggingPreviewTray = (event: ReactMouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const tray = previewTrayRef.current;
    if (!container || !tray || !previewTrayPosition) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = tray.getBoundingClientRect();
    setPreviewTrayDragState({
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    });
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

      {stats?.roundTripMs !== null && stats?.roundTripMs !== undefined && (
        <div className="absolute right-3 top-3 z-10 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          Latency {stats.roundTripMs} ms
        </div>
      )}

      {hasMultipleCameras && previewTracks.length > 0 && (
        <div
          ref={previewTrayRef}
          className={`absolute z-10 flex w-28 flex-col gap-2 sm:w-32 ${
            previewTrayPosition ? '' : 'right-3 top-3'
          }`}
          style={
            previewTrayPosition
              ? {
                  left: previewTrayPosition.x,
                  top: previewTrayPosition.y,
                }
              : undefined
          }
          onMouseDown={startDraggingPreviewTray}
        >
          {previewTracks.map((camera) => (
            <button
              key={camera.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedCameraId(camera.id);
              }}
              className="group relative overflow-hidden rounded-xl bg-black/35 text-left text-white shadow-lg backdrop-blur-sm transition hover:scale-[1.01]"
              aria-label={`Show ${camera.label}`}
              title={`Show ${camera.label}`}
            >
              <div className="aspect-video bg-black/50">
                <VideoTrack
                  trackRef={camera.trackRef}
                  className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                />
              </div>
              <span className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                {camera.label}
              </span>
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
            onMutedChange((value) => !value);
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
              onVolumeChange(nextValue);
              if (nextValue > 0 && isMuted) {
                onMutedChange(false);
              }
            }}
            className="h-1.5 w-16 accent-cyan-300 sm:w-20"
            aria-label="Stream volume"
            title={`Volume ${volume}%`}
          />
          <span className="min-w-8 text-right text-[11px] tabular-nums text-white/90">{isMuted ? 0 : volume}%</span>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>

      {panelPosition && (
        <StreamDiagnosticsPanel
          position={panelPosition}
          stats={stats}
          history={history}
          onClose={() => setPanelPosition(null)}
          onDragStart={startDraggingPanel}
        />
      )}
    </div>
  );
}
