import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-xl font-bold">
            <span className="text-2xl">🤖</span>
            <span className="bg-gradient-to-r from-purple-400 to-amber-400 bg-clip-text text-transparent">
              BotParty
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/explore"
              className="text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              Explore
            </Link>
            <Link
              href="/leaderboard"
              className="text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              Leaderboard
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Sign In
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight sm:text-7xl">
            Drive{' '}
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400 bg-clip-text text-transparent">
              real robots
            </span>
            <br />
            from your browser
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-[var(--muted-foreground)] sm:text-xl">
            Plug in a Raspberry Pi, register it here, and anyone with the link can get behind the wheel.
            Video over WebRTC, controls over WebSocket.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/explore"
              className="rounded-xl bg-[var(--primary)] px-8 py-3.5 text-lg font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-500/40"
            >
              Explore Robots →
            </Link>
            <Link
              href="/docs/getting-started"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-8 py-3.5 text-lg font-semibold text-[var(--foreground)] transition hover:border-[var(--muted-foreground)]"
            >
              Connect Your Robot
            </Link>
          </div>
        </div>

        {/* Quick facts */}
        <div className="mt-20 grid grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-3xl font-bold text-purple-400">WebRTC</div>
            <div className="text-sm text-[var(--muted-foreground)]">Video via LiveKit</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-amber-400">WS</div>
            <div className="text-sm text-[var(--muted-foreground)]">Controls over WebSocket</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-pink-400">MIT</div>
            <div className="text-sm text-[var(--muted-foreground)]">Open source</div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8 text-center text-sm text-[var(--muted-foreground)]">
        <p>BotParty — MIT license</p>
      </footer>
    </div>
  );
}
