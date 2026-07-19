'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  type RobotCameraIngress,
  type RobotManaged,
  type RobotWebhookRecord,
} from '@/lib/api';
import { useAuth } from '@/lib/store';
import { useDashboardStore } from '@/lib/dashboard-store';
import { pushToast } from '@/lib/toast';
import { usePreferences } from '@/lib/preferences';
import {
  type RemoteActionType,
  type RoomMode,
  DASHBOARD_SECTIONS,
  detectRoomMode,
  toUpdatePayload,
  validateRobotFormSchedule,
  formFromRobot,
} from '@/components/dashboard/types';
import { useDashboardControls } from './use-dashboard-controls';
import { useDashboardRobotPolling } from './use-dashboard-robot-polling';
import { useDashboardThumbnail } from './use-dashboard-thumbnail';

function preserveRobotSecrets(previous: RobotManaged, updated: RobotManaged): RobotManaged {
  return {
    ...updated,
    claimToken: updated.claimToken ?? previous.claimToken,
    streamKey: updated.streamKey ?? previous.streamKey,
  };
}

export function useDashboardPage() {
  const router = useRouter();
  const { accessToken, hasHydrated, username } = useAuth();
  const dashboardMaskToken = usePreferences((state) => state.dashboardMaskToken);
  const {
    createForm,
    setCreateForm,
    resetCreateForm,
    selectedId,
    setSelectedId,
    editForm,
    setEditForm,
    showToken,
    setShowToken,
    syncShowTokenWithMask,
    controlDraft,
    setControlDraft,
    resetControlDraft,
    controlPreset,
    setControlPreset,
    editingControlId,
    setEditingControlId,
    controlEditDraft,
    setControlEditDraft,
    clearControlEditDraft,
    controlEditPreset,
    setControlEditPreset,
    allowlistUsername,
    setAllowlistUsername,
    resetAllowlistUsername,
    newIngressCameraId,
    setNewIngressCameraId,
    newIngressLabel,
    setNewIngressLabel,
    newIngressCompatibilityMode,
    setNewIngressCompatibilityMode,
    resetIngressDraft,
    obsHelpOpen,
    setObsHelpOpen,
    activeSectionId,
    setActiveSectionId,
  } = useDashboardStore();

  const [robots, setRobots] = useState<RobotManaged[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selectedRobot = useMemo(
    () => robots.find((robot) => robot.id === selectedId) ?? null,
    [robots, selectedId],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratingInvite, setRegeneratingInvite] = useState(false);
  const [opLoading, setOpLoading] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [preview, setPreview] = useState<{ token: string; url: string } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const selectedRobotId = selectedRobot?.id ?? null;
  const selectedRobotStatus = selectedRobot?.status ?? null;
  const [ingressCameras, setIngressCameras] = useState<RobotCameraIngress[]>([]);
  const [ingressLoading, setIngressLoading] = useState(false);
  const [ingressOp, setIngressOp] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<RobotWebhookRecord[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookOp, setWebhookOp] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([
    'robot.online',
    'robot.offline',
    'session.started',
    'session.ended',
  ]);
  const [webhookActive, setWebhookActive] = useState(true);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);
  const previousPendingActionTypesRef = useRef<RemoteActionType[]>([]);
  const previewRefreshInFlightRef = useRef(false);
  const editFormRef = useRef<HTMLFormElement>(null);
  const {
    pendingActionTypes,
    setPendingActionTypes,
    diagLogs,
    setDiagLogs,
    telemetry,
    onboarding,
  } = useDashboardRobotPolling({ accessToken, robotId: selectedRobotId });
  const controls = useDashboardControls({
    accessToken,
    selectedRobotId,
    roomMode: editForm.roomMode,
    controlDraft,
    resetControlDraft,
    editingControlId,
    setEditingControlId,
    controlEditDraft,
    setControlEditDraft,
    clearControlEditDraft,
    setControlEditPreset,
    allowlistUsername,
    resetAllowlistUsername,
    setError,
  });

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
        const data = await api.robots.getMyRobots();
        setRobots(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load robots';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [accessToken, hasHydrated, router]);

  useEffect(() => {
    syncShowTokenWithMask(dashboardMaskToken);
  }, [dashboardMaskToken, syncShowTokenWithMask]);

  useEffect(() => {
    if (!selectedRobot) return;
    setEditForm(formFromRobot(selectedRobot));
    resetControlDraft();
    setEditingControlId(null);
    clearControlEditDraft();
  }, [clearControlEditDraft, resetControlDraft, selectedRobot, setEditForm, setEditingControlId]);

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setIngressCameras([]);
      return;
    }

    let active = true;
    setIngressLoading(true);

    api.setToken(accessToken);
    api.robots
      .getRobotIngressCameras(selectedRobot.id)
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
  }, [selectedRobot, accessToken]);

  useEffect(() => {
    if (!accessToken || !selectedRobot) {
      setWebhooks([]);
      setCreatedWebhookSecret(null);
      return;
    }

    let active = true;
    setWebhooksLoading(true);

    api.setToken(accessToken);
    api.robots
      .listRobotWebhooks(selectedRobot.id)
      .then((rows) => {
        if (active) {
          setWebhooks(rows);
        }
      })
      .catch(() => {
        if (active) {
          setWebhooks([]);
        }
      })
      .finally(() => {
        if (active) {
          setWebhooksLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedRobot, accessToken]);

  useEffect(() => {
    if (!selectedRobot) {
      return;
    }

    const sectionElements = DASHBOARD_SECTIONS.map((entry) =>
      document.getElementById(entry.id),
    ).filter((element): element is HTMLElement => Boolean(element));

    if (sectionElements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActiveSectionId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: [0.15, 0.35, 0.6],
      },
    );

    for (const section of sectionElements) {
      observer.observe(section);
    }

    setActiveSectionId('section-settings');
    return () => observer.disconnect();
  }, [selectedRobot, setActiveSectionId]);

  const refreshPreview = useCallback(
    async (forceRemount = false) => {
      if (!selectedRobotId || !accessToken || selectedRobotStatus !== 'ONLINE') {
        setPreview(null);
        return;
      }
      if (previewRefreshInFlightRef.current) {
        return;
      }

      previewRefreshInFlightRef.current = true;
      try {
        api.setToken(accessToken);
        const { token, livekitUrl } = await api.robots.getViewerToken(selectedRobotId, false);
        setPreview({ token, url: process.env.NEXT_PUBLIC_LIVEKIT_URL ?? livekitUrl });
        if (forceRemount) {
          setPreviewVersion((value) => value + 1);
        }
      } catch {
        // Keep the current preview alive on transient refresh failures.
      } finally {
        previewRefreshInFlightRef.current = false;
      }
    },
    [accessToken, selectedRobotId, selectedRobotStatus],
  );

  useEffect(() => {
    setPreview(null);
    setPreviewVersion(0);
  }, [selectedRobotId]);

  useEffect(() => {
    void refreshPreview(false);
  }, [refreshPreview]);

  useEffect(() => {
    const previous = previousPendingActionTypesRef.current;
    const restartVideoWasPending = previous.includes('restart_video');
    const restartVideoIsPending = pendingActionTypes.includes('restart_video');
    previousPendingActionTypesRef.current = pendingActionTypes;

    if (
      !restartVideoWasPending ||
      restartVideoIsPending ||
      !selectedRobotId ||
      !accessToken ||
      selectedRobotStatus !== 'ONLINE'
    ) {
      return;
    }

    void refreshPreview(true);
  }, [pendingActionTypes, selectedRobotId, selectedRobotStatus, accessToken, refreshPreview]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    const scheduleError = validateRobotFormSchedule(createForm);
    if (scheduleError) {
      setError(scheduleError);
      pushToast(scheduleError, 'error', 3200);
      return;
    }

    setCreating(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const created = await api.robots.createRobot(toUpdatePayload(createForm));
      const next = [created, ...robots];
      setRobots(next);
      setSelectedId(created.id);
      setEditForm(formFromRobot(created));
      resetCreateForm();
      setStatus('Robot created. You can now copy the claim token into your client config.');
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

    const scheduleError = validateRobotFormSchedule(editForm);
    if (scheduleError) {
      setError(scheduleError);
      pushToast(scheduleError, 'error', 3200);
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const previousBitrate = selectedRobot.metadata?.stream?.targetBitrateKbps ?? null;
      const updated = await api.robots.updateRobot(selectedRobot.id, toUpdatePayload(editForm));
      setRobots((prev) =>
        prev.map((robot) =>
          robot.id === updated.id ? preserveRobotSecrets(robot, updated) : robot,
        ),
      );
      setStatus('Robot settings saved.');

      const nextBitrate = updated.metadata?.stream?.targetBitrateKbps ?? null;
      if (previousBitrate !== nextBitrate) {
        await api.robots.enqueueRobotAction(updated.id, { type: 'restart_video' });
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
      await api.robots.deleteRobot(selectedRobot.id);
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
      const nextToken = await api.robots.regenerateRobotToken(selectedRobot.id);
      setRobots((prev) =>
        prev.map((robot) =>
          robot.id === selectedRobot.id ? { ...robot, claimToken: nextToken.claimToken } : robot,
        ),
      );
      setStatus('Claim token regenerated. Update config.yaml before restarting the client.');
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
    if (!selectedRobot?.claimToken) {
      setError('Generate a new claim token before copying it.');
      return;
    }
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
    const effectiveMode = robot.accessMode === 'LINK_ONLY' ? 'LINK_ONLY' : detectRoomMode(robot);
    const inviteSuffix =
      effectiveMode === 'LINK_ONLY' && robot.inviteCode
        ? `?invite=${encodeURIComponent(robot.inviteCode)}`
        : '';
    return `/robot/${robot.owner.username}/${robot.slug}${inviteSuffix}`;
  }, []);

  const buildSelectedRobotRoomHref = useCallback(
    (roomMode: RoomMode = editForm.roomMode) => {
      if (!selectedRobot) {
        return '#';
      }

      const inviteSuffix =
        roomMode === 'LINK_ONLY' && selectedRobot.inviteCode
          ? `?invite=${encodeURIComponent(selectedRobot.inviteCode)}`
          : '';
      return `/robot/${selectedRobot.owner.username}/${selectedRobot.slug}${inviteSuffix}`;
    },
    [editForm.roomMode, selectedRobot],
  );

  const buildSelectedRobotEmbedHref = useCallback(() => {
    if (!selectedRobot) {
      return '#';
    }
    return `/embed/${selectedRobot.owner.username}/${selectedRobot.slug}`;
  }, [selectedRobot]);

  const applyUpdatedRobot = useCallback(
    (updated: RobotManaged) => {
      setRobots((prev) =>
        prev.map((robot) =>
          robot.id === updated.id ? preserveRobotSecrets(robot, updated) : robot,
        ),
      );
      setEditForm(formFromRobot(updated));
    },
    [setEditForm],
  );

  const {
    thumbnailInputRef,
    previewContainerRef,
    thumbnailOp,
    handleThumbnailFileChange,
    capturePreviewThumbnail,
    removeThumbnail,
  } = useDashboardThumbnail({
    accessToken,
    selectedRobot,
    previewAvailable: Boolean(preview),
    onRobotUpdated: applyUpdatedRobot,
    setError,
    setStatus,
  });

  useEffect(() => {
    if (
      !accessToken ||
      !selectedRobot ||
      editForm.roomMode !== 'LINK_ONLY' ||
      selectedRobot.inviteCode
    ) {
      return;
    }

    let active = true;
    api.setToken(accessToken);
    api.robots
      .ensureRobotInviteCode(selectedRobot.id)
      .then((next) => {
        if (!active) {
          return;
        }
        setRobots((prev) =>
          prev.map((robot) =>
            robot.id === selectedRobot.id ? { ...robot, inviteCode: next.inviteCode } : robot,
          ),
        );
      })
      .catch(() => {
        // Keep UI usable; save will still fail loudly if invite generation is broken.
      });

    return () => {
      active = false;
    };
  }, [accessToken, editForm.roomMode, selectedRobot]);

  const regenerateInviteCode = async () => {
    if (!accessToken || !selectedRobot || editForm.roomMode !== 'LINK_ONLY') {
      return;
    }

    if (
      !window.confirm(
        'Generate a new invite code? Previously shared invite links will stop working immediately.',
      )
    ) {
      return;
    }

    setRegeneratingInvite(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const next = await api.robots.regenerateRobotInviteCode(selectedRobot.id);
      setRobots((prev) =>
        prev.map((robot) =>
          robot.id === selectedRobot.id ? { ...robot, inviteCode: next.inviteCode } : robot,
        ),
      );
      setStatus('Invite code regenerated. Update any shared invite links.');
      pushToast('Invite code regenerated.', 'success', 2800);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate invite code';
      setError(message);
      pushToast(message, 'error', 3200);
    } finally {
      setRegeneratingInvite(false);
    }
  };

  const copyInviteLink = async () => {
    if (!selectedRobot || editForm.roomMode !== 'LINK_ONLY' || !selectedRobot.inviteCode) {
      return;
    }

    const href = buildSelectedRobotRoomHref('LINK_ONLY');
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

  const copyEmbedCode = async () => {
    if (!selectedRobot) {
      return;
    }

    const href = buildSelectedRobotEmbedHref();
    const fullUrl =
      typeof window !== 'undefined' ? new URL(href, window.location.origin).toString() : href;
    const embedCode = `<iframe src="${fullUrl}" title="${selectedRobot.name} on BotParty" width="960" height="540" loading="lazy" allow="autoplay; fullscreen" style="border:0; width:100%; aspect-ratio:16 / 9;"></iframe>`;
    try {
      await navigator.clipboard.writeText(embedCode);
      setStatus('Embed code copied to clipboard.');
      pushToast('Embed code copied.', 'success', 2200);
    } catch {
      setError('Clipboard permission denied. Copy embed code manually.');
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
      const created = await api.robots.createRobotIngressCamera(selectedRobot.id, {
        cameraId,
        label: newIngressLabel.trim() || undefined,
        compatibilityMode: newIngressCompatibilityMode,
      });
      setIngressCameras((prev) => {
        const withoutExisting = prev.filter((entry) => entry.ingressId !== created.ingressId);
        return [...withoutExisting, created].sort((a, b) =>
          (a.cameraId ?? '').localeCompare(b.cameraId ?? ''),
        );
      });
      resetIngressDraft();
      pushToast('External camera ingress saved.', 'success', 2600);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Failed to create camera ingress.',
        'error',
        3200,
      );
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
      await api.robots.deleteRobotIngressCamera(selectedRobot.id, ingressId);
      setIngressCameras((prev) => prev.filter((entry) => entry.ingressId !== ingressId));
      pushToast('External camera ingress deleted.', 'success', 2600);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Failed to delete camera ingress.',
        'error',
        3200,
      );
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

  const toggleWebhookEvent = (eventName: string) => {
    setWebhookEvents((prev) =>
      prev.includes(eventName) ? prev.filter((entry) => entry !== eventName) : [...prev, eventName],
    );
  };

  const createWebhook = async () => {
    if (!accessToken || !selectedRobot) {
      return;
    }

    const normalizedUrl = webhookUrl.trim();
    if (!normalizedUrl) {
      pushToast('Webhook URL is required.', 'error', 2600);
      return;
    }
    if (webhookEvents.length === 0) {
      pushToast('Choose at least one webhook event.', 'error', 2600);
      return;
    }

    setWebhookOp('create');
    try {
      api.setToken(accessToken);
      const created = await api.robots.createRobotWebhook(selectedRobot.id, {
        url: normalizedUrl,
        events: webhookEvents,
        isActive: webhookActive,
      });
      setWebhooks((prev) => [created, ...prev]);
      setWebhookUrl('');
      setWebhookActive(true);
      setCreatedWebhookSecret(created.secret);
      pushToast('Webhook created.', 'success', 2400);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to create webhook.', 'error', 3200);
    } finally {
      setWebhookOp(null);
    }
  };

  const deleteWebhook = async (webhook: RobotWebhookRecord) => {
    if (!accessToken || !selectedRobot) {
      return;
    }
    if (!window.confirm(`Delete webhook ${webhook.url}?`)) {
      return;
    }

    setWebhookOp(webhook.id);
    try {
      api.setToken(accessToken);
      await api.robots.deleteRobotWebhook(selectedRobot.id, webhook.id);
      setWebhooks((prev) => prev.filter((entry) => entry.id !== webhook.id));
      if (createdWebhookSecret && webhooks.length <= 1) {
        setCreatedWebhookSecret(null);
      }
      pushToast('Webhook deleted.', 'success', 2200);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to delete webhook.', 'error', 3200);
    } finally {
      setWebhookOp(null);
    }
  };

  const runRobotAction = async (type: RemoteActionType, durationSec?: number) => {
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
      const result = await api.robots.enqueueRobotAction(selectedRobot.id, { type, durationSec });
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
        setStatus(
          'Client update queued. The robot will pull the latest git changes and restart itself.',
        );
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
      const result = await api.robots.getRobotLogs(selectedRobot.id);
      setDiagLogs(result.logs.slice(-150));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLogsLoading(false);
    }
  };

  const createSlugOwner = username?.trim() ? username : 'your-username';
  const {
    controlButtons,
    controlsLoading,
    creatingControl,
    controlOp,
    allowedUsers,
    allowlistLoading,
    allowlistOp,
    handleCreateControl,
    handleToggleControl,
    startEditControl,
    saveControlEdit,
    handleDeleteControl,
    moveControl,
    addAllowedUser,
    removeAllowedUser,
  } = controls;

  return {
    accessToken,
    hasHydrated,
    username,
    robots,
    createForm,
    setCreateForm,
    selectedId,
    setSelectedId,
    editForm,
    setEditForm,
    showToken,
    setShowToken,
    controlDraft,
    setControlDraft,
    controlPreset,
    setControlPreset,
    editingControlId,
    setEditingControlId,
    controlEditDraft,
    setControlEditDraft,
    controlEditPreset,
    setControlEditPreset,
    allowlistUsername,
    setAllowlistUsername,
    newIngressCameraId,
    setNewIngressCameraId,
    newIngressLabel,
    setNewIngressLabel,
    newIngressCompatibilityMode,
    setNewIngressCompatibilityMode,
    obsHelpOpen,
    setObsHelpOpen,
    activeSectionId,
    setActiveSectionId,
    loading,
    error,
    status,
    creating,
    selectedRobot,
    saving,
    deleting,
    regenerating,
    regeneratingInvite,
    opLoading,
    pendingActionTypes,
    logsLoading,
    diagLogs,
    telemetry,
    onboarding,
    preview,
    previewVersion,
    controlButtons,
    controlsLoading,
    creatingControl,
    controlOp,
    allowedUsers,
    allowlistLoading,
    allowlistOp,
    ingressCameras,
    ingressLoading,
    ingressOp,
    webhooks,
    webhooksLoading,
    webhookOp,
    webhookUrl,
    setWebhookUrl,
    webhookEvents,
    webhookActive,
    setWebhookActive,
    createdWebhookSecret,
    editFormRef,
    thumbnailInputRef,
    previewContainerRef,
    thumbnailOp,
    handleCreate,
    handleSave,
    handleDelete,
    handleRegenerate,
    copyToken,
    buildRobotRoomHref,
    buildSelectedRobotRoomHref,
    buildSelectedRobotEmbedHref,
    handleThumbnailFileChange,
    capturePreviewThumbnail,
    removeThumbnail,
    regenerateInviteCode,
    copyInviteLink,
    copyEmbedCode,
    createIngressCamera,
    deleteIngressCamera,
    copyIngressEndpoint,
    toggleWebhookEvent,
    createWebhook,
    deleteWebhook,
    runRobotAction,
    refreshLogs,
    handleCreateControl,
    handleToggleControl,
    startEditControl,
    saveControlEdit,
    handleDeleteControl,
    moveControl,
    addAllowedUser,
    removeAllowedUser,
    refreshPreview,
    createSlugOwner,
  };
}

export type DashboardPageState = ReturnType<typeof useDashboardPage>;
