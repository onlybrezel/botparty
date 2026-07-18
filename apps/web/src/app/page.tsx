import Link from 'next/link';
import { ArrowRight, Bot, Gamepad2, Shield } from 'lucide-react';

export default function HomePage() {
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
              prefetch={false}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-7 py-3 text-base font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-[var(--primary-hover)] hover:shadow-sky-500/40"
            >
              Explore robots
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              prefetch={false}
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

        </div>
      </section>

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

        </div>
      </section>
    </>
  );
}
