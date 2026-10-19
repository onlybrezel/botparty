'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, type UserSessionDetail } from '@/lib/api';
import { useAuth } from '@/lib/store';

function formatDuration(durationMs: number | null) {
  if (!durationMs || durationMs <= 0) {
    return 'In progress';
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export default function SessionReplayPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, hasHydrated } = useAuth();
  const [session, setSession] = useState<UserSessionDetail | null>(null);
  const [selectedReplay, setSelectedReplay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    api.setToken(accessToken);
    api.sessions.getMySession(params.id)
      .then((result) => {
        if (!active) {
          return;
        }
        setSession(result);
        setSelectedReplay(result.replayCandidates[0]?.playbackPath ?? null);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load session replay.');
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessToken, hasHydrated, params.id, router]);

  const selectedReplayFile = useMemo(
    () => session?.replayCandidates.find((candidate) => candidate.playbackPath === selectedReplay) ?? null,
    [selectedReplay, session],
  );

  if (!hasHydrated || !accessToken) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Replay</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Session details</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Review playback candidates, stats, and jump back to the robot room.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/sessions" className="inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium">
            Back to sessions
          </Link>
          {session ? (
            <Link
              href={`/robot/${session.robot.owner.username}/${session.robot.slug}`}
              className="inline-flex rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white"
            >
              Open robot
            </Link>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
          Loading session replay...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-6 text-sm text-[var(--destructive)]">
          {error}
        </div>
      ) : !session ? null : (
        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{session.robot.name}</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Controlled by {session.user.displayName ?? session.user.username} on {new Date(session.startedAt).toLocaleString()}
                </p>
              </div>
              <div className="rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs font-semibold">
                {session.status}
              </div>
            </div>

            {selectedReplay ? (
              <video
                key={selectedReplay}
                controls
                preload="metadata"
                src={api.moderation.getAdminRecordingStreamUrl(selectedReplay)}
                className="aspect-video w-full rounded-xl border border-[var(--border)] bg-black"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--background)] p-8 text-center text-sm text-[var(--muted-foreground)]">
                No replay file matched this session yet.
              </div>
            )}

            {session.replayCandidates.length > 1 ? (
              <div className="mt-4 grid gap-3">
                {session.replayCandidates.map((candidate) => (
                  <button
                    key={candidate.fileName}
                    type="button"
                    onClick={() => setSelectedReplay(candidate.playbackPath)}
                    className={`rounded-xl border px-4 py-3 text-left ${
                      candidate.playbackPath === selectedReplay
                        ? 'border-sky-400/50 bg-sky-500/10'
                        : 'border-[var(--border)] bg-[var(--background)]'
                    }`}
                  >
                    <p className="text-sm font-semibold">{candidate.fileName}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {candidate.recordedAt ? new Date(candidate.recordedAt).toLocaleString() : 'Unknown capture time'}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <h2 className="text-lg font-bold">Session stats</h2>
              <div className="mt-4 grid gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Duration</p>
                  <p className="mt-1 font-semibold">{formatDuration(session.durationMs)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Commands</p>
                  <p className="mt-1 font-semibold">{session.totalCommands}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Peak viewers</p>
                  <p className="mt-1 font-semibold">{session.peakViewers}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Average latency</p>
                  <p className="mt-1 font-semibold">{session.avgLatencyMs !== null ? `${Math.round(session.avgLatencyMs)} ms` : '-'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Owner</p>
                  <p className="mt-1 font-semibold">{session.robot.owner.displayName ?? session.robot.owner.username}</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <h2 className="text-lg font-bold">Replay source</h2>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Replay files are matched by robot identity and session timing. Signed playback links expire automatically.
              </p>
              {selectedReplayFile ? (
                <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                  Current file expires at {new Date(selectedReplayFile.playbackExpiresAt).toLocaleTimeString()}.
                </p>
              ) : null}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
