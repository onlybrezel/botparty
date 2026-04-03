'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  Cable,
  CircuitBoard,
  Copy,
  ExternalLink,
  RefreshCcw,
  Save,
  Trash2,
  Plus,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api, type RobotManaged } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { LiveKitPlayer } from '@/components/livekit-player';
import { pushToast } from '@/lib/toast';

type RobotFormState = {
  name: string;
  description: string;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  accessMode: 'OPEN' | 'PASSWORD' | 'LINK_ONLY' | 'ALLOWED_USERS';
  queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  aclVideo: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclControl: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclChat: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  aclEStop: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  targetBitrateKbps: string;
  maxTurnTime: number;
  maxViewers: number;
  maxControllers: number;
  tags: string;
};

const DEFAULT_CREATE_FORM: RobotFormState = {
  name: '',
  description: '',
  visibility: 'PUBLIC',
  accessMode: 'OPEN',
  queueMode: 'FIRST_COME',
  aclVideo: 'AUTHENTICATED',
  aclControl: 'AUTHENTICATED',
  aclChat: 'AUTHENTICATED',
  aclEStop: 'AUTHENTICATED',
  targetBitrateKbps: '1800',
  maxTurnTime: 60000,
  maxViewers: 1000,
  maxControllers: 10,
  tags: '',
};

const LOCAL_SETTINGS_KEY = 'botparty.settings.v1';

const accessModeOptions: Array<{
  value: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  title: string;
  description: string;
}> = [
  { value: 'ALL', title: 'Everyone', description: 'Also allowed without login' },
  {
    value: 'AUTHENTICATED',
    title: 'Authenticated only',
    description: 'Requires login',
  },
  { value: 'DISABLED', title: 'Disabled', description: 'Function is disabled' },
];

