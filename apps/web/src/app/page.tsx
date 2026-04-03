import Link from 'next/link';
import type { RobotPublic } from '@botparty/shared';
import RobotCard from '@/components/robot-card';
import { ArrowRight, Bot, Gamepad2, Radio, Sparkles } from 'lucide-react';

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
      <section className="relative overflow-hidden border-b border-[var(--border)]/60">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 85% 60% at 10% -10%, rgba(56,189,248,0.14) 0%, transparent 62%), radial-gradient(ellipse 70% 55% at 90% 5%, rgba(16,185,129,0.11) 0%, transparent 60%)',
          }}
        />

        <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-5xl flex-col justify-center px-4 py-16 text-center sm:py-20">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-sm text-sky-200">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--online)] animate-pulse-dot" />
            {onlineCount > 0
              ? `${onlineCount} robot${onlineCount !== 1 ? 's' : ''} online right now`
                : 'Open platform - connect your own robot'}
          </div>

          <h1 className="mb-5 text-5xl font-extrabold leading-[1.1] tracking-tight text-[var(--foreground)] sm:text-6xl lg:text-7xl">
            Drive real robots{' '}
            <span className="bg-gradient-to-r from-sky-300 via-teal-300 to-emerald-300 bg-clip-text text-transparent">
              from your browser
            </span>
          </h1>

          <p className="mx-auto mb-9 max-w-2xl text-lg text-[var(--muted-foreground)] sm:text-xl">
            No simulations: real hardware, real latency, real community sessions.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-7 py-3 text-base font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-[var(--primary-hover)] hover:shadow-sky-500/40"
            >
              Explore robots
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-7 py-3 text-base font-semibold text-[var(--foreground)] transition hover:border-[var(--muted-foreground)]"
            >
              Host a robot
            </Link>
          </div>

          {/* Live stats */}
          {(robots.length > 0 || viewerTotal > 0) && (
            <p className="mt-7 text-sm text-[var(--muted-foreground)]">
              {robots.length} robot{robots.length !== 1 ? 's' : ''} registered
              {viewerTotal > 0 && ` · ${viewerTotal} viewer${viewerTotal !== 1 ? 's' : ''} watching`}
            </p>
          )}

          <div className="mx-auto mt-8 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70 px-4 py-3 text-left">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Live robots</p>
              <p className="mt-1 text-2xl font-black">{onlineCount}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70 px-4 py-3 text-left">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Live viewers</p>
              <p className="mt-1 text-2xl font-black">{viewerTotal}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70 px-4 py-3 text-left">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Sessions today</p>
              <p className="mt-1 text-2xl font-black">{Math.max(robots.length, onlineCount)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured robots */}
      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
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
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
          <h2 className="mb-10 text-center text-xl font-semibold text-[var(--muted-foreground)]">
            How it works
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                icon: Bot,
                title: 'Connect a robot',
                desc: 'Run the Python client on a Raspberry Pi or Linux machine and claim your robot.',
              },
              {
                icon: Gamepad2,
                title: 'Share the link',
                desc: 'Each robot gets its own page with video, chat, and queue controls.',
              },
              {
                icon: Sparkles,
                title: 'Moderate and scale',
                desc: 'Use dashboard and moderation tools to run fair sessions and keep control safe.',
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
    </>
  );
}

