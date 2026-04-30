import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Gamepad2, Heart, Video } from 'lucide-react';
import { formatCountdown } from '@/components/robot-view/controls';
import { DonationDialog } from '@/components/robot-view/donation-dialog';
import { useAuth } from '@/lib/store';
import type { RobotViewState } from './use-robot-view-state';

const RobotViewersList = dynamic(
  () => import('@/components/robot-view/viewers-list').then((module) => module.RobotViewersList),
  {
    ssr: false,
  },
);

const RobotQueuePanel = dynamic(
  () => import('@/components/robot-view/queue-panel').then((module) => module.RobotQueuePanel),
  {
    ssr: false,
  },
);

const RobotChatPanel = dynamic(
  () => import('@/components/robot-view/chat-panel').then((module) => module.RobotChatPanel),
  {
    ssr: false,
  },
);

type Props = {
  state: RobotViewState;
};

export function RobotViewSidebar({ state }: Props) {
  const { accessToken } = useAuth();
  const [donateOpen, setDonateOpen] = useState(false);
  const ownerName = state.robot.owner.displayName ?? state.robot.owner.username;
  return (
    <div className="space-y-4">
      {donateOpen && (
        <DonationDialog
          robotId={state.robot.id}
          robotName={state.robot.name}
          ownerName={ownerName}
          onClose={() => setDonateOpen(false)}
        />
      )}      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold leading-tight">{state.robot.name}</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              by{' '}
              <span className="text-[var(--foreground)]/80">
                {state.robot.owner.displayName ?? state.robot.owner.username}
              </span>
            </p>
          </div>
          <span
            className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              state.robotStatus === 'ONLINE'
                ? 'bg-[var(--online)]/15 text-[var(--online)]'
                : state.robotStatus === 'BUSY'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-zinc-700/50 text-zinc-400'
            }`}
          >
            {state.robotStatus.charAt(0) + state.robotStatus.slice(1).toLowerCase()}
          </span>
        </div>

        {state.robot.description && (
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
            {state.robot.description}
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg bg-[var(--background)] px-2 py-1.5 text-[var(--muted-foreground)]">
            <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
              <Video className="h-3.5 w-3.5 text-violet-300" />
              Live stream
            </span>
          </div>
          <div className="rounded-lg bg-[var(--background)] px-2 py-1.5 text-[var(--muted-foreground)]">
            <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
              <Gamepad2 className="h-3.5 w-3.5 text-violet-300" />
              Queue control
            </span>
          </div>
        </div>

        {accessToken && (
          <button
            type="button"
            onClick={() => setDonateOpen(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-pink-500/30 bg-pink-500/10 px-3 py-2 text-sm font-medium text-pink-200 transition hover:bg-pink-500/20"
          >
            <Heart className="h-4 w-4" />
            Spenden
          </button>
        )}

        {state.activeSession && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
              Current controller
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{state.activeSession.username}</p>
              {state.turnCountdownMs !== null && (
                <p className="text-xs text-amber-300">
                  {formatCountdown(state.turnCountdownMs)} left
                </p>
              )}
            </div>
          </div>
        )}

        {state.robot.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {state.robot.tags.map((tag) => (
              <Link
                key={tag}
                href={`/explore?tag=${encodeURIComponent(tag)}`}
                className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--secondary-foreground)]/80 transition hover:bg-[var(--primary)]/20"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}
      </div>

      <RobotViewersList viewers={state.viewers} />

      {state.isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Recording (Admin)
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                state.recordingState?.active
                  ? 'bg-red-500/15 text-red-300'
                  : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
              }`}
            >
              {state.recordingState?.active
                ? 'Recording'
                : state.recordingLoading
                  ? 'Checking'
                  : 'Idle'}
            </span>
          </div>

          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            {state.recordingState?.startedAt
              ? `Started at ${new Date(state.recordingState.startedAt).toLocaleString()}${state.recordingState.activeCount > 1 ? ` · ${state.recordingState.activeCount} cameras` : ''}`
              : 'Capture this robot room directly from LiveKit.'}
          </p>

          {state.recordingState?.active && state.recordingCameraSummary && (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Active cameras: {state.recordingCameraSummary}
            </p>
          )}

          <button
            type="button"
            disabled={state.recordingLoading || Boolean(state.recordingAction)}
            onClick={() => void state.toggleRecording()}
            className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
              state.recordingState?.active
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)]'
            }`}
          >
            {state.recordingAction === 'start'
              ? 'Starting recording...'
              : state.recordingAction === 'stop'
                ? 'Stopping recording...'
                : state.recordingState?.active
                  ? 'Stop recording'
                  : 'Start recording'}
          </button>

          {state.recordingError && (
            <p className="mt-2 text-xs text-red-300">{state.recordingError}</p>
          )}
        </div>
      )}

      <RobotQueuePanel
        queue={state.queue}
        queueEnabled={state.queueEnabled}
        accessToken={state.accessToken}
        userId={state.userId}
        inQueue={state.inQueue}
        queueAction={state.queueAction}
        activeSession={state.activeSession}
        votingForUserId={state.votingForUserId}
        robot={state.robot}
        onToggleQueue={() => void state.toggleQueue()}
        onVoteForUser={(userId) => void state.voteForQueueUser(userId)}
      />

      <RobotChatPanel
        messages={state.messages}
        hasOlderMessages={state.chatHistoryHasMore}
        historyLoading={state.chatHistoryLoading}
        chatInput={state.chatInput}
        setChatInput={state.setChatInput}
        chatRestriction={state.chatRestriction}
        focusMode={state.focusMode}
        setFocusMode={state.setFocusMode}
        currentViewerId={state.currentViewerId}
        canModerate={state.canModerate}
        moderatingUserId={state.moderatingUserId}
        tabSwitchOnlyWhenEmpty={state.tabSwitchOnlyWhenEmpty}
        chatScrollRef={state.chatScrollRef}
        chatPanelRef={state.chatPanelRef}
        chatInputRef={state.chatInputRef}
        chatShouldStickRef={state.chatShouldStickRef}
        onLoadOlder={() => void state.loadOlderChatMessages()}
        onSend={state.sendChat}
        onModerate={(userId, action, username) =>
          void state.moderateChatUser(userId, action, username)
        }
      />
    </div>
  );
}
