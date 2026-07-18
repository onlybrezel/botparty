import Link from 'next/link';
import type { RobotViewState } from './use-robot-view-state';

type Props = {
  state: RobotViewState;
};

export function RobotViewMobileBar({ state }: Props) {
  return (
    <div className="safe-bottom fixed inset-x-4 z-40 mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)]/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-md lg:hidden landscape:max-w-2xl landscape:px-3 landscape:py-1.5">
      <button
        type="button"
        onClick={state.activateControlsPanel}
        aria-label="Show controls"
        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
          state.focusMode === 'controls'
            ? 'bg-[var(--primary)] text-white'
            : 'bg-[var(--card)] text-[var(--foreground)]'
        }`}
      >
        Controls
      </button>
      <button
        type="button"
        onClick={state.activateChatPanel}
        aria-label="Show chat"
        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
          state.focusMode === 'chat'
            ? 'bg-[var(--primary)] text-white'
            : 'bg-[var(--card)] text-[var(--foreground)]'
        }`}
      >
        Chat
      </button>
      {state.queueEnabled &&
        (state.accessToken ? (
          <button
            type="button"
            onClick={() => void state.toggleQueue()}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              state.inQueue
                ? 'bg-[var(--card)] text-amber-300'
                : 'bg-[var(--card)] text-[var(--foreground)]'
            }`}
          >
            {state.inQueue ? `#${state.myQueuePosition || 1}` : 'Queue'}
          </button>
        ) : (
          <Link
            href="/login"
            className="flex-1 rounded-xl bg-[var(--card)] px-3 py-2 text-center text-xs font-semibold text-[var(--foreground)]"
          >
            Sign in
          </Link>
        ))}
      {state.canUseEStop && (
        <button
          type="button"
          onClick={state.triggerEStop}
          aria-label="Emergency stop"
          className="rounded-xl bg-[var(--destructive)] px-3 py-2 text-xs font-black text-white"
        >
          STOP
        </button>
      )}
    </div>
  );
}
