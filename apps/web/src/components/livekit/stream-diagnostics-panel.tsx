'use client';

import { Check, Copy, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Sparkline } from './sparkline';
import { formatPercent, formatStat, type PanelPosition } from './stats-utils';

export type NerdStats = {
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

export type StatHistoryPoint = {
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  roundTripMs: number | null;
};

export type CandidateStats = RTCStats & {
  candidateType?: string;
  protocol?: string;
};

function statsToClipboardText(stats: NerdStats | null) {
  if (!stats) return 'Stats for nerds: no data yet';
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

export function StreamDiagnosticsPanel({
  position,
  stats,
  history,
  onClose,
  onDragStart,
}: {
  position: PanelPosition;
  stats: NerdStats | null;
  history: StatHistoryPoint[];
  onClose: () => void;
  onDragStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const copyStats = async () => {
    try {
      await navigator.clipboard.writeText(statsToClipboardText(stats));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const fields: Array<[string, string]> = [
    ['Updated', stats?.timestamp ?? 'collecting...'],
    ['Room state', formatStat(stats?.connectionState)],
    ['Connection quality', formatStat(stats?.participantQuality)],
    ['Track', formatStat(stats?.trackSid)],
    ['Audio track', formatStat(stats?.audioTrackSid)],
    ['Source', formatStat(stats?.source)],
    ['Video bitrate', formatStat(stats?.bitrateKbps, ' kbps')],
    ['Audio bitrate', formatStat(stats?.audioBitrateKbps, ' kbps')],
    ['FPS', formatStat(stats?.framesPerSecond)],
    ['RTT', formatStat(stats?.roundTripMs, ' ms')],
    ['Inbound size', `${formatStat(stats?.frameWidth)} x ${formatStat(stats?.frameHeight)}`],
    ['Rendered size', `${formatStat(stats?.videoWidth)} x ${formatStat(stats?.videoHeight)}`],
    ['Frames dropped', formatStat(stats?.framesDropped)],
    ['Video loss', formatStat(stats?.packetsLost)],
    ['Audio loss', formatStat(stats?.audioPacketsLost)],
    ['Video jitter', formatStat(stats?.jitterMs, ' ms')],
    ['Audio jitter', formatStat(stats?.audioJitterMs, ' ms')],
    ['Video buffer', formatStat(stats?.jitterBufferMs, ' ms')],
    ['Audio buffer', formatStat(stats?.audioJitterBufferMs, ' ms')],
    ['Transport', formatStat(stats?.transportProtocol)],
    ['Local candidate', formatStat(stats?.localCandidateType)],
    ['Remote candidate', formatStat(stats?.remoteCandidateType)],
    ['Audio level', formatPercent(stats?.audioLevel)],
    ['Audio state', formatStat(stats?.audioMuted)],
    ['Mime', formatStat(stats?.mimeType)],
    ['Audio mime', formatStat(stats?.audioMimeType)],
    ['Stream state', formatStat(stats?.streamState)],
    ['Ready', formatStat(stats?.readyState)],
    ['Concealed', formatStat(stats?.concealedSamples)],
  ];

  return (
    <div
      className="fixed z-[70] w-[min(42rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950/92 text-[11px] text-slate-100 shadow-2xl backdrop-blur-xl"
      style={{
        left: Math.max(8, Math.min(position.x, window.innerWidth - 680)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - 420)),
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex cursor-move items-center justify-between border-b border-white/10 bg-cyan-400/10 px-3 py-2" onMouseDown={onDragStart}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/70">Stats</p>
          <p className="mt-1 text-xs font-semibold text-white">Local stream diagnostics</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void copyStats()} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
            {copyState === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Retry' : 'Copy'}
          </button>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Close stats panel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 md:grid-cols-[auto_1fr_auto_1fr]">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <p className="text-slate-400">{label}</p>
              <p className={label.includes('Mime') ? 'truncate' : undefined}>{value}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 border-t border-white/8 px-3 py-3 md:border-l md:border-t-0">
          <Sparkline label="Video bitrate" value={stats?.bitrateKbps ?? null} suffix=" kbps" values={history.map((point) => point.videoBitrateKbps)} stroke="#22d3ee" minRange={120} />
          <Sparkline label="Audio bitrate" value={stats?.audioBitrateKbps ?? null} suffix=" kbps" values={history.map((point) => point.audioBitrateKbps)} stroke="#f59e0b" minRange={24} />
          <Sparkline label="RTT" value={stats?.roundTripMs ?? null} suffix=" ms" values={history.map((point) => point.roundTripMs)} stroke="#fb7185" minRange={40} />
        </div>
      </div>
    </div>
  );
}
