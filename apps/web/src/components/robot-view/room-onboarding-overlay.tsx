import { Bot, Gamepad2, Video, X } from 'lucide-react';

type Props = {
  queueEnabled: boolean;
  signedIn: boolean;
  onDismiss: () => void;
};

type Step = {
  title: string;
  description: string;
  icon: typeof Bot;
};

export function RoomOnboardingOverlay({ queueEnabled, signedIn, onDismiss }: Props) {
  const steps: Step[] = queueEnabled
    ? [
        {
          title: signedIn ? 'Join the queue' : 'Sign in and join the queue',
          description: signedIn
            ? 'Use the queue panel or the mobile Queue button to claim your turn in line.'
            : 'Sign in first, then use the queue panel to claim your turn in line.',
          icon: Bot,
        },
        {
          title: 'Take your turn',
          description: 'When you reach #1 the controls unlock, the countdown starts, and your input goes live.',
          icon: Gamepad2,
        },
        {
          title: 'Watch the robot move',
          description: 'Keep the live stream open while you drive so you can react in real time.',
          icon: Video,
        },
      ]
    : [
        {
          title: 'Open controls',
          description: 'This room uses direct control, so the control pad is ready as soon as the robot is online.',
          icon: Bot,
        },
        {
          title: 'Take your turn',
          description: 'Press the movement buttons or widgets to drive, and use STOP if you need to halt immediately.',
          icon: Gamepad2,
        },
        {
          title: 'Watch the robot move',
          description: 'Keep the live stream visible while you drive so the room stays responsive to your input.',
          icon: Video,
        },
      ];

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Room onboarding"
      className="relative z-20 mb-4 overflow-hidden rounded-2xl border border-[var(--primary)]/20 bg-[var(--card)]/95 shadow-xl shadow-black/20 backdrop-blur"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            First time here?
          </p>
          <h2 className="mt-1 text-lg font-black text-[var(--foreground)]">How to drive this robot</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">
            Learn the room flow once, then BotParty will keep this guide out of your way.
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss room onboarding"
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-[var(--muted-foreground)] transition hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="rounded-xl border border-[var(--border)] bg-[var(--background)]/80 p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary)]/15 text-sm font-black text-[var(--primary)]">
                  {index + 1}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]">
                  <Icon className="h-4 w-4" />
                </span>
              </div>

              <h3 className="text-sm font-semibold text-[var(--foreground)]">{step.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{step.description}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs text-[var(--muted-foreground)]">
          {queueEnabled
            ? 'Queue position updates and turn-ready alerts appear automatically while you wait.'
            : 'Controls stay available while the robot is online, and chat stays open throughout the session.'}
        </p>

        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
        >
          Got it
        </button>
      </div>
    </section>
  );
}