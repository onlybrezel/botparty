'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  api,
  type AllowedUserRecord,
  type ControlButtonRecord,
  type RobotManaged,
  type RobotTelemetryPoint,
} from '@/lib/api';
import { useAuth } from '@/lib/store';
import { LiveKitPlayer } from '@/components/livekit-player';
import { pushToast } from '@/lib/toast';

type RemoteActionType = 'restart_video' | 'restart_control' | 'restart_chat' | 'set_log_stream';
type ControlAccess = 'EVERYONE' | 'QUEUE_TURN' | 'MODERATOR' | 'OWNER';

type ControlButtonDraft = {
  label: string;
  command: string;
  hotKey: string;
  cooldownMs: string;
  access: ControlAccess;
  color: string;
};

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
  accessPassword: string;
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
  accessPassword: '',
};

const LOCAL_SETTINGS_KEY = 'botparty.settings.v1';
const DEFAULT_CONTROL_DRAFT: ControlButtonDraft = {
  label: '',
  command: '',
  hotKey: '',
  cooldownMs: '200',
  access: 'QUEUE_TURN',
  color: '',
};

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

const controlAccessOptions: Array<{ value: ControlAccess; label: string }> = [
  { value: 'EVERYONE', label: 'Everyone' },
  { value: 'QUEUE_TURN', label: 'Current turn' },
  { value: 'MODERATOR', label: 'Moderator' },
  { value: 'OWNER', label: 'Owner' },
];

