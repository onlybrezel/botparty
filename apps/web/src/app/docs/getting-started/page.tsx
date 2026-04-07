import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Getting Started',
  description: 'Get your first BotParty room online with sane defaults and a working safety path.',
};

export default function GettingStartedPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Getting Started</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          A practical first-launch checklist for hosts who want a room that feels responsive and does not fall apart once people join.
        </p>

        <ol className="mt-6 space-y-4 text-sm">
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">1. Create the robot entry first</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Sign in, open the dashboard, create a robot, and copy the claim token you will use on the robot client.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">2. Bring the client online on hardware</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Use the dedicated controller-client repo on your Pi or Linux box and set API URL, LiveKit URL, and claim token in `config.yaml`.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">3. Verify the boring things before the fun things</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Start the client, confirm the room shows live video, and test E-STOP before you invite anyone else in.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">4. Launch with conservative access rules</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Keep control and chat on authenticated mode first, keep turns short, and only loosen things after one clean session.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">5. Do one full dry run as a viewer</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Open the room from another browser, join the queue, send a chat message, watch the turn change, and make sure reconnects are understandable.
            </p>
          </li>
        </ol>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-sm font-semibold">Good first-session defaults</p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
            <li>Keep the room public only if the physical environment is controlled.</li>
            <li>Use authenticated control, authenticated chat, and a visible queue.</li>
            <li>Set a short turn time so the room stays moving.</li>
            <li>Do not add fancy control buttons until the base movement path is stable.</li>
          </ul>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-sm font-semibold">Thinking about front + rear cameras?</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Treat multi-camera as a quality upgrade, not a separate deployment mode. The safest platform direction is one robot room, one video track per camera, and a viewer layout that falls back cleanly to single-camera behavior.
          </p>
          <Link
            href="/docs/multi-camera"
            className="mt-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--primary)]/60"
          >
            Read the Multi-Camera design guide
          </Link>
        </div>
      </section>
    </div>
  );
}
