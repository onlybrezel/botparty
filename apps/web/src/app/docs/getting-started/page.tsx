import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Cable,
  Camera,
  CircuitBoard,
  Cpu,
  ExternalLink,
  Gamepad2,
  Radio,
  Wrench,
} from 'lucide-react';

const controllerFlow = [
  {
    icon: Gamepad2,
    title: 'Browser controls',
    body:
      'Drivers and viewers join the robot page, see LiveKit video, and send commands over WebSocket.',
  },
  {
    icon: Radio,
    title: 'BotParty realtime layer',
    body:
      'The API handles auth, queue fairness, moderation, and command routing while LiveKit carries the media stream.',
  },
  {
    icon: Bot,
    title: 'Python robot client',
    body:
      'The BotParty client claims the robot, publishes camera video, and forwards commands to the selected hardware adapter.',
  },
  {
    icon: CircuitBoard,
    title: 'Hardware adapter',
    body:
      'An adapter translates generic commands like forward, left, servo, or estop into GPIO, I2C, serial, USB, or MQTT actions.',
  },
];

const hardwareFamilies = [
  {
    title: 'Motor drivers and HATs',
    description: 'Good default path for Raspberry Pi robots with direct motor control.',
    items: ['L298N', 'Cytron MDD10', 'Pololu DRV8835', 'Dual MC33926', 'ThunderBorg', 'Motor HAT', 'MotoZero', 'Adafruit PWM'],
  },
  {
    title: 'Serial and message bridges',
    description: 'Useful when a microcontroller or another board already handles the low-level driving logic.',
    items: ['Serial board bridge', 'MQTT publisher', 'MegaPi board', 'NavQ / MAVSDK'],
  },
  {
    title: 'Robot-specific profiles',
    description: 'Reference adapters from RemoTV that are worth carrying over as compatibility targets.',
    items: ['GoPiGo2', 'GoPiGo3', 'OWI robotic arm', 'Cozmo', 'Vector', 'Telly'],
  },
  {
    title: 'Peripherals and expressive add-ons',
    description: 'Optional extras that can live beside drive control in the same BotParty adapter.',
    items: ['MAX7219 LED matrix', 'Servo controllers', 'Custom GPIO actions', 'Emergency stop relays'],
  },
];

const principles = [
  'Keep the browser commands generic so the UI stays understandable for non-hardware people.',
  'Move board-specific logic into named adapters inside the Python client instead of scattering GPIO code across the app.',
  'Document every adapter with the same schema: purpose, pins or transport, required Python packages, and supported commands.',
  'Treat custom robots as first-class by keeping a clear custom adapter template, not a one-off hack path.',
];

export default function GettingStartedPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-14">
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--card)] px-6 py-8 sm:px-8 sm:py-10">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at top right, rgba(124,58,237,0.16), transparent 42%), radial-gradient(circle at bottom left, rgba(245,158,11,0.12), transparent 36%)',
          }}
        />

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
            <Cable className="h-3.5 w-3.5" />
            Controller Schema
          </div>
          <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
            BotParty hardware should be understandable at a glance.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted-foreground)] sm:text-lg">
            This structure borrows the strength of the old RemoTV controller hardware catalog, but
            reframes it for our stack: browser UI, LiveKit video, BotParty queueing, and a modern
            Python client with explicit adapters.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://github.com/remotv/controller/tree/master/hardware"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-semibold transition hover:border-[var(--muted-foreground)]"
            >
              RemoTV hardware reference
              <ExternalLink className="h-4 w-4" />
            </a>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--primary-hover)]"
            >
              Open robot dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center gap-2">
          <Cpu className="h-5 w-5 text-violet-300" />
          <h2 className="text-xl font-bold">Schema</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {controllerFlow.map((step) => (
            <article
              key={step.title}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
            >
              <div className="mb-4 inline-flex rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3">
                <step.icon className="h-5 w-5 text-violet-300" />
              </div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex items-center gap-2">
            <CircuitBoard className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-bold">Hardware families we should standardize</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            These are the hardware buckets worth carrying over from the RemoTV controller model so
            users can immediately see what kind of robot setup BotParty supports.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {hardwareFamilies.map((family) => (
              <article
                key={family.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4"
              >
                <h3 className="font-semibold">{family.title}</h3>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">{family.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {family.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-bold">What belongs in the adapter schema</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted-foreground)]">
              <p><span className="font-semibold text-[var(--foreground)]">Name:</span> human-readable profile name like `l298n` or `serial-board`.</p>
              <p><span className="font-semibold text-[var(--foreground)]">Transport:</span> GPIO, I2C, USB, serial, MQTT, or SDK.</p>
              <p><span className="font-semibold text-[var(--foreground)]">Dependencies:</span> Python packages and OS packages needed on the Pi.</p>
              <p><span className="font-semibold text-[var(--foreground)]">Supported commands:</span> drive, steer, servo, accessory, estop.</p>
              <p><span className="font-semibold text-[var(--foreground)]">Setup contract:</span> which `config.yaml` keys the user has to fill in.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-sky-300" />
              <h2 className="text-xl font-bold">Design principles</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted-foreground)]">
              {principles.map((principle) => (
                <p key={principle}>{principle}</p>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
