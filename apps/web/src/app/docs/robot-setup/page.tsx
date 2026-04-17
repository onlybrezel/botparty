import Link from 'next/link';

const setupSteps = [
  {
    title: 'Install the robot client',
    body: 'Install BotParty Client on the robot host and keep the service managed by systemd or another process supervisor.',
  },
  {
    title: 'Create and verify config.yaml',
    body: 'Copy the example config, set the BotParty API URL, claim token, LiveKit URL, and choose the hardware, video, and TTS profiles that match the robot.',
  },
  {
    title: 'Connect hardware safely',
    body: 'Verify GPIO or motor-driver mappings before enabling movement commands. Emergency stop behavior should be tested before public access is enabled.',
  },
  {
    title: 'Bring video online',
    body: 'Confirm camera device paths, preferred resolution, frame rate, and whether the robot should publish directly with the streamer or through the Python client camera path.',
  },
  {
    title: 'Start and monitor the service',
    body: 'Launch the client, confirm claim/auth succeeds, and verify queue, chat, control, and telemetry behavior from a room before making the robot public.',
  },
];

export default function RobotSetupDocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
          Robot Setup
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-[var(--foreground)]">
          Bring a robot online with BotParty
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
          This page keeps the essential setup path available inside the app. Use it as the stable fallback when external repository links are unavailable.
        </p>

        <div className="mt-8 space-y-4">
          {setupSteps.map((step, index) => (
            <section
              key={step.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Step {index + 1}
              </p>
              <h2 className="mt-2 text-lg font-bold text-[var(--foreground)]">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{step.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-4 text-sm text-sky-100">
          <p className="font-semibold text-sky-200">Need the deeper hardware and profile docs?</p>
          <p className="mt-2 text-sky-100/85">
            Keep the robot client repo nearby for full configuration reference, but this page covers the core operational setup path that operators need most often.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
          >
            Open dashboard
          </Link>
          <Link
            href="/explore"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            Browse live robots
          </Link>
        </div>
      </div>
    </div>
  );
}