import Link from 'next/link';
import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import RobotCard from '@/components/robot-card';
import { ArrowRight, Bot, Gamepad2, Radio, Sparkles } from 'lucide-react';

interface PlatformStats {
  totalUsers: number;
  totalRobots: number;
  liveRobots: number;
  totalLiveViewers: number;
  activeQueueEntries: number;
  totalSessions: number;
}

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

async function getPlatformStats(): Promise<PlatformStats | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/health/stats`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<PlatformStats>;
  } catch {
    return null;
  }
}

async function getRobotsOverview(): Promise<PublicRobotOverview | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots/overview`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<PublicRobotOverview>;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [robots, stats, overview] = await Promise.all([
    getPublicRobots(),
    getPlatformStats(),
    getRobotsOverview(),
  ]);
  const featured = overview?.featured.length
    ? robots.filter((robot) => overview.featured.some((featuredRobot) => featuredRobot.id === robot.id)).slice(0, 3)
    : robots.slice(0, 3);

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
            Public robot teleoperation platform
          </div>

          <h1 className="mb-5 text-5xl font-extrabold leading-[1.1] tracking-tight text-[var(--foreground)] sm:text-6xl lg:text-7xl">
            Drive real robots{' '}
            <span className="bg-gradient-to-r from-sky-300 via-teal-300 to-emerald-300 bg-clip-text text-transparent">
              from your browser
            </span>
          </h1>

          <p className="mx-auto mb-9 max-w-2xl text-lg text-[var(--muted-foreground)] sm:text-xl">
            Real robots, live queues, and moderation tools for safe shared control.
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

          <p className="mt-7 text-sm text-[var(--muted-foreground)]">
            Built for creator-hosted robots, classrooms, and community events.
          </p>

          {stats && (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left">
                <p className="text-lg font-bold">{overview?.totals.liveRobots ?? stats.liveRobots}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Live robots</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left">
                <p className="text-lg font-bold">{overview?.totals.totalViewers ?? stats.totalLiveViewers}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Live viewers</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left">
                <p className="text-lg font-bold">{stats.totalUsers}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Active users</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left">
                <p className="text-lg font-bold">{stats.totalSessions}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Total sessions</p>
              </div>
            </div>
          )}
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

          {overview && overview.topTags.length > 0 && (
            <div className="mt-8">
              <p className="mb-3 text-center text-xs uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                Popular tags
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {overview.topTags.slice(0, 8).map((tag) => (
                  <Link
                    key={tag.tag}
                    href={`/explore?tag=${encodeURIComponent(tag.tag)}`}
                    className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                  >
                    {tag.tag} · {tag.count}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
