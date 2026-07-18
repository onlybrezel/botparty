import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Multi-Camera',
  description: 'How BotParty should handle front/rear and other multi-camera robot setups across client, backend, and viewer UX.',
};

const configExample = `stream:
  targetBitrateKbps: 1200
  activeCameraId: "front"
  cameras:
    - id: "front"
      label: "Front"
      role: "primary"
      enabled: true
      publishMode: "always_on"
    - id: "rear"
      label: "Rear"
      role: "secondary"
      enabled: true
      publishMode: "preview_only"`;

export default function MultiCameraDocsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">System Design</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Multi-Camera</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted-foreground)]">
              The recommended BotParty direction for robots with a front camera, rear camera, or any other secondary view.
              The key rule is simple: multi-camera should feel like an upgrade, not a new product that breaks single-camera robots.
            </p>
          </div>
          <Link
            href="/docs/getting-started"
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--primary)]/60"
          >
            Back to Getting Started
          </Link>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm font-semibold">Robot client</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Publish one LiveKit video track per enabled camera in the same room. Keep audio single-source and isolate restarts per camera.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm font-semibold">Backend metadata</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Store camera descriptors in robot stream metadata so the viewer knows expected labels, order, and default primary camera before tracks appear.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm font-semibold">Viewer UX</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Render one primary video plus one or more previews. If only one camera exists, the UI should collapse back to the current single-camera experience.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <p className="text-sm font-semibold">Recommended platform rules</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
              <li>Keep `camera` plus `video` as the backward-compatible single-camera path.</li>
              <li>Add optional camera descriptors to `metadata.stream.cameras` on the robot record.</li>
              <li>Use stable camera IDs such as `front`, `rear`, `arm`, and `dock`.</li>
              <li>Never rely on track ordering alone when choosing the main viewer stream.</li>
              <li>A failed secondary camera must not force the robot room offline.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <p className="text-sm font-semibold">Performance defaults that age well</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
              <li>Front camera: 720p at roughly 20 to 30 fps.</li>
              <li>Rear camera: 360p or 480p at roughly 10 to 15 fps.</li>
              <li>Use one high-value stream and keep secondary views intentionally cheap.</li>
              <li>For weaker boards, let secondary cameras run as preview-only or on-demand.</li>
              <li>Prefer CSI plus USB mixes over two heavy USB webcams on the same weak bus.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <p className="text-sm font-semibold">Suggested backend metadata shape</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            This is enough for labels, ordering, and default camera selection without forcing a brand-new database model on day one.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs leading-6 text-[var(--foreground)]">
            <code>{configExample}</code>
          </pre>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <p className="text-sm font-semibold">Implementation order</p>
          <ol className="mt-3 space-y-3 text-sm text-[var(--muted-foreground)]">
            <li>1. Use the same camera entries for single- and multi-camera setups.</li>
            <li>2. Publish one video track per camera with stable IDs or metadata.</li>
            <li>3. Expose optional camera descriptors through shared types and robot metadata.</li>
            <li>4. Update the web player to collect multiple camera tracks instead of picking the first one.</li>
            <li>5. Ship a default primary-plus-preview layout before adding smart auto-switching.</li>
          </ol>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <p className="text-sm font-semibold">Why this direction is the safest one</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            It preserves everything that already works for current robots, but it gives the platform a real contract for richer camera setups.
            The client, backend, and viewer all gain the same vocabulary instead of inventing three separate partial solutions.
          </p>
        </div>
      </section>
    </div>
  );
}
