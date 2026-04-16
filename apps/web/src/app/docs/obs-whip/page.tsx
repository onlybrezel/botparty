import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'OBS via WHIP',
  description: 'Low-latency OBS setup for BotParty camera ingress using WHIP.',
};

const obsChecklist = [
  'Create the robot first and open its dashboard settings.',
  'Add an external camera ingress and choose a stable camera ID such as front or rear.',
  'Copy the generated WHIP endpoint from the dashboard.',
  'In OBS, add the WHIP output/plugin target and paste the endpoint URL.',
  'Use low-latency encoder settings before testing from a viewer browser.',
];

const recommendedSettings = [
  'Encoder: H.264 (NVENC, QSV, VAAPI, or x264 veryfast)',
  'Rate control: CBR',
  'Keyframe interval: 1s',
  'B-frames: 0',
  'Bitrate: 1200-3500 kbps depending on resolution',
  'Disable OBS stream delay',
  'Enable OBS low-latency networking if available',
];

export default function ObsWhipDocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Streaming Guide</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">OBS via WHIP</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted-foreground)]">
              A practical low-latency path for sending one or more OBS-managed camera feeds into BotParty without
              guessing your way through WHIP settings.
            </p>
          </div>
          <Link
            href="/docs"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--primary)]/60"
          >
            Back to Docs
          </Link>
        </div>

        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          If you are seeing 20-30 seconds of delay, the problem is usually OBS buffering or transcoding settings,
          not WHIP itself.
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <p className="text-sm font-semibold">Setup flow</p>
            <ol className="mt-3 space-y-3 text-sm text-[var(--muted-foreground)]">
              {obsChecklist.map((item, index) => (
                <li key={item}>
                  {index + 1}. {item}
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <p className="text-sm font-semibold">Recommended OBS values</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
              {recommendedSettings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <p className="text-sm font-semibold">BotParty dashboard tips</p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
            <li>Use one ingress per camera and keep IDs stable so viewer labels stay understandable.</li>
            <li>Leave compatibility mode off unless the OBS handshake fails.</li>
            <li>Use the live snapshot thumbnail feature once the feed is online.</li>
            <li>Start with one front camera before adding rear or arm cameras.</li>
          </ul>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <p className="text-sm font-semibold">When things go wrong</p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
            <li>No picture: confirm OBS is actively publishing and the ingress entry still exists in the dashboard.</li>
            <li>High latency: reduce bitrate, turn off stream delay, and verify 1s keyframes with no B-frames.</li>
            <li>Handshake errors: retry once with compatibility mode enabled on that ingress.</li>
            <li>Viewer confusion: give each ingress a human label and keep the robot thumbnail current.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
