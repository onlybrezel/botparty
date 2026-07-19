import Link from 'next/link';
import { ArrowRight, Bot, Gamepad2, MessageSquare, Shield, Video } from 'lucide-react';

const roomFeatures = [
  { icon: Video, label: 'Live video', detail: 'Watch the robot from the room.' },
  { icon: Gamepad2, label: 'Fair turns', detail: 'A visible queue keeps control orderly.' },
  { icon: MessageSquare, label: 'Room chat', detail: 'Talk to the host and other viewers.' },
];

const hostFeatures = [
  {
    icon: Bot,
    title: 'Bring your own robot',
    description: 'Connect the BotParty client, publish video and open a room when you are ready.',
  },
  {
    icon: Gamepad2,
    title: 'Choose how control works',
    description: 'Set turn limits, access rules and controls for the hardware in your room.',
  },
  {
    icon: Shield,
    title: 'Stay in charge',
    description: 'Moderation, restricted access and emergency controls remain with the host.',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-[var(--border)]">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-center lg:gap-20 lg:px-8 lg:py-28">
          <div>
            <p className="mb-4 text-sm font-semibold text-[var(--secondary-foreground)]">
              Live rooms for real robots
            </p>
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-[var(--foreground)] sm:text-6xl">
              Watch and control real robots online.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[var(--muted-foreground)] sm:text-lg">
              Join a room, enter the queue and take a turn from your browser. Hosts manage access,
              moderation and emergency controls.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/explore"
                prefetch={false}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--primary-hover)]"
              >
                Explore rooms
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                prefetch={false}
                className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                Host a robot
              </Link>
            </div>
          </div>

          <aside className="border-y border-[var(--border)] py-2 lg:border lg:bg-[var(--card)] lg:p-6">
            <div className="border-b border-[var(--border)] py-4 lg:pt-0">
              <p className="text-sm font-semibold text-[var(--foreground)]">Inside a robot room</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Everything needed to watch, wait and take a turn.
              </p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {roomFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.label} className="flex items-start gap-4 py-4">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary)]" />
                    <div>
                      <p className="text-sm font-semibold">{feature.label}</p>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{feature.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <Link
              href="/docs"
              prefetch={false}
              className="inline-flex items-center gap-2 py-3 text-sm font-semibold text-[var(--foreground)] hover:text-[var(--primary)]"
            >
              How BotParty works
              <ArrowRight className="h-4 w-4" />
            </Link>
          </aside>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for hosts, clear for guests</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
              Room controls stay easy to find while robot setup and safety options remain with the host.
            </p>
          </div>

          <div className="mt-10 grid border-y border-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--border)]">
            {hostFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="border-b border-[var(--border)] py-6 last:border-b-0 sm:border-b-0 sm:px-6 sm:first:pl-0 sm:last:pr-0"
                >
                  <Icon className="h-5 w-5 text-[var(--primary)]" />
                  <h3 className="mt-4 font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
