import Link from 'next/link';
import type { QueueEntry, ActiveSessionState } from './types';
import type { RobotPublic } from '@botparty/shared';

interface Props {
  queue: QueueEntry[];
  queueEnabled: boolean;
  accessToken: string | null | undefined;
  userId: string | null | undefined;
  inQueue: boolean;
  queueAction: 'join' | 'leave' | null;
  activeSession: ActiveSessionState | null;
  votingForUserId: string | null;
  robot: RobotPublic;
  onToggleQueue: () => void;
  onVoteForUser: (userId: string) => void;
}

export function RobotQueuePanel({
  queue,
  queueEnabled,
  accessToken,
  userId,
  inQueue,
  queueAction,
  activeSession,
  votingForUserId,
  robot,
  onToggleQueue,
  onVoteForUser,
}: Props) {
  if (!queueEnabled) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Control queue
      </p>

      {accessToken ? (
        <button
          type="button"
          aria-label={inQueue ? 'Leave control queue' : 'Join control queue'}
          onClick={onToggleQueue}
          disabled={queueAction !== null}
          className={`w-full rounded-lg py-2 text-sm font-semibold transition ${
            inQueue
              ? 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-red-500 hover:text-red-400'
              : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'
          } disabled:cursor-wait disabled:opacity-60`}
        >
          {queueAction === 'join' ? 'Joining...' : queueAction === 'leave' ? 'Leaving...' : inQueue ? 'Leave queue' : 'Join queue'}
        </button>
      ) : (
        <Link
          href="/login"
          className="block w-full rounded-lg border border-[var(--border)] py-2 text-center text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
        >
          Sign in to join queue
        </Link>
      )}

      {queue.length > 0 && (
        <div className="mt-3 space-y-2">
          {queue.slice(0, 5).map((entry, i) => (
            <div key={entry.userId} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i === 0 ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}
              >
                {i + 1}
              </span>
              <span className={`min-w-0 flex-1 truncate ${i === 0 ? 'font-medium' : 'text-[var(--muted-foreground)]'}`}>
                {entry.username}
              </span>
              {robot.queueMode === 'VOTING' && (
                <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                  {entry.votes ?? 0} votes
                </span>
              )}
              {activeSession?.userId === entry.userId && (
                <span className="ml-auto text-xs text-[var(--online)]">Controlling</span>
              )}
              {i === 0 && activeSession?.userId !== entry.userId && (
                <span className="ml-auto text-xs text-amber-300">Next</span>
              )}
              {userId && entry.userId === userId && i > 0 && (
                <span className="ml-auto text-xs text-amber-300">You</span>
              )}
              {robot.queueMode === 'VOTING' && accessToken && userId && entry.userId !== userId && i > 0 && (
                <button
                  type="button"
                  aria-label={`Vote for ${entry.username}`}
                  disabled={votingForUserId === entry.userId}
                  onClick={() => onVoteForUser(entry.userId)}
                  className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-60"
                >
                  {votingForUserId === entry.userId ? 'Voting...' : 'Vote'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