function toUpdatePayload(form: RobotFormState) {
  const bitrate = Number(form.targetBitrateKbps);
  const hasBitrate = Number.isFinite(bitrate) && bitrate >= 150 && bitrate <= 3000;

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
    accessPassword: form.accessPassword.trim() || undefined,
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
    accessPassword: '',
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
  const [pendingActionTypes, setPendingActionTypes] = useState<RemoteActionType[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [diagLogs, setDiagLogs] = useState<Array<{ ts: number; line: string }>>([]);
  const [telemetry, setTelemetry] = useState<{ latest: RobotTelemetryPoint | null; history: RobotTelemetryPoint[] }>({
    latest: null,
    history: [],
  });
  const [preview, setPreview] = useState<{ token: string; url: string } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [showToken, setShowToken] = useState(false);
  const [controlButtons, setControlButtons] = useState<ControlButtonRecord[]>([]);
  const [controlsLoading, setControlsLoading] = useState(false);
  const [controlDraft, setControlDraft] = useState<ControlButtonDraft>(DEFAULT_CONTROL_DRAFT);
  const [creatingControl, setCreatingControl] = useState(false);
  const [controlOp, setControlOp] = useState<string | null>(null);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUserRecord[]>([]);
  const [allowlistLoading, setAllowlistLoading] = useState(false);
  const [allowlistUsername, setAllowlistUsername] = useState('');
  const [allowlistOp, setAllowlistOp] = useState<string | null>(null);
  const previousPendingActionTypesRef = useRef<RemoteActionType[]>([]);
  const previewRefreshInFlightRef = useRef(false);

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
    setControlDraft(DEFAULT_CONTROL_DRAFT);
  }, [selectedRobot]);

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setControlButtons([]);
      return;
    }

    let active = true;

    const loadControls = async () => {
      setControlsLoading(true);
      try {
        api.setToken(accessToken);
        const buttons = await api.getAllControls(selectedRobot.id);
        if (active) {
          setControlButtons(buttons.sort((a, b) => a.position - b.position));
        }
      } catch {
        if (active) {
          setControlButtons([]);
        }
      } finally {
        if (active) {
          setControlsLoading(false);
        }
      }
    };

    void loadControls();
    return () => {
      active = false;
    };
  }, [selectedRobot?.id, accessToken]);

  useEffect(() => {
    if (!accessToken || !selectedRobot || selectedRobot.accessMode !== 'ALLOWED_USERS') {
      setAllowedUsers([]);
      return;
    }

    let active = true;
    setAllowlistLoading(true);

    api.setToken(accessToken);
    api.getAllowedUsers(selectedRobot.id)
      .then((rows) => {
        if (active) {
          setAllowedUsers(rows);
        }
      })
      .catch(() => {
        if (active) {
          setAllowedUsers([]);
        }
      })
      .finally(() => {
        if (active) {
          setAllowlistLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedRobot?.id, selectedRobot?.accessMode, accessToken]);

  const refreshPreview = useCallback(async (forceRemount = false) => {
    if (!selectedRobot || !accessToken || selectedRobot.status !== 'ONLINE') {
      setPreview(null);
      return;
    }
    if (previewRefreshInFlightRef.current) {
      return;
    }

    previewRefreshInFlightRef.current = true;
    setPreview(null);
    try {
      api.setToken(accessToken);
      const { token, livekitUrl } = await api.getViewerToken(selectedRobot.id, false);
      setPreview({ token, url: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? livekitUrl });
      if (forceRemount) {
        setPreviewVersion((value) => value + 1);
      }
    } catch {
      setPreview(null);
    } finally {
      previewRefreshInFlightRef.current = false;
    }
  }, [accessToken, selectedRobot]);

  useEffect(() => {
    void refreshPreview(false);
  }, [refreshPreview]);

  useEffect(() => {
    const previous = previousPendingActionTypesRef.current;
    const restartVideoWasPending = previous.includes('restart_video');
    const restartVideoIsPending = pendingActionTypes.includes('restart_video');
    previousPendingActionTypesRef.current = pendingActionTypes;

    if (!restartVideoWasPending || restartVideoIsPending || !selectedRobot || !accessToken || selectedRobot.status !== 'ONLINE') {
      return;
    }

    void refreshPreview(true);
  }, [pendingActionTypes, selectedRobot?.id, selectedRobot?.status, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setPendingActionTypes([]);
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        api.setToken(accessToken);
        const result = await api.getPendingRobotActions(selectedRobot.id);
        if (active) {
          const nextTypes = Array.from(
            new Set(
              result.actions
                .map((action) => action.type)
                .filter(
                  (type): type is RemoteActionType =>
                    type === 'restart_video' ||
                    type === 'restart_control' ||
                    type === 'restart_chat' ||
                    type === 'set_log_stream',
                ),
            ),
          );
          setPendingActionTypes(nextTypes);
        }
      } catch {
        // ignore pending action polling errors
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

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setTelemetry({ latest: null, history: [] });
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        api.setToken(accessToken);
        const result = await api.getRobotTelemetry(selectedRobot.id);
        if (active) {
          setTelemetry(result);
        }
      } catch {
        // ignore telemetry polling errors
      }
    };

    poll().catch(() => {});
    const interval = setInterval(() => {
      poll().catch(() => {});
    }, 5000);

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
    type: RemoteActionType,
    durationSec?: number,
  ) => {
    if (!accessToken || !selectedRobot) return;
    if (pendingActionTypes.includes(type)) {
      const message = 'Action is already queued, waiting for pickup.';
      setStatus(message);
      pushToast(message, 'info', 2600);
      return;
    }
    setOpLoading(type);
    setStatus(null);
    setError(null);
    try {
      api.setToken(accessToken);
      const result = await api.enqueueRobotAction(selectedRobot.id, { type, durationSec });
      if (result.alreadyQueued) {
        const message = 'Action is already queued, waiting for pickup.';
        setStatus(message);
        pushToast(message, 'info', 2600);
        return;
      }
      setPendingActionTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
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

  const handleCreateControl = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken || !selectedRobot) return;

    setCreatingControl(true);
    setError(null);
    try {
      api.setToken(accessToken);
      const next = await api.createControl(selectedRobot.id, {
        label: controlDraft.label.trim(),
        command: controlDraft.command.trim(),
        hotKey: controlDraft.hotKey.trim() || undefined,
        cooldownMs: Number(controlDraft.cooldownMs),
        access: controlDraft.access,
        color: controlDraft.color.trim() || undefined,
      });

      setControlButtons((prev) =>
        [...prev, next].sort((a, b) => a.position - b.position),
      );
      setControlDraft(DEFAULT_CONTROL_DRAFT);
      pushToast('Control button created.', 'success', 2500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create control button';
      setError(message);
      pushToast(message, 'error', 3200);
    } finally {
      setCreatingControl(false);
    }
  };

  const handleToggleControl = async (button: ControlButtonRecord) => {
    if (!accessToken) return;

    setControlOp(button.id);
    try {
      api.setToken(accessToken);
      const updated = await api.updateControl(button.id, { isEnabled: !button.isEnabled });
      setControlButtons((prev) =>
        prev.map((entry) => (entry.id === button.id ? updated : entry)),
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to update control.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const handleDeleteControl = async (button: ControlButtonRecord) => {
    if (!accessToken || !selectedRobot) return;
    if (!window.confirm(`Delete control button ${button.label}?`)) return;

    setControlOp(button.id);
    try {
      api.setToken(accessToken);
      await api.deleteControl(button.id);
      const nextButtons = controlButtons
        .filter((entry) => entry.id !== button.id)
        .map((entry, index) => ({ ...entry, position: index }));
      setControlButtons(nextButtons);
      await api.reorderControls(
        selectedRobot.id,
        nextButtons.map((entry, index) => ({ id: entry.id, position: index })),
      );
      pushToast('Control button deleted.', 'success', 2200);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete control.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const moveControl = async (buttonId: string, direction: -1 | 1) => {
    if (!accessToken || !selectedRobot) return;

    const currentIndex = controlButtons.findIndex((entry) => entry.id === buttonId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= controlButtons.length) {
      return;
    }

    const nextButtons = [...controlButtons];
    const [moved] = nextButtons.splice(currentIndex, 1);
    nextButtons.splice(targetIndex, 0, moved);
    const normalized = nextButtons.map((entry, index) => ({ ...entry, position: index }));

    setControlButtons(normalized);
    setControlOp(buttonId);
    try {
      api.setToken(accessToken);
      await api.reorderControls(
        selectedRobot.id,
        normalized.map((entry, index) => ({ id: entry.id, position: index })),
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to reorder controls.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const addAllowedUser = async () => {
    if (!accessToken || !selectedRobot) return;
    const username = allowlistUsername.trim();
    if (!username) return;

    setAllowlistOp('add');
    try {
      api.setToken(accessToken);
      const added = await api.addAllowedUser(selectedRobot.id, username);
      setAllowedUsers((prev) => {
        if (prev.some((entry) => entry.id === added.id)) return prev;
        return [...prev, added];
      });
      setAllowlistUsername('');
      pushToast('User added to allow list.', 'success', 2200);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to add user.', 'error');
    } finally {
      setAllowlistOp(null);
    }
  };

  const removeAllowedUser = async (user: AllowedUserRecord) => {
    if (!accessToken || !selectedRobot) return;

    setAllowlistOp(user.id);
    try {
      api.setToken(accessToken);
      await api.removeAllowedUser(selectedRobot.id, user.id);
      setAllowedUsers((prev) => prev.filter((entry) => entry.id !== user.id));
      pushToast('User removed from allow list.', 'success', 2200);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to remove user.', 'error');
    } finally {
      setAllowlistOp(null);
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
            <input
              type="password"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="Optional room password"
              value={createForm.accessPassword}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, accessPassword: event.target.value }))}
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
          <p>Target Bitrate: desired stream quality for the robot uplink (150-3000 kbps).</p>
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
                        <LiveKitPlayer
                          key={`${selectedRobot.id}-${previewVersion}`}
                          token={preview.token}
                          livekitUrl={preview.url}
                          onStreamStalled={() => {
                            void refreshPreview(true);
                          }}
                        />
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
                    <input
                      type="password"
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.accessPassword}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, accessPassword: event.target.value }))
                      }
                      placeholder="Room password (only used in password mode)"
                    />
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
                      max={3000}
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
                        disabled={opLoading !== null || pendingActionTypes.includes('restart_video')}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {opLoading === 'restart_video'
                          ? 'Queueing...'
                          : pendingActionTypes.includes('restart_video')
                            ? 'Queued, waiting for pickup'
                            : 'Restart Video'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runRobotAction('restart_control')}
                        disabled={opLoading !== null || pendingActionTypes.includes('restart_control')}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {opLoading === 'restart_control'
                          ? 'Queueing...'
                          : pendingActionTypes.includes('restart_control')
                            ? 'Queued, waiting for pickup'
                            : 'Restart Control'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runRobotAction('restart_chat')}
                        disabled={opLoading !== null || pendingActionTypes.includes('restart_chat')}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        {opLoading === 'restart_chat'
                          ? 'Queueing...'
                          : pendingActionTypes.includes('restart_chat')
                            ? 'Queued, waiting for pickup'
                            : 'Restart Chat Bridge'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runRobotAction('set_log_stream', 120)}
                        disabled={opLoading !== null || pendingActionTypes.includes('set_log_stream')}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-60"
                      >
                        {opLoading === 'set_log_stream'
                          ? 'Queueing...'
                          : pendingActionTypes.includes('set_log_stream')
                            ? 'Queued, waiting for pickup'
                            : 'Enable 2min Diagnostics'}
                      </button>
                    </div>
                  </div>

                  {selectedRobot.accessMode === 'ALLOWED_USERS' && (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                      <div className="mb-3">
                        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Allow List</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          Only these signed-in users can enter the room.
                        </p>
                      </div>
                      <div className="mb-3 flex gap-2">
                        <input
                          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          placeholder="Username"
                          value={allowlistUsername}
                          onChange={(event) => setAllowlistUsername(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => void addAllowedUser()}
                          disabled={allowlistOp === 'add'}
                          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
                        >
                          {allowlistOp === 'add' ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                      {allowlistLoading ? (
                        <p className="text-xs text-[var(--muted-foreground)]">Loading allow list...</p>
                      ) : allowedUsers.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">No users allow-listed yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {allowedUsers.map((user) => (
                            <div
                              key={user.id}
                              className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {user.displayName ?? user.username}
                                </p>
                                <p className="truncate text-xs text-[var(--muted-foreground)]">
                                  @{user.username}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void removeAllowedUser(user)}
                                disabled={allowlistOp === user.id}
                                className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Control Buttons</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          Manage the button deck shown on the public robot page.
                        </p>
                      </div>
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {controlButtons.length} configured
                      </span>
                    </div>

                    <form onSubmit={handleCreateControl} className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Label"
                        value={controlDraft.label}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, label: event.target.value }))
                        }
                        required
                      />
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Command"
                        value={controlDraft.command}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, command: event.target.value }))
                        }
                        required
                      />
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Hotkey (optional)"
                        maxLength={8}
                        value={controlDraft.hotKey}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, hotKey: event.target.value }))
                        }
                      />
                      <input
                        type="number"
                        min={50}
                        max={10000}
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Cooldown ms"
                        value={controlDraft.cooldownMs}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, cooldownMs: event.target.value }))
                        }
                      />
                      <select
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        value={controlDraft.access}
                        onChange={(event) =>
                          setControlDraft((prev) => ({
                            ...prev,
                            access: event.target.value as ControlAccess,
                          }))
                        }
                      >
                        {controlAccessOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            Access: {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Color (optional, e.g. #22c55e)"
                        value={controlDraft.color}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, color: event.target.value }))
                        }
                      />
                      <div className="sm:col-span-2">
                        <button
                          type="submit"
                          disabled={creatingControl}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
                        >
                          <Plus className="h-4 w-4" />
                          {creatingControl ? 'Creating...' : 'Add control button'}
                        </button>
                      </div>
                    </form>

                    {controlsLoading ? (
                      <p className="text-xs text-[var(--muted-foreground)]">Loading control buttons...</p>
                    ) : controlButtons.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        No custom controls yet. Add your first button above.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {controlButtons
                          .slice()
                          .sort((a, b) => a.position - b.position)
                          .map((button, index) => (
                            <div
                              key={button.id}
                              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{button.label}</span>
                                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                                    {button.command}
                                  </span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                                      button.isEnabled === false
                                        ? 'bg-zinc-700/60 text-zinc-300'
                                        : 'bg-emerald-500/15 text-emerald-300'
                                    }`}
                                  >
                                    {button.isEnabled === false ? 'Disabled' : 'Enabled'}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                                  Access: {button.access} · Cooldown: {button.cooldownMs}ms
                                  {button.hotKey ? ` · Hotkey: ${button.hotKey}` : ''}
                                  {button.color ? ` · Color: ${button.color}` : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void moveControl(button.id, -1)}
                                  disabled={index === 0 || controlOp === button.id}
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void moveControl(button.id, 1)}
                                  disabled={index === controlButtons.length - 1 || controlOp === button.id}
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleControl(button)}
                                  disabled={controlOp === button.id}
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                                >
                                  {button.isEnabled === false ? 'Enable' : 'Disable'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteControl(button)}
                                  disabled={controlOp === button.id}
                                  className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
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

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Runtime Telemetry</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">dashboard refreshes 5s, client updates ~30s</p>
                    </div>
                    {telemetry.latest ? (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">CPU</p>
                            <p className="font-semibold">{formatPercent(telemetry.latest.cpuPercent)}</p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">Memory</p>
                            <p className="font-semibold">{formatPercent(telemetry.latest.memoryPercent)}</p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">Temp</p>
                            <p className="font-semibold">
                              {telemetry.latest.temperatureC === null ? '-' : `${telemetry.latest.temperatureC.toFixed(1)} C`}
                            </p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">Uptime</p>
                            <p className="font-semibold">{formatUptime(telemetry.latest.uptimeSec)}</p>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">LiveKit</p>
                            <p className="font-semibold">{telemetry.latest.livekitConnected ? 'Connected' : 'Offline'}</p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">Control WS</p>
                            <p className="font-semibold">{telemetry.latest.controlConnected ? 'Connected' : 'Offline'}</p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">Commands</p>
                            <p className="font-semibold">{telemetry.latest.commandsReceived}</p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5">
                            <p className="text-[var(--muted-foreground)]">Frames</p>
                            <p className="font-semibold">{telemetry.latest.cameraFrames}</p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <TelemetryBars
                            title="CPU trend"
                            values={telemetry.history
                              .map((point) => point.cpuPercent)
                              .filter((value): value is number => typeof value === 'number')}
                            suffix="%"
                          />
                          <TelemetryBars
                            title="Memory trend"
                            values={telemetry.history
                              .map((point) => point.memoryPercent)
                              .filter((value): value is number => typeof value === 'number')}
                            suffix="%"
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        No telemetry yet. Start your robot client to stream runtime stats.
                      </p>
                    )}
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

function TelemetryBars({
  title,
  values,
  suffix,
}: {
  title: string;
  values: number[];
  suffix: string;
}) {
  const recent = values.slice(-24);
  const current = recent.length > 0 ? (recent[recent.length - 1] ?? null) : null;

  return (
    <div className="rounded border border-[var(--border)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{title}</p>
        <p className="text-xs font-semibold">{current === null ? '-' : `${Math.round(current)}${suffix}`}</p>
      </div>
      {recent.length === 0 ? (
        <p className="text-[10px] text-[var(--muted-foreground)]">No recent samples</p>
      ) : (
        <div className="flex h-14 items-end gap-1">
          {recent.map((value, idx) => (
            <div
              key={`${title}-${idx}`}
              className="flex-1 rounded-sm bg-[var(--primary)]/60"
              style={{ height: `${Math.max(8, Math.min(100, value))}%` }}
              title={`${Math.round(value)}${suffix}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function formatUptime(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-';

  const totalSeconds = Math.floor(value);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
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
