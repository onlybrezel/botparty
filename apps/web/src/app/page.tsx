import Link from 'next/link';
import type { RobotPublic } from '@botparty/shared';
import RobotCard from '@/components/robot-card';
import { ArrowRight, Bot, Gamepad2, Radio, Zap } from 'lucide-react';

async function getPublicRobots(): Promise<RobotPublic[]> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    return res.json() as Promise<RobotPublic[]>;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const robots = await getPublicRobots();
  const onlineCount = robots.filter((r) => r.status === 'ONLINE').length;
  const viewerTotal = robots.reduce((sum, r) => sum + r.viewerCount, 0);
  const featured = robots.slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.12) 0%, transparent 70%)',
          }}
        />

        <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-sm text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--online)] animate-pulse-dot" />
            {onlineCount > 0
              ? `${onlineCount} robot${onlineCount !== 1 ? 's' : ''} online right now`
                : 'Open platform - connect your own robot'}
          </div>

          <h1 className="mb-5 text-5xl font-extrabold leading-[1.1] tracking-tight text-[var(--foreground)] sm:text-6xl lg:text-7xl">
            Drive real robots{' '}
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
              from your browser
            </span>
          </h1>

          <p className="mx-auto mb-9 max-w-xl text-lg text-[var(--muted-foreground)] sm:text-xl">
            Plug in a Raspberry Pi, click connect - and anyone with the link can take the wheel.
            Live video via WebRTC, controls over WebSocket.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-7 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:bg-[var(--primary-hover)] hover:shadow-violet-500/40"
            >
              Explore robots
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/getting-started"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-7 py-3 text-base font-semibold text-[var(--foreground)] transition hover:border-[var(--muted-foreground)]"
            >
              Connect your robot
            </Link>
          </div>

          {/* Live stats */}
          {(robots.length > 0 || viewerTotal > 0) && (
            <p className="mt-7 text-sm text-[var(--muted-foreground)]">
              {robots.length} robot{robots.length !== 1 ? 's' : ''} registered
              {viewerTotal > 0 && ` · ${viewerTotal} viewer${viewerTotal !== 1 ? 's' : ''} watching`}
            </p>
          )}
        </div>
      </section>

      {/* Featured robots */}
      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-20">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Live now</h2>
            <Link
              href="/explore"
              className="text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((robot) => (
              <RobotCard key={robot.id} robot={robot} />
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="mb-10 text-center text-xl font-semibold text-[var(--muted-foreground)]">
            How it works
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                icon: Bot,
                title: 'Connect a robot',
                desc: 'Run the Python client on any Raspberry Pi or Linux machine. One command.',
              },
              {
                icon: Gamepad2,
                title: 'Share the link',
                desc: 'Your robot gets a public URL. Anyone can click and start driving immediately.',
              },
              {
                icon: Radio,
                title: 'Live video + controls',
                desc: 'Sub-150ms video via LiveKit WebRTC. WASD controls over WebSocket in real time.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 transition hover:border-violet-500/40"
              >
                <div className="mb-3 inline-flex rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2">
                  <item.icon className="h-5 w-5 text-violet-300" />
                </div>
                <h3 className="mb-1 font-semibold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20">
        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Control latency target</p>
            <p className="mt-2 inline-flex items-center gap-2 text-2xl font-bold text-[var(--foreground)]">
              <Zap className="h-5 w-5 text-amber-400" />
              &lt;50ms
            </p>
          </div>
          <div className="rounded-xl bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Video pipeline</p>
            <p className="mt-2 text-2xl font-bold">LiveKit WebRTC</p>
          </div>
          <div className="rounded-xl bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Multi-user fairness</p>
            <p className="mt-2 text-2xl font-bold">Queue-based control</p>
          </div>
        </div>
      </section>
    </>
  );
}

