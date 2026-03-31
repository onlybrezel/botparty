export default function ExplorePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Explore Robots</h1>
          <p className="text-[var(--muted-foreground)]">
            Browse live robots and take control in real-time
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search robots..."
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
          <select className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm">
            <option value="popular">Most Popular</option>
            <option value="newest">Newest</option>
            <option value="online">Online Now</option>
          </select>
        </div>
      </div>

      {/* Robot Grid – will be populated with real data */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] transition hover:border-purple-500/50"
          >
            {/* Thumbnail placeholder */}
            <div className="relative aspect-video bg-[var(--muted)]">
              <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-medium text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                LIVE
              </div>
              <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                {Math.floor(Math.random() * 100)} viewers
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-semibold group-hover:text-purple-400 transition">
                Demo Robot #{i + 1}
              </h3>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">by demo_creator</p>
              <div className="mt-3 flex gap-1">
                <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs">
                  rover
                </span>
                <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs">
                  raspberry-pi
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
