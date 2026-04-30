import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AlertTriangle, Bot, Gamepad2, Radio, Video } from 'lucide-react';
import { ControlKey, SliderControl, XYPadControl } from '@/components/robot-view/controls';
import type { RobotViewState } from './use-robot-view-state';

const LiveKitPlayer = dynamic(
  () => import('@/components/livekit-player').then((module) => module.LiveKitPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-video rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading live video...
      </div>
    ),
  },
);

type Props = {
  state: RobotViewState;
};

export function RobotViewMainColumn({ state }: Props) {
  const needsRoomAccess =
    (state.robot.accessMode === 'PASSWORD' ||
      state.robot.accessMode === 'ALLOWED_USERS' ||
      state.robot.accessMode === 'LINK_ONLY') &&
    !state.roomAccessToken &&
    (state.robot.accessMode === 'LINK_ONLY' || !state.guestVideoAllowed);

  return (
    <div className="space-y-4 lg:col-span-2">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-black lg:shadow-none">
        {needsRoomAccess ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-[var(--muted-foreground)]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
              <Video className="h-7 w-7 text-sky-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">
                {state.robot.accessMode === 'PASSWORD'
                  ? 'This room is password protected.'
                  : state.robot.accessMode === 'ALLOWED_USERS'
                    ? 'This room is allow-list only.'
                    : 'This room is invite-only.'}
              </p>
              <p className="mt-1 text-sm">
                {state.robot.accessMode === 'PASSWORD'
                  ? 'Enter the room password to unlock video, chat, and controls.'
                  : state.robot.accessMode === 'ALLOWED_USERS'
                    ? state.accessToken
                      ? 'Verifying your room access...'
                      : 'Sign in with an allowed account to enter this room.'
                    : state.inviteCodeFromUrl
                      ? 'Verifying your invite link...'
                      : 'Open the full invite link to enter this room.'}
              </p>
            </div>
            {state.robot.accessMode === 'PASSWORD' && (
              <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={state.accessPasswordInput}
                  onChange={(event) => state.setAccessPasswordInput(event.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-sm text-[var(--foreground)]"
                  placeholder="Room password"
                  aria-label="Room password"
                />
                <button
                  type="button"
                  onClick={() => void state.requestRoomAccess()}
                  disabled={state.accessLoading}
                  className="rounded-lg bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
                >
                  {state.accessLoading ? 'Checking...' : 'Unlock'}
                </button>
              </div>
            )}
            {state.robot.accessMode === 'ALLOWED_USERS' && !state.accessToken && (
              <Link
                href="/login"
                className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-hover)]"
              >
                Sign in
              </Link>
            )}
            {state.accessError && <p className="text-xs text-red-300">{state.accessError}</p>}
          </div>
        ) : state.isOnline && state.livekitCreds ? (
          <LiveKitPlayer
            key={`${state.robot.id}-${state.livekitVersion}`}
            token={state.livekitCreds.token}
            livekitUrl={state.livekitCreds.url}
            streamConfig={state.robot.metadata?.stream}
            volumeStorageKey={`botparty:robot:${state.robot.id}:stream-volume`}
            onStreamStalled={() => {
              void state.refreshViewerToken(true);
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
            {state.isOnline ? (
              <>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                  <Radio className="h-7 w-7 text-violet-300" />
                </div>
                {state.videoState === 'loading' || state.videoState === 'idle' ? (
                  <p className="text-sm">Connecting to video stream...</p>
                ) : (
                  <>
                    <p className="text-sm font-medium">Live video is unavailable right now.</p>
                    <Link
                      href="/login"
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-hover)]"
                    >
                      Sign in
                    </Link>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                  <Bot className="h-7 w-7 text-[var(--muted-foreground)]" />
                </div>
                <p className="text-sm">Robot is offline</p>
              </>
            )}
          </div>
        )}

        {state.isOnline && state.livekitCreds && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-[var(--live)]/90 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" />
            LIVE
          </div>
        )}
      </div>

      {(state.robot.accessMode === 'PASSWORD' || state.robot.accessMode === 'ALLOWED_USERS') &&
      !state.roomAccessToken &&
      state.guestVideoAllowed ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
          Video is public for guests. Room access is still required for chat, queue, and controls.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={state.activateControlsPanel}
          aria-label="Focus controls panel"
          title="Focus controls panel"
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            state.focusMode === 'controls'
              ? 'bg-[var(--primary)] text-white'
              : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          <span className="inline-flex items-center gap-1">
            <Gamepad2 className="h-3.5 w-3.5" />
            Controls
          </span>
        </button>
        <button
          type="button"
          onClick={state.activateChatPanel}
          aria-label="Focus chat panel"
          title="Focus chat panel"
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            state.focusMode === 'chat'
              ? 'bg-[var(--primary)] text-white'
              : 'border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          Chat
        </button>
        <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">
          Tab to switch &middot; ESC = E-STOP
        </span>
      </div>

      <div
        ref={state.controlsPanelRef}
        className={`rounded-xl border p-4 transition-colors sm:p-5 ${
          state.focusMode === 'controls'
            ? 'border-[var(--primary)]/50 bg-[var(--card)]'
            : 'border-[var(--border)] bg-[var(--card)] opacity-70'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Controls
          </span>
          {state.focusMode !== 'controls' && (
            <span className="text-xs text-[var(--muted-foreground)]">Tab to focus</span>
          )}
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start">
          <div className="mx-auto grid grid-cols-3 grid-rows-3 gap-2 sm:mx-0">
            <div />
            {(['w'] as const).map((key) => {
              const button = state.buttons.find((entry) => entry.hotKey === key);
              if (!button) {
                return <div key={`${key}-placeholder`} />;
              }

              const command = button.command;
              return (
                <ControlKey
                  key={key}
                  label={button.icon ?? key.toUpperCase()}
                  hotKey={key}
                  command={command}
                  isDown={state.activeCommands.has(command)}
                  isCrowd={state.isCrowdActive(command)}
                  disabled={!state.canUseButton(button)}
                  onPress={() => {
                    state.setActiveCommands((current) => new Set(current).add(command));
                    state.sendCommand(command, {
                      cooldownMs: button.cooldownMs,
                      access: button.access,
                    });
                  }}
                  onRelease={() => {
                    state.setActiveCommands((current) => {
                      const next = new Set(current);
                      next.delete(command);
                      return next;
                    });
                    state.sendImmediateStop();
                  }}
                />
              );
            })}
            <div />
            {(['a', 's', 'd'] as const).map((key) => {
              const button = state.buttons.find((entry) => entry.hotKey === key);
              if (!button) {
                return <div key={`${key}-placeholder`} />;
              }

              const command = button.command;
              return (
                <ControlKey
                  key={key}
                  label={button.icon ?? key.toUpperCase()}
                  hotKey={key}
                  command={command}
                  isDown={state.activeCommands.has(command)}
                  isCrowd={state.isCrowdActive(command)}
                  disabled={!state.canUseButton(button)}
                  onPress={() => {
                    state.setActiveCommands((current) => new Set(current).add(command));
                    state.sendCommand(command, {
                      cooldownMs: button.cooldownMs,
                      access: button.access,
                    });
                  }}
                  onRelease={() => {
                    state.setActiveCommands((current) => {
                      const next = new Set(current);
                      next.delete(command);
                      return next;
                    });
                    state.sendImmediateStop();
                  }}
                />
              );
            })}
            <div />
            <div />
            <div />
          </div>

          <div className="flex flex-wrap items-start gap-3">
            {state.buttons.length === 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                No controls are available for your current access level.
              </div>
            )}

            {state.extraButtonControls.map((button) => (
              <button
                key={button.id}
                type="button"
                onClick={() =>
                  state.sendCommand(button.command, {
                    cooldownMs: button.cooldownMs,
                    access: button.access,
                  })
                }
                onPointerDown={() =>
                  state.sendCommand(button.command, {
                    cooldownMs: button.cooldownMs,
                    access: button.access,
                  })
                }
                disabled={!state.canUseButton(button)}
                aria-label={`Send ${button.label} command`}
                title={button.hotKey ? `${button.label} [${button.hotKey}]` : button.label}
                style={
                  button.color ? { borderColor: button.color, color: button.color } : undefined
                }
                className={`flex min-h-12 min-w-[3.25rem] select-none items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold transition lg:min-h-11 lg:min-w-[2.75rem] ${
                  state.isCrowdActive(button.command)
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-[var(--border)] bg-[var(--muted)] hover:border-[var(--primary)] hover:bg-[var(--primary)] hover:text-white'
                }`}
              >
                {button.icon && !button.icon.startsWith('widget:') && <span>{button.icon}</span>}
                {button.label}
                {button.hotKey && (
                  <span className="ml-1 text-xs opacity-40">[{button.hotKey}]</span>
                )}
                {button.costCredits > 0 && (
                  <span className="ml-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                    {button.costCredits}cr
                  </span>
                )}
              </button>
            ))}

            {state.sliderControls.map(({ button, widget }) => (
              <SliderControl
                key={button.id}
                label={button.label}
                command={button.command}
                config={widget}
                color={button.color ?? null}
                cooldownMs={button.cooldownMs}
                access={button.access}
                isCrowd={state.isCrowdActive(button.command)}
                disabled={!state.canUseButton(button)}
                queueResetEpoch={state.widgetQueueResetEpoch}
                offlineResetEpoch={state.widgetOfflineResetEpoch}
                onSendValue={(value) =>
                  state.sendCommand(button.command, {
                    cooldownMs: button.cooldownMs,
                    access: button.access,
                    value,
                  })
                }
              />
            ))}

            {state.xyControls.map(({ button, widget }) => (
              <XYPadControl
                key={button.id}
                label={button.label}
                command={button.command}
                config={widget}
                color={button.color ?? null}
                cooldownMs={button.cooldownMs}
                access={button.access}
                isCrowd={state.isCrowdActive(button.command)}
                disabled={!state.canUseButton(button)}
                queueResetEpoch={state.widgetQueueResetEpoch}
                offlineResetEpoch={state.widgetOfflineResetEpoch}
                onSendValue={(value) =>
                  state.sendCommand(button.command, {
                    cooldownMs: button.cooldownMs,
                    access: button.access,
                    value,
                  })
                }
              />
            ))}
          </div>

          <div className="hidden h-11 w-px self-center bg-[var(--border)] sm:block" />

          {state.canUseEStop && (
            <button
              type="button"
              onClick={state.triggerEStop}
              onPointerDown={state.triggerEStop}
              aria-label="Emergency stop"
              title="Emergency stop"
              className="flex h-14 w-full max-w-[12rem] select-none flex-col items-center justify-center rounded-xl bg-[var(--destructive)] text-xs font-black text-white shadow-lg shadow-red-500/20 transition hover:brightness-110 active:scale-95 sm:w-28 lg:max-w-[10rem] lg:rounded-xl lg:shadow-lg"
            >
              <AlertTriangle className="h-4 w-4" />
              E-STOP
            </button>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
          WASD or arrow keys &middot; <span className="text-amber-400">amber</span> = another player
          just pressed · gamepad left stick / D-pad supported
          {state.canUseEStop ? ' · ESC = emergency stop' : ''}
        </p>
        {state.queueEnabled && !state.isMyTurn && (
          <p className="mt-2 text-center text-xs text-amber-300">
            {state.myQueuePosition > 0
              ? `Queue position #${state.myQueuePosition}. Controls unlock when you reach #1.`
              : 'Join the queue to control this robot.'}
          </p>
        )}
      </div>
    </div>
  );
}
