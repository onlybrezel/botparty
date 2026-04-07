import Link from 'next/link';
import type { PublicRobotOverview, RobotPublic } from '@botparty/shared';
import RobotCard from '@/components/robot-card';
import { ArrowRight, Bot, Gamepad2, Shield, Sparkles, TimerReset, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

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
      cache: 'no-store',
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
      cache: 'no-store',
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
      cache: 'no-store',
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

        <div className="mx-auto flex min-h-[calc(100vh-15rem)] max-w-5xl flex-col justify-center px-4 py-14 text-center sm:min-h-[calc(100vh-12rem)] sm:py-20">
          <div className="mb-5 inline-flex max-w-full items-center justify-center gap-2 self-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-200 sm:text-sm">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[var(--online)]" />
            Live robot rooms with queues, chat, and safety controls
          </div>

          <h1 className="mb-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-[var(--foreground)] sm:text-6xl lg:text-7xl">
            Real robots.
            <span className="bg-gradient-to-r from-sky-300 via-teal-300 to-emerald-300 bg-clip-text text-transparent">
              Real people.
            </span>
            <br />
            Shared control that stays fun.
          </h1>

          <p className="mx-auto mb-9 max-w-2xl text-base leading-relaxed text-[var(--muted-foreground)] sm:text-xl">
            Join a live room, watch the feed, hop into the queue, and take your turn without the whole thing turning into chaos.
          </p>

          <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <Link
              href="/explore"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-7 py-3 text-base font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-[var(--primary-hover)] hover:shadow-sky-500/40"
            >
              Explore robots
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-7 py-3 text-center text-base font-semibold text-[var(--foreground)] transition hover:border-[var(--muted-foreground)]"
            >
              Host a robot
            </Link>
          </div>

          <p className="mt-7 text-sm text-[var(--muted-foreground)]">
            Built for hosted robot streams, school demos, maker labs, and internet weirdness that still needs guardrails.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-2 text-xs text-[var(--muted-foreground)] sm:text-sm">
            <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
              Queue-based turns
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
              Live video via LiveKit
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
              Emergency stop support
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
              Host moderation tools
            </span>
          </div>

          {stats && (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left">
                <p className="text-lg font-bold">{overview?.totals.liveRobots ?? stats.liveRobots}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Live robots</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left">
                <p className="text-lg font-bold">{overview?.totals.totalViewers ?? stats.totalLiveViewers}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Live viewers</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left">
                <p className="text-lg font-bold">{stats.totalUsers}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Registered accounts</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 text-left">
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
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
            What makes a room work
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              {
                icon: Bot,
                title: 'A real robot host',
                desc: 'Hosts connect a robot client, publish video, and decide who can watch, chat, and take control.',
              },
              {
                icon: Gamepad2,
                title: 'A room people can join',
                desc: 'Every robot gets a shareable room with live video, queue state, chat, and turn-based controls.',
              },
              {
                icon: Shield,
                title: 'Safety before spectacle',
                desc: 'Access rules, moderation tools, and emergency-stop support keep sessions from going off the rails.',
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

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="mb-3 inline-flex rounded-xl border border-[var(--border)] bg-[var(--muted)] p-2">
                <TimerReset className="h-5 w-5 text-sky-300" />
              </div>
              <h3 className="font-semibold">Turns stay predictable</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                Queue modes, turn timers, and visible position updates make shared control feel fair instead of random.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="mb-3 inline-flex rounded-xl border border-[var(--border)] bg-[var(--muted)] p-2">
                <Users className="h-5 w-5 text-emerald-300" />
              </div>
              <h3 className="font-semibold">Made for crowds</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                Viewer counts, chat, and moderation are built into the room instead of bolted on around it.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="mb-3 inline-flex rounded-xl border border-[var(--border)] bg-[var(--muted)] p-2">
                <Sparkles className="h-5 w-5 text-violet-300" />
              </div>
              <h3 className="font-semibold">Fast to host</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                Create a robot, copy the claim token, bring your client online, and start with conservative defaults.
              </p>
            </div>
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

      <section className="border-t border-[var(--border)] bg-[var(--card)]/30">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-[1.2fr_0.8fr] sm:items-center">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted-foreground)]">For hosts</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Start with a room people can actually trust
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
              The best BotParty rooms are the ones with clear controls, short turn times, a working E-STOP path, and a host who keeps access sane before opening things up.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <p className="text-sm font-semibold text-[var(--foreground)]">Good first-room defaults</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
              <li>Authenticated chat and control</li>
              <li>Short turns with a visible queue</li>
              <li>Emergency stop tested before sharing</li>
              <li>One clear camera angle before fancy extras</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/docs/getting-started"
                className="inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)] transition hover:text-sky-300"
              >
                Read setup guide
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
              >
                Open dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
