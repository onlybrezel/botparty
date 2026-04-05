import Link from 'next/link';

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <h1 className="text-3xl font-black tracking-tight">Reset password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          Self-service password reset is not wired yet in this deployment. If you control the
          database, update the account directly or create a replacement account for now.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white"
          >
            Back to login
          </Link>
          <Link
            href="/docs/getting-started"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            Open docs
          </Link>
        </div>
      </div>
    </div>
  );
}
