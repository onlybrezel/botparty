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
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-1.5 text-sm text-purple-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
            </span>
            Live robots online now
          </div>

          <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight sm:text-7xl">
            Control{' '}
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400 bg-clip-text text-transparent">
              Real Robots
            </span>
            <br />
            From Your Browser
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-[var(--muted-foreground)] sm:text-xl">
            BotParty is the modern teleoperation platform. Connect your Raspberry Pi, Jetson, or any
            robot – and let the world drive it live with ultra-low latency WebRTC streaming.
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

        {/* Stats */}
        <div className="mt-20 grid grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-3xl font-bold text-purple-400">{'<'}150ms</div>
            <div className="text-sm text-[var(--muted-foreground)]">Video Latency</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-amber-400">{'<'}50ms</div>
            <div className="text-sm text-[var(--muted-foreground)]">Control Latency</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-pink-400">∞</div>
            <div className="text-sm text-[var(--muted-foreground)]">Viewers per Robot</div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8 text-center text-sm text-[var(--muted-foreground)]">
        <p>© 2026 BotParty. Open-source robot teleoperation platform.</p>
      </footer>
    </div>
  );
}