function toUpdatePayload(form: RobotFormState) {
  const bitrate = Number(form.targetBitrateKbps);
  const hasBitrate = Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 8000;

  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    visibility: form.visibility,
    accessMode: form.accessMode,
    queueMode: form.queueMode,
    acl: {
      video: form.aclVideo,
      control: form.aclControl,
      chat: form.aclChat,
      estop: form.aclEStop,
    },
    stream: {
      targetBitrateKbps: hasBitrate ? Math.round(bitrate) : undefined,
    },
    maxTurnTime: Number(form.maxTurnTime),
    maxViewers: Number(form.maxViewers),
    maxControllers: Number(form.maxControllers),
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

function formFromRobot(robot: RobotManaged): RobotFormState {
  const access = robot.metadata?.access;
  const stream = robot.metadata?.stream;

  return {
    name: robot.name,
    description: robot.description ?? '',
    visibility: robot.visibility,
    accessMode: robot.accessMode,
    queueMode: robot.queueMode,
    aclVideo: access?.video ?? 'AUTHENTICATED',
    aclControl: access?.control ?? 'AUTHENTICATED',
    aclChat: access?.chat ?? 'AUTHENTICATED',
    aclEStop: access?.estop ?? 'AUTHENTICATED',
    targetBitrateKbps:
      typeof stream?.targetBitrateKbps === 'number' ? String(stream.targetBitrateKbps) : '',
    maxTurnTime: robot.maxTurnTime,
    maxViewers: robot.maxViewers,
    maxControllers: robot.maxControllers,
    tags: robot.tags.join(', '),
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const { accessToken } = useAuth();

  const [robots, setRobots] = useState<RobotManaged[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<RobotFormState>(DEFAULT_CREATE_FORM);
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRobot = useMemo(
    () => robots.find((robot) => robot.id === selectedId) ?? null,
    [robots, selectedId],
  );

  const [editForm, setEditForm] = useState<RobotFormState>(DEFAULT_CREATE_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [opLoading, setOpLoading] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [diagLogs, setDiagLogs] = useState<Array<{ ts: number; line: string }>>([]);
  const [preview, setPreview] = useState<{ token: string; url: string } | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      setStatus(null);

      try {
        api.setToken(accessToken);
        const data = await api.getMyRobots();
        setRobots(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load robots';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    load().catch(() => {});

    try {
      const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { dashboardMaskToken?: boolean };
        setShowToken(parsed.dashboardMaskToken === false);
      }
    } catch {
      setShowToken(false);
    }
  }, [accessToken, router]);

  useEffect(() => {
    if (!selectedRobot) return;
    setEditForm(formFromRobot(selectedRobot));
  }, [selectedRobot]);

  useEffect(() => {
    if (!selectedRobot || !accessToken || selectedRobot.status !== 'ONLINE') {
      setPreview(null);
      return;
    }
    setPreview(null);
    api.setToken(accessToken);
    api.getViewerToken(selectedRobot.id, false)
      .then(({ token, livekitUrl }) => setPreview({ token, url: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? livekitUrl }))
      .catch(() => {});
  }, [selectedRobot?.id, selectedRobot?.status, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setDiagLogs([]);
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        api.setToken(accessToken);
        const result = await api.getRobotLogs(selectedRobot.id);
        if (active) {
          setDiagLogs(result.logs.slice(-150));
        }
      } catch {
        // ignore polling errors
      }
    };

    poll().catch(() => {});
    const interval = setInterval(() => {
      poll().catch(() => {});
    }, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedRobot?.id, accessToken]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    setCreating(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const created = await api.createRobot(toUpdatePayload(createForm));
      const next = [created, ...robots];
      setRobots(next);
      setSelectedId(created.id);
      setEditForm(formFromRobot(created));
      setCreateForm(DEFAULT_CREATE_FORM);
      setStatus('Robot created. You can now copy the claim token to your Raspberry Pi config.');
      pushToast('Robot created.', 'success', 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create robot';
      setError(message);
      pushToast(message, 'error', 3500);
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selectedRobot) return;

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const previousBitrate = selectedRobot.metadata?.stream?.targetBitrateKbps ?? null;
      const updated = await api.updateRobot(selectedRobot.id, toUpdatePayload(editForm));
      setRobots((prev) => prev.map((robot) => (robot.id === updated.id ? updated : robot)));
      setStatus('Robot settings saved.');

      const nextBitrate = updated.metadata?.stream?.targetBitrateKbps ?? null;
      if (previousBitrate !== nextBitrate) {
        await api.enqueueRobotAction(updated.id, { type: 'restart_video' });
        pushToast('Bitrate updated. Video stream restarting.', 'info', 3600);
      } else {
        pushToast('Settings saved.', 'success', 2800);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save robot';
      setError(message);
      pushToast(message, 'error', 3500);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!accessToken || !selectedRobot) return;
    const confirmed = window.confirm(`Delete robot ${selectedRobot.name}? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      await api.deleteRobot(selectedRobot.id);
      const remaining = robots.filter((robot) => robot.id !== selectedRobot.id);
      setRobots(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setStatus('Robot deleted.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete robot';
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRegenerate = async () => {
    if (!accessToken || !selectedRobot) return;
    const confirmed = window.confirm(
      `Generate a new claim token for ${selectedRobot.name}? The old token will be invalidated immediately.`,
    );
    if (!confirmed) return;

    setRegenerating(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const nextToken = await api.regenerateRobotToken(selectedRobot.id);
      setRobots((prev) =>
        prev.map((robot) =>
          robot.id === selectedRobot.id ? { ...robot, claimToken: nextToken.claimToken } : robot,
        ),
      );
      setStatus('Claim token regenerated. Update config.yaml on your Pi before restarting the client.');
      pushToast('New claim token generated.', 'success', 3200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate token';
      setError(message);
      pushToast(message, 'error', 3500);
    } finally {
      setRegenerating(false);
    }
  };

  const copyToken = async () => {
    if (!selectedRobot) return;
    try {
      await navigator.clipboard.writeText(selectedRobot.claimToken);
      setStatus('Claim token copied to clipboard.');
      pushToast('Claim token copied to clipboard.', 'success');
    } catch {
      setError('Clipboard permission denied. Copy token manually.');
      pushToast('Clipboard access denied - please copy manually.', 'error');
    }
  };

  const runRobotAction = async (
    type: 'restart_video' | 'restart_control' | 'restart_chat' | 'set_log_stream',
    durationSec?: number,
  ) => {
    if (!accessToken || !selectedRobot) return;
    setOpLoading(type);
    setStatus(null);
    setError(null);
    try {
      api.setToken(accessToken);
      await api.enqueueRobotAction(selectedRobot.id, { type, durationSec });
      if (type === 'set_log_stream') {
        setDiagLogs([]);
        setStatus(`Temporary diagnostics enabled for ${durationSec ?? 120}s.`);
        pushToast(`Diagnostics enabled for ${durationSec ?? 120}s.`, 'info', 3000);
      } else {
        setStatus(`Action queued: ${type}`);
        pushToast(`Action queued: ${type}`, 'success', 2600);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue action');
      pushToast(err instanceof Error ? err.message : 'Failed to queue action.', 'error');
    } finally {
      setOpLoading(null);
    }
  };

  const refreshLogs = async () => {
    if (!accessToken || !selectedRobot) return;
    setLogsLoading(true);
    try {
      api.setToken(accessToken);
      const result = await api.getRobotLogs(selectedRobot.id);
      setDiagLogs(result.logs.slice(-150));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLogsLoading(false);
    }
  };

  if (!accessToken) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/15">
            <Bot className="h-5 w-5 text-violet-300" />
          </span>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Robots Dashboard</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Create robots, configure settings, and copy claim tokens for your Raspberry Pi client.
            </p>
          </div>
        </div>
      </section>

      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {status && <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{status}</p>}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={handleCreate} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
          <h2 className="mb-4 text-lg font-bold">Create Robot</h2>

          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="Robot name"
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <textarea
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="Description"
              rows={3}
              value={createForm.description}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
            />
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="Tags (comma separated)"
              value={createForm.tags}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, tags: event.target.value }))}
            />
          </div>

          <button
            type="submit"
            disabled={creating || loading}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Creating...' : 'Create robot'}
          </button>
        </form>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
          <h2 className="mb-4 text-lg font-bold">Raspberry Pi Quickstart</h2>
          <ol className="space-y-2 text-sm text-[var(--muted-foreground)]">
            <li>1. Create a robot and copy the claim token.</li>
            <li>2. On your Pi: clone the botparty-client repository.</li>
            <li>3. Create a venv, install requirements, and copy config.example.yaml to config.yaml.</li>
            <li>4. Paste your claim token and set api_url/livekit_url to your server URLs.</li>
            <li>5. Start with: python -m botparty_robot</li>
          </ol>
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cable className="h-4 w-4 text-violet-300" />
              Controller schema
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Browser UI → BotParty API + LiveKit → Python robot client → hardware adapter
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
              {['L298N', 'Serial bridge', 'MQTT', 'GoPiGo', 'ThunderBorg', 'OWI arm', 'MAX7219'].map((item) => (
                <span key={item} className="rounded-full border border-[var(--border)] px-2.5 py-1">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cable className="h-4 w-4 text-violet-300" />
            Controller flow
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            Keep browser controls simple. Board-specific behavior belongs in the robot client.
          </p>
        </article>

        <article className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CircuitBoard className="h-4 w-4 text-amber-300" />
            Hardware support
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            Direct motor drivers, serial bridges, MQTT targets, and robot-specific profiles all fit
            into the same client structure.
          </p>
        </article>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="mb-4 text-lg font-bold">My Robots</h2>

        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted-foreground)]">
          <p className="font-semibold text-[var(--foreground)]">Settings guide</p>
          <p className="mt-1">Visibility: who can discover this robot in Explore.</p>
          <p>Access Mode: entry model for the room itself (open/password/invite/allowlist).</p>
          <p>Queue Mode: how control turns are assigned.</p>
          <p>Guest ACL: what non-logged-in visitors are allowed to do.</p>
          <p>Guest E-STOP: who can see and trigger emergency stop.</p>
          <p>Target Bitrate: desired stream quality for the robot uplink (150-8000 kbps).</p>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading robots...</p>
        ) : robots.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No robots yet. Create your first robot above.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <aside className="space-y-2 lg:col-span-4">
              {robots.map((robot) => (
                <button
                  key={robot.id}
                  onClick={() => setSelectedId(robot.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    selectedId === robot.id
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                      : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--muted-foreground)]'
                  }`}
                >
                  <p className="font-semibold">{robot.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">/{robot.slug}</p>
                </button>
              ))}
            </aside>

            <div className="lg:col-span-8">
              {selectedRobot ? (
                <>
                  {/* Live preview */}
                  <div className="mb-4 overflow-hidden rounded-xl border border-[var(--border)] bg-black">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
                      <div className="flex items-center gap-2">
                        {selectedRobot.status === 'ONLINE' ? (
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                            LIVE
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">Offline</span>
                        )}
                      </div>
                      <a
                        href={`/robot/${selectedRobot.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    </div>
                    <div className="relative aspect-video w-full bg-zinc-950">
                      {preview ? (
                        <LiveKitPlayer token={preview.token} livekitUrl={preview.url} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
                          {selectedRobot.status === 'ONLINE' ? 'Connecting...' : 'Robot is offline'}
                        </div>
                      )}
                    </div>
                  </div>

                <form onSubmit={handleSave} className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.name}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                      required
                    />
                    <select
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.visibility}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, visibility: event.target.value as RobotFormState['visibility'] }))
                      }
                    >
                      <option value="PUBLIC">Visibility: Public</option>
                      <option value="UNLISTED">Visibility: Unlisted (link only)</option>
                      <option value="PRIVATE">Visibility: Private</option>
                    </select>
                    <select
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.accessMode}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, accessMode: event.target.value as RobotFormState['accessMode'] }))
                      }
                    >
                      <option value="OPEN">Room Access: Open</option>
                      <option value="PASSWORD">Room Access: Password</option>
                      <option value="LINK_ONLY">Room Access: Link only</option>
                      <option value="ALLOWED_USERS">Room Access: Allow list only</option>
                    </select>
                    <select
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.queueMode}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, queueMode: event.target.value as RobotFormState['queueMode'] }))
                      }
                    >
                      <option value="FIRST_COME">Queue: First come, first served</option>
                      <option value="VOTING">Queue: Voting</option>
                      <option value="DISABLED">Queue: Disabled</option>
                    </select>

                    <AclPicker
                      title="Video Access"
                      value={editForm.aclVideo}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, aclVideo: value }))}
                    />

                    <AclPicker
                      title="Control Access"
                      value={editForm.aclControl}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, aclControl: value }))}
                    />

                    <AclPicker
                      title="Chat Access"
                      value={editForm.aclChat}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, aclChat: value }))}
                    />

                    <AclPicker
                      title="E-STOP Access"
                      value={editForm.aclEStop}
                      onChange={(value) => setEditForm((prev) => ({ ...prev, aclEStop: value }))}
                    />

                    <input
                      type="number"
                      min={150}
                      max={8000}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.targetBitrateKbps}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, targetBitrateKbps: event.target.value }))
                      }
                      placeholder="Target bitrate (kbps), e.g. 1800"
                    />

                    <input
                      type="number"
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.maxTurnTime}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, maxTurnTime: Number(event.target.value) }))
                      }
                      placeholder="Max turn time in ms (e.g. 60000)"
                    />
                    <input
                      type="number"
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.maxViewers}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, maxViewers: Number(event.target.value) }))
                      }
                      placeholder="Max viewers"
                    />
                    <input
                      type="number"
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.maxControllers}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, maxControllers: Number(event.target.value) }))
                      }
                      placeholder="Max controllers"
                    />
                  </div>

                  <textarea
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    rows={3}
                    value={editForm.description}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="Description"
                  />

                  <input
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    value={editForm.tags}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, tags: event.target.value }))}
                    placeholder="Tags (comma separated)"
                  />

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Claim Token</p>
                    <div className="flex items-center gap-2">
                      <code className="block min-h-5 flex-1 break-all text-xs text-[var(--foreground)]">
                        {showToken ? selectedRobot.claimToken : `${selectedRobot.claimToken.slice(0, 6)}••••••••••••••••••••`}
                      </code>
                      <button
                        type="button"
                        onClick={() => setShowToken((prev) => !prev)}
                        className="rounded border border-[var(--border)] p-1.5"
                        aria-label="Toggle token visibility"
                      >
                        {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={copyToken}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy token
                      </button>
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-60"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {regenerating ? 'Regenerating...' : 'Regenerate token'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Remote Operations (Pi)</p>
                    <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                      Run maintenance actions on the robot client without SSH. Commands are queued and picked up on the next poll cycle.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => runRobotAction('restart_video')}
                        disabled={opLoading !== null}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {opLoading === 'restart_video' ? 'Queueing...' : 'Restart Video'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runRobotAction('restart_control')}
                        disabled={opLoading !== null}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {opLoading === 'restart_control' ? 'Queueing...' : 'Restart Control'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runRobotAction('restart_chat')}
                        disabled={opLoading !== null}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {opLoading === 'restart_chat' ? 'Queueing...' : 'Restart Chat Bridge'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runRobotAction('set_log_stream', 120)}
                        disabled={opLoading !== null}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-60"
                      >
                        {opLoading === 'set_log_stream' ? 'Queueing...' : 'Enable 2min Diagnostics'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Temporary Diagnostics</p>
                      <button
                        type="button"
                        onClick={refreshLogs}
                        disabled={logsLoading}
                        className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)] disabled:opacity-60"
                      >
                        {logsLoading ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>
                    <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                      Ephemeral logs from Pi (auto-expire, no long-term storage). Last {diagLogs.length} lines shown.
                    </p>
                    <div className="max-h-56 overflow-auto rounded border border-[var(--border)] bg-black/70 p-2 font-mono text-[11px] leading-5 text-emerald-300">
                      {diagLogs.length === 0 ? (
                        <p className="text-[var(--muted-foreground)]">No diagnostics logs yet. Trigger "Enable 2min Diagnostics".</p>
                      ) : (
                        diagLogs.map((row, idx) => (
                          <p key={`${row.ts}-${idx}`}>[{new Date(row.ts).toLocaleTimeString()}] {row.line}</p>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Saving...' : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={handleDelete}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deleting ? 'Deleting...' : 'Delete robot'}
                    </button>
                  </div>
                </form>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--background)] p-6 text-sm text-[var(--muted-foreground)]">
                  Select a robot on the left to edit its settings.
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function AclPicker({
  title,
  value,
  onChange,
}: {
  title: string;
  value: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  onChange: (value: 'ALL' | 'AUTHENTICATED' | 'DISABLED') => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</p>
      <div className="flex flex-wrap gap-2">
        {accessModeOptions.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                active
                  ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--foreground)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title={option.description}
            >
              {active && <Check className="h-3 w-3" />}
              {option.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
