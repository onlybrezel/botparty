'use client';

export default function RobotPage({ params }: { params: Promise<{ slug: string }> }) {
  // In Next.js 15+, params is a Promise in async server components
  // For client components, we use the hook pattern
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Video Stream */}
        <div className="lg:col-span-2">
          <div className="aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-black">
            <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
              <div className="text-center">
                <p className="text-lg font-medium">LiveKit Video Stream</p>
                <p className="text-sm">Connecting to robot...</p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--muted-foreground)]">CONTROLS</h3>
            <div className="flex items-center justify-center gap-2">
              {/* WASD Controls */}
              <div className="grid grid-cols-3 gap-1">
                <div />
                <button className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--muted)] font-mono text-sm font-bold transition hover:bg-[var(--primary)] active:scale-95">
                  W
                </button>
                <div />
                <button className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--muted)] font-mono text-sm font-bold transition hover:bg-[var(--primary)] active:scale-95">
                  A
                </button>
                <button className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--muted)] font-mono text-sm font-bold transition hover:bg-[var(--primary)] active:scale-95">
                  S
                </button>
                <button className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--muted)] font-mono text-sm font-bold transition hover:bg-[var(--primary)] active:scale-95">
                  D
                </button>
              </div>

              <div className="mx-8 h-16 w-px bg-[var(--border)]" />

              {/* Emergency Stop */}
              <button className="flex h-16 w-32 items-center justify-center rounded-xl bg-red-600 font-bold text-white shadow-lg shadow-red-500/25 transition hover:bg-red-500 active:scale-95">
                🛑 E-STOP
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
              Use WASD keys, gamepad, or touch controls. Emergency stop: ESC or the red button.
            </p>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Robot Info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-lg font-bold">Robot Name</h2>
            <p className="text-sm text-[var(--muted-foreground)]">by creator_name</p>
            <div className="mt-3 flex gap-1">
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                ● Online
              </span>
            </div>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              Robot description goes here. This is a demo robot for testing the platform.
            </p>
          </div>

          {/* Queue */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--muted-foreground)]">
              CONTROL QUEUE
            </h3>
            <button className="w-full rounded-lg bg-[var(--primary)] py-2 text-sm font-medium text-white transition hover:opacity-90">
              Join Queue
            </button>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-6 w-6 rounded-full bg-[var(--muted)]" />
                <span>user_123</span>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">Controlling</span>
              </div>
            </div>
          </div>

          {/* Chat */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--muted-foreground)]">CHAT</h3>
            <div className="mb-3 h-48 space-y-2 overflow-y-auto rounded-lg bg-[var(--background)] p-2 text-sm">
              <p>
                <span className="font-medium text-purple-400">system:</span>{' '}
                <span className="text-[var(--muted-foreground)]">Welcome to the chat!</span>
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Say something..."
                maxLength={500}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              />
              <button className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white">
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
