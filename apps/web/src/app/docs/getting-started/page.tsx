import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Getting Started',
  description: 'Get your first BotParty robot online in a few steps.',
};

export default function GettingStartedPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Getting Started</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Minimum path to a reliable first stream and control session.
        </p>

        <ol className="mt-6 space-y-4 text-sm">
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">1. Create account and robot</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Sign in, open dashboard, create a robot, and copy the claim token.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">2. Configure robot client</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Use the dedicated controller-client repo on your Pi/Linux machine and set API URL,
              LiveKit URL, and claim token in `config.yaml`.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">3. Start client and verify live status</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Start the client, check robot page stream, and test E-STOP before sharing publicly.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">4. Set sane defaults</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Keep control/chat on authenticated mode first, then open gradually.
            </p>
          </li>
          <li className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="font-semibold">5. Verify email reset before going public</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Configure SMTP, trigger a password reset, and confirm the reset link arrives before
              inviting hosts or moderators.
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}
