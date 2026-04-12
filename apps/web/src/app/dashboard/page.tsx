'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  X,
} from 'lucide-react';
import {
  api,
  type AllowedUserRecord,
  type ControlButtonRecord,
  type RobotCameraIngress,
  type RobotManaged,
  type RobotTelemetryPoint,
} from '@/lib/api';
import type { ControlButtonAccess } from '@botparty/shared';
import { ControlButtonAccess as ControlButtonAccessEnum } from '@botparty/shared';
import { useAuth } from '@/lib/store';
import { LiveKitPlayer } from '@/components/livekit-player';
import { pushToast } from '@/lib/toast';
import { Select } from '@/components/ui/select';

type RemoteActionType = 'restart_video' | 'restart_control' | 'restart_chat' | 'update_client' | 'set_log_stream';

type ControlPresetKey = 'ptz-pan' | 'ptz-tilt' | 'drive-speed' | 'gripper' | 'arm-xy';

type ControlButtonDraft = {
  label: string;
  command: string;
  hotKey: string;
  icon: string;
  controlKind: 'button' | 'slider' | 'xy';
  sliderMin: string;
  sliderMax: string;
  sliderStart: string;
  sliderStep: string;
  sliderDirection: 'horizontal' | 'vertical';
  widgetReturn: 'none' | 'center';
  resetOnQueueLoss: boolean;
  resetOnOffline: boolean;
  resetAfterMs: string;
  xyXMin: string;
  xyXMax: string;
  xyXStart: string;
  xyYMin: string;
  xyYMax: string;
  xyYStart: string;
  cooldownMs: string;
  access: ControlButtonAccess;
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
  icon: '',
  controlKind: 'button',
  sliderMin: '-100',
  sliderMax: '100',
  sliderStart: '0',
  sliderStep: '1',
  sliderDirection: 'horizontal',
  widgetReturn: 'none',
  resetOnQueueLoss: false,
  resetOnOffline: true,
  resetAfterMs: '',
  xyXMin: '-100',
  xyXMax: '100',
  xyXStart: '0',
  xyYMin: '-100',
  xyYMax: '100',
  xyYStart: '0',
  cooldownMs: '200',
  access: ControlButtonAccessEnum.QUEUE_TURN,
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

const controlAccessOptions: Array<{ value: ControlButtonAccess; label: string }> = [
  { value: ControlButtonAccessEnum.EVERYONE, label: 'Everyone' },
  { value: ControlButtonAccessEnum.QUEUE_TURN, label: 'Current turn' },
  { value: ControlButtonAccessEnum.MODERATOR, label: 'Moderator' },
  { value: ControlButtonAccessEnum.OWNER, label: 'Owner' },
];

const CONTROL_PRESETS: Array<{ key: ControlPresetKey; label: string }> = [
  { key: 'ptz-pan', label: 'PTZ Pan (Horizontal slider)' },
  { key: 'ptz-tilt', label: 'PTZ Tilt (Vertical slider)' },
  { key: 'drive-speed', label: 'Drive Speed (0..100 slider)' },
  { key: 'gripper', label: 'Gripper (Center slider)' },
  { key: 'arm-xy', label: 'Arm XY Pad' },
];

function applyControlPreset(draft: ControlButtonDraft, preset: ControlPresetKey): ControlButtonDraft {
  const base = {
    ...draft,
    icon: '',
    resetAfterMs: '',
    resetOnQueueLoss: false,
    resetOnOffline: true,
    widgetReturn: 'none' as const,
  };

  switch (preset) {
    case 'ptz-pan':
      return {
        ...base,
        label: base.label || 'Pan',
        command: base.command || 'ptz_pan',
        controlKind: 'slider',
        sliderMin: '-100',
        sliderMax: '100',
        sliderStart: '0',
        sliderStep: '1',
        sliderDirection: 'horizontal',
      };
    case 'ptz-tilt':
      return {
        ...base,
        label: base.label || 'Tilt',
        command: base.command || 'ptz_tilt',
        controlKind: 'slider',
        sliderMin: '-100',
        sliderMax: '100',
        sliderStart: '0',
        sliderStep: '1',
        sliderDirection: 'vertical',
      };
    case 'drive-speed':
      return {
        ...base,
        label: base.label || 'Speed',
        command: base.command || 'set_speed',
        controlKind: 'slider',
        sliderMin: '0',
        sliderMax: '100',
        sliderStart: '50',
        sliderStep: '1',
        sliderDirection: 'horizontal',
      };
    case 'gripper':
      return {
        ...base,
        label: base.label || 'Gripper',
        command: base.command || 'gripper',
        controlKind: 'slider',
        sliderMin: '-100',
        sliderMax: '100',
        sliderStart: '0',
        sliderStep: '1',
        sliderDirection: 'horizontal',
        widgetReturn: 'center',
      };
    case 'arm-xy':
      return {
        ...base,
        label: base.label || 'Arm XY',
        command: base.command || 'arm_xy',
        controlKind: 'xy',
        xyXMin: '-100',
        xyXMax: '100',
        xyXStart: '0',
        xyYMin: '-100',
        xyYMax: '100',
        xyYStart: '0',
      };
  }
}

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

function buildWidgetSpec(draft: ControlButtonDraft): string | undefined {
  if (draft.controlKind === 'button') {
    return draft.icon.trim() || undefined;
  }

  const resetAfterMs = Number(draft.resetAfterMs);
  const ttl = Number.isFinite(resetAfterMs) && resetAfterMs >= 100 ? String(Math.round(resetAfterMs)) : null;

  if (draft.controlKind === 'slider') {
    return [
      'widget:s',
      `min=${Number(draft.sliderMin)}`,
      `max=${Number(draft.sliderMax)}`,
      `start=${Number(draft.sliderStart)}`,
      `step=${Number(draft.sliderStep)}`,
      `dir=${draft.sliderDirection === 'vertical' ? 'v' : 'h'}`,
      `r=${draft.widgetReturn === 'center' ? 'c' : 'n'}`,
      `rq=${draft.resetOnQueueLoss ? 1 : 0}`,
      `ro=${draft.resetOnOffline ? 1 : 0}`,
      ttl ? `ttl=${ttl}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(':');
  }

  return [
    'widget:xy',
    `xn=${Number(draft.xyXMin)}`,
    `xx=${Number(draft.xyXMax)}`,
    `x0=${Number(draft.xyXStart)}`,
    `yn=${Number(draft.xyYMin)}`,
    `yx=${Number(draft.xyYMax)}`,
    `y0=${Number(draft.xyYStart)}`,
    `r=${draft.widgetReturn === 'center' ? 'c' : 'n'}`,
    `rq=${draft.resetOnQueueLoss ? 1 : 0}`,
    `ro=${draft.resetOnOffline ? 1 : 0}`,
    ttl ? `ttl=${ttl}` : null,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(':');
}

function draftFromControl(button: ControlButtonRecord): ControlButtonDraft {
  const draft: ControlButtonDraft = {
    ...DEFAULT_CONTROL_DRAFT,
    label: button.label,
    command: button.command,
    hotKey: button.hotKey ?? '',
    cooldownMs: String(button.cooldownMs),
    access: button.access,
    color: button.color ?? '',
  };

  const icon = button.icon ?? '';
  if (!icon.startsWith('widget:')) {
    draft.icon = icon;
    draft.controlKind = 'button';
    return draft;
  }

  const parts = icon.split(':').map((part) => part.trim()).filter(Boolean);
  const kind = parts[1]?.toLowerCase();
  const kv = new Map<string, string>();
  for (const segment of parts.slice(2)) {
    const idx = segment.indexOf('=');
    if (idx <= 0) continue;
    kv.set(segment.slice(0, idx).toLowerCase(), segment.slice(idx + 1));
  }

  const get = (keys: string[], fallback: string) => {
    for (const key of keys) {
      const found = kv.get(key);
      if (found !== undefined) return found;
    }
    return fallback;
  };

  draft.widgetReturn = get(['r', 'return'], 'n').toLowerCase() === 'c' ? 'center' : 'none';
  draft.resetOnQueueLoss = get(['rq'], '0') === '1';
  draft.resetOnOffline = get(['ro'], '1') !== '0';
  draft.resetAfterMs = get(['ttl'], '');

  if (kind === 's' || kind === 'slider') {
    draft.controlKind = 'slider';
    draft.sliderMin = get(['min'], '-100');
    draft.sliderMax = get(['max'], '100');
    draft.sliderStart = get(['start', 'v0', 'c'], '0');
    draft.sliderStep = get(['step'], '1');
    draft.sliderDirection = get(['dir'], 'h').toLowerCase() === 'v' ? 'vertical' : 'horizontal';
    return draft;
  }

  draft.controlKind = 'xy';
  draft.xyXMin = get(['xn', 'xmin'], '-100');
  draft.xyXMax = get(['xx', 'xmax'], '100');
  draft.xyXStart = get(['x0', 'xstart'], '0');
  draft.xyYMin = get(['yn', 'ymin'], '-100');
  draft.xyYMax = get(['yx', 'ymax'], '100');
  draft.xyYStart = get(['y0', 'ystart'], '0');
  return draft;
}

export default function DashboardPage() {
  const router = useRouter();
  const { accessToken, hasHydrated } = useAuth();

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
  const [controlPreset, setControlPreset] = useState<ControlPresetKey>('ptz-pan');
  const [editingControlId, setEditingControlId] = useState<string | null>(null);
  const [controlEditDraft, setControlEditDraft] = useState<ControlButtonDraft | null>(null);
  const [controlEditPreset, setControlEditPreset] = useState<ControlPresetKey>('ptz-pan');
  const [creatingControl, setCreatingControl] = useState(false);
  const [controlOp, setControlOp] = useState<string | null>(null);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUserRecord[]>([]);
  const [allowlistLoading, setAllowlistLoading] = useState(false);
  const [allowlistUsername, setAllowlistUsername] = useState('');
  const [allowlistOp, setAllowlistOp] = useState<string | null>(null);
  const [ingressCameras, setIngressCameras] = useState<RobotCameraIngress[]>([]);
  const [ingressLoading, setIngressLoading] = useState(false);
  const [ingressOp, setIngressOp] = useState<string | null>(null);
  const [newIngressCameraId, setNewIngressCameraId] = useState('');
  const [newIngressLabel, setNewIngressLabel] = useState('');
  const [newIngressCompatibilityMode, setNewIngressCompatibilityMode] = useState(false);
  const [obsHelpOpen, setObsHelpOpen] = useState(false);
  const previousPendingActionTypesRef = useRef<RemoteActionType[]>([]);
  const previewRefreshInFlightRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

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
  }, [accessToken, hasHydrated, router]);

  useEffect(() => {
    if (!selectedRobot) return;
    setEditForm(formFromRobot(selectedRobot));
    setControlDraft(DEFAULT_CONTROL_DRAFT);
    setEditingControlId(null);
    setControlEditDraft(null);
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
    if (!accessToken || !selectedRobot || editForm.accessMode !== 'ALLOWED_USERS') {
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
  }, [selectedRobot?.id, editForm.accessMode, accessToken]);

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setIngressCameras([]);
      return;
    }

    let active = true;
    setIngressLoading(true);

    api.setToken(accessToken);
    api.getRobotIngressCameras(selectedRobot.id)
      .then((rows) => {
        if (active) {
          setIngressCameras(rows);
        }
      })
      .catch(() => {
        if (active) {
          setIngressCameras([]);
        }
      })
      .finally(() => {
        if (active) {
          setIngressLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedRobot?.id, accessToken]);

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
  }, [pendingActionTypes, selectedRobot?.id, selectedRobot?.status, accessToken]);

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
                    type === 'update_client' ||
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

  const buildRobotRoomHref = useCallback((robot: RobotManaged) => {
    const inviteSuffix =
      robot.accessMode === 'LINK_ONLY' && robot.inviteCode
        ? `?invite=${encodeURIComponent(robot.inviteCode)}`
        : '';
    return `/robot/${robot.slug}${inviteSuffix}`;
  }, []);

  const copyInviteLink = async () => {
    if (!selectedRobot || selectedRobot.accessMode !== 'LINK_ONLY' || !selectedRobot.inviteCode) {
      return;
    }

    const href = buildRobotRoomHref(selectedRobot);
    const fullUrl =
      typeof window !== 'undefined' ? new URL(href, window.location.origin).toString() : href;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setStatus('Invite link copied to clipboard.');
      pushToast('Invite link copied to clipboard.', 'success');
    } catch {
      setError('Clipboard permission denied. Copy invite link manually.');
      pushToast('Clipboard access denied - please copy manually.', 'error');
    }
  };

  const createIngressCamera = async () => {
    if (!accessToken || !selectedRobot) return;
    const cameraId = newIngressCameraId.trim();
    if (!cameraId) {
      pushToast('Camera ID is required.', 'error', 2600);
      return;
    }

    setIngressOp(`create:${cameraId}`);
    try {
      api.setToken(accessToken);
      const created = await api.createRobotIngressCamera(selectedRobot.id, {
        cameraId,
        label: newIngressLabel.trim() || undefined,
        compatibilityMode: newIngressCompatibilityMode,
      });
      setIngressCameras((prev) => {
        const withoutExisting = prev.filter((entry) => entry.ingressId !== created.ingressId);
        return [...withoutExisting, created].sort((a, b) => (a.cameraId ?? '').localeCompare(b.cameraId ?? ''));
      });
      setNewIngressCameraId('');
      setNewIngressLabel('');
      setNewIngressCompatibilityMode(false);
      pushToast('External camera ingress saved.', 'success', 2600);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to create camera ingress.', 'error', 3200);
    } finally {
      setIngressOp(null);
    }
  };

  const deleteIngressCamera = async (ingressId: string) => {
    if (!accessToken || !selectedRobot) return;
    if (!window.confirm('Delete this external camera ingress? OBS publishing to it will stop.')) {
      return;
    }

    setIngressOp(`delete:${ingressId}`);
    try {
      api.setToken(accessToken);
      await api.deleteRobotIngressCamera(selectedRobot.id, ingressId);
      setIngressCameras((prev) => prev.filter((entry) => entry.ingressId !== ingressId));
      pushToast('External camera ingress deleted.', 'success', 2600);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete camera ingress.', 'error', 3200);
    } finally {
      setIngressOp(null);
    }
  };

  const copyIngressEndpoint = async (endpointUrl: string) => {
    try {
      await navigator.clipboard.writeText(endpointUrl);
      pushToast('WHIP endpoint copied.', 'success', 2200);
    } catch {
      pushToast('Clipboard denied. Copy the endpoint manually.', 'error', 2800);
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
      } else if (type === 'update_client') {
        setStatus('Client update queued. The robot will pull the latest git changes and restart itself.');
        pushToast('Client update queued.', 'success', 2800);
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

  const handleCreateControl = async () => {
    if (!accessToken || !selectedRobot) return;

    const label = controlDraft.label.trim();
    const command = controlDraft.command.trim();
    if (!label || !command) {
      pushToast('Label and command are required for a control button.', 'error', 2600);
      return;
    }

    setCreatingControl(true);
    setError(null);
    try {
      api.setToken(accessToken);
      const next = await api.createControl(selectedRobot.id, {
        label,
        command,
        hotKey: controlDraft.hotKey.trim() || undefined,
        icon: buildWidgetSpec(controlDraft),
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

  const startEditControl = (button: ControlButtonRecord) => {
    setEditingControlId(button.id);
    const draft = draftFromControl(button);
    setControlEditDraft(draft);
    if (draft.controlKind === 'xy') {
      setControlEditPreset('arm-xy');
      return;
    }
    if (draft.controlKind === 'slider' && draft.sliderDirection === 'vertical') {
      setControlEditPreset('ptz-tilt');
      return;
    }
    if (draft.command === 'set_speed') {
      setControlEditPreset('drive-speed');
      return;
    }
    if (draft.command === 'gripper') {
      setControlEditPreset('gripper');
      return;
    }
    setControlEditPreset('ptz-pan');
  };

  const saveControlEdit = async () => {
    if (!accessToken || !editingControlId || !controlEditDraft) return;

    const label = controlEditDraft.label.trim();
    const command = controlEditDraft.command.trim();
    if (!label || !command) {
      pushToast('Label and command are required for a control button.', 'error', 2600);
      return;
    }

    setControlOp(editingControlId);
    try {
      api.setToken(accessToken);
      const updated = await api.updateControl(editingControlId, {
        label,
        command,
        hotKey: controlEditDraft.hotKey.trim() || undefined,
        icon: buildWidgetSpec(controlEditDraft),
        cooldownMs: Number(controlEditDraft.cooldownMs),
        access: controlEditDraft.access,
        color: controlEditDraft.color.trim() || null,
      });
      setControlButtons((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingControlId(null);
      setControlEditDraft(null);
      pushToast('Control button updated.', 'success', 2200);
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
    if (!moved) {
      return;
    }
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

  if (!hasHydrated || !accessToken) return null;

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
                        href={buildRobotRoomHref(selectedRobot)}
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
                          streamConfig={selectedRobot.metadata?.stream}
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
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Robot Name
                      </label>
                      <input
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                        value={editForm.name}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Visibility
                      </label>
                      <Select
                        className="bg-[var(--background)]"
                        value={editForm.visibility}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, visibility: event.target.value as RobotFormState['visibility'] }))
                        }
                      >
                        <option value="PUBLIC">Public</option>
                        <option value="UNLISTED">Unlisted (link only)</option>
                        <option value="PRIVATE">Private</option>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Room Access
                      </label>
                      <Select
                        className="bg-[var(--background)]"
                        value={editForm.accessMode}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, accessMode: event.target.value as RobotFormState['accessMode'] }))
                        }
                      >
                        <option value="OPEN">Open</option>
                        <option value="PASSWORD">Password</option>
                        <option value="LINK_ONLY">Link only</option>
                        <option value="ALLOWED_USERS">Allow list only</option>
                      </Select>
                    </div>
                    {editForm.accessMode === 'PASSWORD' ? (
                      <div className="space-y-1">
                        <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                          Room Password
                        </label>
                        <input
                          type="password"
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                          value={editForm.accessPassword}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, accessPassword: event.target.value }))
                          }
                          placeholder="Room password"
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Queue Mode
                      </label>
                      <Select
                        className="bg-[var(--background)]"
                        value={editForm.queueMode}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, queueMode: event.target.value as RobotFormState['queueMode'] }))
                        }
                      >
                        <option value="FIRST_COME">First come, first served</option>
                        <option value="VOTING">Voting</option>
                        <option value="DISABLED">Disabled</option>
                      </Select>
                    </div>

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

                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Target Bitrate (kbps)
                      </label>
                      <input
                        type="number"
                        min={150}
                        max={3000}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                        value={editForm.targetBitrateKbps}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, targetBitrateKbps: event.target.value }))
                        }
                        placeholder="e.g. 1800"
                      />
                    </div>

                    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                          External Camera Ingress (OBS / WHIP)
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setObsHelpOpen(true)}
                            className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]"
                          >
                            OBS setup
                          </button>
                          <span className="text-[10px] text-[var(--muted-foreground)]">
                            {ingressLoading ? 'Loading...' : `${ingressCameras.length} configured`}
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                        <input
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          placeholder="camera id (e.g. obs-front)"
                          value={newIngressCameraId}
                          onChange={(event) => setNewIngressCameraId(event.target.value)}
                        />
                        <input
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          placeholder="label (optional)"
                          value={newIngressLabel}
                          onChange={(event) => setNewIngressLabel(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={createIngressCamera}
                          disabled={Boolean(ingressOp)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-60"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </button>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                        <input
                          type="checkbox"
                          checked={newIngressCompatibilityMode}
                          onChange={(event) => setNewIngressCompatibilityMode(event.target.checked)}
                          className="h-3.5 w-3.5"
                        />
                        Compatibility mode (enable transcoding). Leave OFF for lowest latency.
                      </label>

                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        Use the generated WHIP endpoint in OBS. The camera appears in the viewer only while it is live.
                      </p>

                      <div className="space-y-2">
                        {ingressCameras.length === 0 ? (
                          <p className="text-xs text-[var(--muted-foreground)]">No external camera ingress configured yet.</p>
                        ) : (
                          ingressCameras.map((entry) => {
                            const deleting = ingressOp === `delete:${entry.ingressId}`;
                            return (
                              <div
                                key={entry.ingressId}
                                className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold">
                                      {entry.cameraId ?? 'default'}
                                    </p>
                                    <p className="text-[11px] text-[var(--muted-foreground)]">
                                      {entry.participantName ?? entry.participantIdentity ?? 'camera ingress'}
                                    </p>
                                  </div>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                      entry.isLive
                                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                        : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]'
                                    }`}
                                  >
                                    {entry.isLive ? 'LIVE' : 'Offline'}
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void copyIngressEndpoint(entry.endpointUrl)}
                                    className="inline-flex items-center gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Copy WHIP URL
                                  </button>
                                  {entry.cameraId ? (
                                    <button
                                      type="button"
                                      onClick={() => void deleteIngressCamera(entry.ingressId)}
                                      disabled={Boolean(ingressOp)}
                                      className="inline-flex items-center gap-2 rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 disabled:opacity-60"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      {deleting ? 'Deleting...' : 'Delete'}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {obsHelpOpen ? (
                      <div
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
                        onClick={() => setObsHelpOpen(false)}
                      >
                        <div
                          className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 className="text-lg font-bold">OBS Low-Latency Setup</h3>
                            <button
                              type="button"
                              onClick={() => setObsHelpOpen(false)}
                              className="rounded border border-[var(--border)] p-1.5"
                              aria-label="Close OBS help"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="space-y-3 text-sm">
                            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                              30s delay is usually OBS buffering/transcoding settings, not WHIP itself.
                            </p>

                            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                              <p className="font-semibold">Recommended OBS output values</p>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted-foreground)]">
                                <li>Encoder: H.264 (NVENC/VAAPI/QSV or x264 veryfast)</li>
                                <li>Keyframe interval: 1s (max 2s)</li>
                                <li>B-frames: 0</li>
                                <li>Rate control: CBR</li>
                                <li>Bitrate: 1200-3500 kbps (depending on resolution)</li>
                                <li>Disable any Stream Delay in OBS</li>
                                <li>Advanced Network: Low Latency Mode ON</li>
                              </ul>
                            </div>

                            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                              <p className="font-semibold">In this dashboard</p>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted-foreground)]">
                                <li>Keep Compatibility mode OFF for minimum latency.</li>
                                <li>Use Compatibility mode only if the stream fails to appear.</li>
                                <li>Viewer only shows the camera when OBS is actively publishing.</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Max Turn Time (ms)
                      </label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                        value={editForm.maxTurnTime}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, maxTurnTime: Number(event.target.value) }))
                        }
                        placeholder="e.g. 60000"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      Description
                    </label>
                    <textarea
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      rows={3}
                      value={editForm.description}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Describe your robot and how viewers should use it"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      Tags
                    </label>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      value={editForm.tags}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, tags: event.target.value }))}
                      placeholder="comma separated, e.g. rover, camera, claw"
                    />
                  </div>

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

                  {selectedRobot.accessMode === 'LINK_ONLY' && selectedRobot.inviteCode && (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                      <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Invite Link</p>
                      <code className="block break-all text-xs text-[var(--foreground)]">
                        {buildRobotRoomHref(selectedRobot)}
                      </code>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={copyInviteLink}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy invite link
                        </button>
                        <a
                          href={buildRobotRoomHref(selectedRobot)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open invite link
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Remote Operations (Pi)</p>
                    <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                      Run maintenance actions on the robot client without SSH. Commands are queued and picked up on the next poll cycle.
                    </p>
                    {telemetry.latest && (
                      <div className="mb-3 rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                        <p>
                          Client build: <span className="font-semibold text-[var(--foreground)]">{formatClientBuild(telemetry.latest)}</span>
                        </p>
                        {telemetry.latest.pythonVersion && (
                          <p className="mt-1">
                            Python: <span className="font-semibold text-[var(--foreground)]">{telemetry.latest.pythonVersion}</span>
                          </p>
                        )}
                      </div>
                    )}
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
                        onClick={() => runRobotAction('update_client')}
                        disabled={opLoading !== null || pendingActionTypes.includes('update_client')}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-60"
                      >
                        {opLoading === 'update_client'
                          ? 'Queueing...'
                          : pendingActionTypes.includes('update_client')
                            ? 'Queued, waiting for pickup'
                            : 'Update Client'}
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

                  {editForm.accessMode === 'ALLOWED_USERS' && (
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

                    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select
                        className="bg-[var(--card)]"
                        value={controlPreset}
                        onChange={(event) => setControlPreset(event.target.value as ControlPresetKey)}
                      >
                        {CONTROL_PRESETS.map((preset) => (
                          <option key={preset.key} value={preset.key}>
                            Preset: {preset.label}
                          </option>
                        ))}
                      </Select>
                      <button
                        type="button"
                        onClick={() => setControlDraft((prev) => applyControlPreset(prev, controlPreset))}
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                      >
                        Apply preset
                      </button>
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Label"
                        value={controlDraft.label}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, label: event.target.value }))
                        }
                      />
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Command"
                        value={controlDraft.command}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, command: event.target.value }))
                        }
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
                      <Select
                        className="bg-[var(--card)]"
                        value={controlDraft.controlKind}
                        onChange={(event) =>
                          setControlDraft((prev) => ({
                            ...prev,
                            controlKind: event.target.value as ControlButtonDraft['controlKind'],
                          }))
                        }
                      >
                        <option value="button">Type: Button</option>
                        <option value="slider">Type: Slider</option>
                        <option value="xy">Type: XY Pad</option>
                      </Select>
                      {controlDraft.controlKind === 'button' ? (
                        <input
                          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                          placeholder="Icon/emoji (optional)"
                          value={controlDraft.icon}
                          onChange={(event) =>
                            setControlDraft((prev) => ({ ...prev, icon: event.target.value }))
                          }
                        />
                      ) : controlDraft.controlKind === 'slider' ? (
                        <>
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Slider min"
                            value={controlDraft.sliderMin}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, sliderMin: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Slider max"
                            value={controlDraft.sliderMax}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, sliderMax: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Start value"
                            value={controlDraft.sliderStart}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, sliderStart: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Step"
                            value={controlDraft.sliderStep}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, sliderStep: event.target.value }))}
                          />
                          <Select
                            className="bg-[var(--card)]"
                            value={controlDraft.sliderDirection}
                            onChange={(event) =>
                              setControlDraft((prev) => ({
                                ...prev,
                                sliderDirection: event.target.value as ControlButtonDraft['sliderDirection'],
                              }))
                            }
                          >
                            <option value="horizontal">Slider: Horizontal</option>
                            <option value="vertical">Slider: Vertical</option>
                          </Select>
                          <Select
                            className="bg-[var(--card)]"
                            value={controlDraft.widgetReturn}
                            onChange={(event) =>
                              setControlDraft((prev) => ({
                                ...prev,
                                widgetReturn: event.target.value as ControlButtonDraft['widgetReturn'],
                              }))
                            }
                          >
                            <option value="none">Release: Keep value</option>
                            <option value="center">Release: Return to start</option>
                          </Select>
                        </>
                      ) : (
                        <>
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="X min"
                            value={controlDraft.xyXMin}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, xyXMin: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="X max"
                            value={controlDraft.xyXMax}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, xyXMax: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="X start"
                            value={controlDraft.xyXStart}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, xyXStart: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Y min"
                            value={controlDraft.xyYMin}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, xyYMin: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Y max"
                            value={controlDraft.xyYMax}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, xyYMax: event.target.value }))}
                          />
                          <input
                            type="number"
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                            placeholder="Y start"
                            value={controlDraft.xyYStart}
                            onChange={(event) => setControlDraft((prev) => ({ ...prev, xyYStart: event.target.value }))}
                          />
                        </>
                      )}
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
                      <Select
                        className="bg-[var(--card)]"
                        value={controlDraft.access}
                        onChange={(event) =>
                          setControlDraft((prev) => ({
                            ...prev,
                            access: event.target.value as ControlButtonAccess,
                          }))
                        }
                      >
                        {controlAccessOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            Access: {option.label}
                          </option>
                        ))}
                      </Select>
                      <input
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Color (optional, e.g. #22c55e)"
                        value={controlDraft.color}
                        onChange={(event) =>
                          setControlDraft((prev) => ({ ...prev, color: event.target.value }))
                        }
                      />
                      <input
                        type="number"
                        min={100}
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                        placeholder="Auto reset after ms (optional)"
                        value={controlDraft.resetAfterMs}
                        onChange={(event) => setControlDraft((prev) => ({ ...prev, resetAfterMs: event.target.value }))}
                      />
                      <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                        <input
                          type="checkbox"
                          checked={controlDraft.resetOnQueueLoss}
                          onChange={(event) => setControlDraft((prev) => ({ ...prev, resetOnQueueLoss: event.target.checked }))}
                        />
                        Reset on queue loss
                      </label>
                      <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={controlDraft.resetOnOffline}
                          onChange={(event) => setControlDraft((prev) => ({ ...prev, resetOnOffline: event.target.checked }))}
                        />
                        Reset when robot goes offline/restarts
                      </label>
                      <div className="sm:col-span-2">
                        <ControlBuilderPreview draft={controlDraft} />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleCreateControl();
                          }}
                          disabled={creatingControl}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
                        >
                          <Plus className="h-4 w-4" />
                          {creatingControl ? 'Creating...' : 'Add control button'}
                        </button>
                      </div>
                    </div>

                    {editingControlId && controlEditDraft ? (
                      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Edit control button</p>
                            <p className="text-xs text-[var(--muted-foreground)]">Update label, command, hotkey, cooldown, access, and color.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingControlId(null);
                              setControlEditDraft(null);
                            }}
                            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)]"
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Select
                            className="bg-[var(--background)]"
                            value={controlEditPreset}
                            onChange={(event) => setControlEditPreset(event.target.value as ControlPresetKey)}
                          >
                            {CONTROL_PRESETS.map((preset) => (
                              <option key={preset.key} value={preset.key}>
                                Preset: {preset.label}
                              </option>
                            ))}
                          </Select>
                          <button
                            type="button"
                            onClick={() =>
                              setControlEditDraft((prev) => (prev ? applyControlPreset(prev, controlEditPreset) : prev))
                            }
                            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                          >
                            Apply preset
                          </button>
                          <input
                            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                            placeholder="Label"
                            value={controlEditDraft.label}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, label: event.target.value } : prev))}
                          />
                          <input
                            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                            placeholder="Command"
                            value={controlEditDraft.command}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, command: event.target.value } : prev))}
                          />
                          <input
                            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                            placeholder="Hotkey (optional)"
                            maxLength={8}
                            value={controlEditDraft.hotKey}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, hotKey: event.target.value } : prev))}
                          />
                          <Select
                            className="bg-[var(--background)]"
                            value={controlEditDraft.controlKind}
                            onChange={(event) =>
                              setControlEditDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      controlKind: event.target.value as ControlButtonDraft['controlKind'],
                                    }
                                  : prev,
                              )
                            }
                          >
                            <option value="button">Type: Button</option>
                            <option value="slider">Type: Slider</option>
                            <option value="xy">Type: XY Pad</option>
                          </Select>
                          {controlEditDraft.controlKind === 'button' ? (
                            <input
                              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                              placeholder="Icon/emoji (optional)"
                              value={controlEditDraft.icon}
                              onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, icon: event.target.value } : prev))}
                            />
                          ) : controlEditDraft.controlKind === 'slider' ? (
                            <>
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Slider min"
                                value={controlEditDraft.sliderMin}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, sliderMin: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Slider max"
                                value={controlEditDraft.sliderMax}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, sliderMax: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Start value"
                                value={controlEditDraft.sliderStart}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, sliderStart: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Step"
                                value={controlEditDraft.sliderStep}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, sliderStep: event.target.value } : prev))}
                              />
                              <Select
                                className="bg-[var(--background)]"
                                value={controlEditDraft.sliderDirection}
                                onChange={(event) =>
                                  setControlEditDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          sliderDirection: event.target.value as ControlButtonDraft['sliderDirection'],
                                        }
                                      : prev,
                                  )
                                }
                              >
                                <option value="horizontal">Slider: Horizontal</option>
                                <option value="vertical">Slider: Vertical</option>
                              </Select>
                              <Select
                                className="bg-[var(--background)]"
                                value={controlEditDraft.widgetReturn}
                                onChange={(event) =>
                                  setControlEditDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          widgetReturn: event.target.value as ControlButtonDraft['widgetReturn'],
                                        }
                                      : prev,
                                  )
                                }
                              >
                                <option value="none">Release: Keep value</option>
                                <option value="center">Release: Return to start</option>
                              </Select>
                            </>
                          ) : (
                            <>
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="X min"
                                value={controlEditDraft.xyXMin}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, xyXMin: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="X max"
                                value={controlEditDraft.xyXMax}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, xyXMax: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="X start"
                                value={controlEditDraft.xyXStart}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, xyXStart: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Y min"
                                value={controlEditDraft.xyYMin}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, xyYMin: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Y max"
                                value={controlEditDraft.xyYMax}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, xyYMax: event.target.value } : prev))}
                              />
                              <input
                                type="number"
                                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                                placeholder="Y start"
                                value={controlEditDraft.xyYStart}
                                onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, xyYStart: event.target.value } : prev))}
                              />
                            </>
                          )}
                          <input
                            type="number"
                            min={50}
                            max={10000}
                            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                            placeholder="Cooldown ms"
                            value={controlEditDraft.cooldownMs}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, cooldownMs: event.target.value } : prev))}
                          />
                          <Select
                            className="bg-[var(--background)]"
                            value={controlEditDraft.access}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, access: event.target.value as ControlButtonAccess } : prev))}
                          >
                            {controlAccessOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                Access: {option.label}
                              </option>
                            ))}
                          </Select>
                          <input
                            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                            placeholder="Color (optional, e.g. #22c55e)"
                            value={controlEditDraft.color}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, color: event.target.value } : prev))}
                          />
                          <input
                            type="number"
                            min={100}
                            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                            placeholder="Auto reset after ms (optional)"
                            value={controlEditDraft.resetAfterMs}
                            onChange={(event) => setControlEditDraft((prev) => (prev ? { ...prev, resetAfterMs: event.target.value } : prev))}
                          />
                          <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                            <input
                              type="checkbox"
                              checked={controlEditDraft.resetOnQueueLoss}
                              onChange={(event) =>
                                setControlEditDraft((prev) => (prev ? { ...prev, resetOnQueueLoss: event.target.checked } : prev))
                              }
                            />
                            Reset on queue loss
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] sm:col-span-2">
                            <input
                              type="checkbox"
                              checked={controlEditDraft.resetOnOffline}
                              onChange={(event) =>
                                setControlEditDraft((prev) => (prev ? { ...prev, resetOnOffline: event.target.checked } : prev))
                              }
                            />
                            Reset when robot goes offline/restarts
                          </label>
                          <div className="sm:col-span-2">
                            <ControlBuilderPreview draft={controlEditDraft} />
                          </div>
                        </div>
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => void saveControlEdit()}
                            disabled={controlOp === editingControlId}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-medium text-emerald-300 disabled:opacity-60"
                          >
                            {controlOp === editingControlId ? 'Saving...' : 'Save control button'}
                          </button>
                        </div>
                      </div>
                    ) : null}

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
                                  {button.icon?.startsWith('widget:') ? ` · Widget: ${button.icon}` : ''}
                                  {button.color ? ` · Color: ${button.color}` : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditControl(button)}
                                  disabled={controlOp === button.id}
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                                >
                                  Edit
                                </button>
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
                          <div className="rounded border border-[var(--border)] px-2 py-1.5 sm:col-span-2">
                            <p className="text-[var(--muted-foreground)]">Client build</p>
                            <p className="font-semibold">{formatClientBuild(telemetry.latest)}</p>
                          </div>
                          <div className="rounded border border-[var(--border)] px-2 py-1.5 sm:col-span-2">
                            <p className="text-[var(--muted-foreground)]">Python</p>
                            <p className="font-semibold">{telemetry.latest.pythonVersion ?? '-'}</p>
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

function ControlBuilderPreview({ draft }: { draft: ControlButtonDraft }) {
  const [sliderValue, setSliderValue] = useState<number>(() => Number(draft.sliderStart) || 0);
  const [xyValue, setXyValue] = useState<{ x: number; y: number }>(() => ({
    x: Number(draft.xyXStart) || 0,
    y: Number(draft.xyYStart) || 0,
  }));

  useEffect(() => {
    setSliderValue(Number(draft.sliderStart) || 0);
  }, [draft.sliderStart, draft.controlKind]);

  useEffect(() => {
    setXyValue({ x: Number(draft.xyXStart) || 0, y: Number(draft.xyYStart) || 0 });
  }, [draft.xyXStart, draft.xyYStart, draft.controlKind]);

  const sliderMin = Number(draft.sliderMin);
  const sliderMax = Number(draft.sliderMax);
  const sliderStep = Number(draft.sliderStep) || 1;

  const xMin = Number(draft.xyXMin);
  const xMax = Number(draft.xyXMax);
  const yMin = Number(draft.xyYMin);
  const yMax = Number(draft.xyYMax);

  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const xPercent = xRange > 0 ? ((xyValue.x - xMin) / xRange) * 100 : 50;
  const yPercent = yRange > 0 ? ((xyValue.y - yMin) / yRange) * 100 : 50;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Live Preview</p>

      {draft.controlKind === 'button' ? (
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm font-semibold"
          style={draft.color.trim() ? { borderColor: draft.color.trim(), color: draft.color.trim() } : undefined}
        >
          {draft.icon.trim() ? <span>{draft.icon.trim()}</span> : null}
          {draft.label.trim() || 'Button'}
        </button>
      ) : draft.controlKind === 'slider' ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={Number.isFinite(sliderMin) ? sliderMin : -100}
            max={Number.isFinite(sliderMax) ? sliderMax : 100}
            step={sliderStep}
            value={sliderValue}
            onChange={(event) => setSliderValue(Number(event.target.value))}
            className={`accent-[var(--primary)] ${
              draft.sliderDirection === 'vertical'
                ? 'h-24 w-6 [writing-mode:vertical-lr] [-webkit-appearance:slider-vertical]'
                : 'w-full'
            }`}
          />
          <div className="text-xs text-[var(--muted-foreground)]">
            <p className="font-semibold text-[var(--foreground)]">{draft.label.trim() || 'Slider'}</p>
            <p>{sliderValue.toFixed(0)}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div
            className="relative h-24 w-24 rounded border border-[var(--border)] bg-[var(--background)]"
            onPointerDown={(event) => {
              const target = event.currentTarget;
              const rect = target.getBoundingClientRect();
              const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
              const nextX = xMin + nx * (xMax - xMin);
              const nextY = yMax - ny * (yMax - yMin);
              setXyValue({ x: nextX, y: nextY });
            }}
          >
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[var(--border)]" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-[var(--border)]" />
            <div
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]"
              style={{ left: `${xPercent}%`, top: `${100 - yPercent}%` }}
            />
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            <p className="font-semibold text-[var(--foreground)]">{draft.label.trim() || 'XY Pad'}</p>
            <p>x: {xyValue.x.toFixed(0)}</p>
            <p>y: {xyValue.y.toFixed(0)}</p>
          </div>
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

function formatClientBuild(telemetry: RobotTelemetryPoint | null | undefined) {
  if (!telemetry) return '-';

  const parts: string[] = [];
  if (telemetry.clientVersion) {
    parts.push(`v${telemetry.clientVersion}`);
  }
  if (telemetry.gitBranch) {
    parts.push(telemetry.gitBranch);
  }
  if (telemetry.gitCommit) {
    parts.push(telemetry.gitCommit);
  }
  if (telemetry.gitDirty) {
    parts.push('dirty');
  }

  return parts.length > 0 ? parts.join(' • ') : '-';
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
