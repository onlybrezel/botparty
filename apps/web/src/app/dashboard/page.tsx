'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Save,
  Trash2,
} from 'lucide-react';
import {
  api,
  type AllowedUserRecord,
  type ControlButtonRecord,
  type RobotCameraIngress,
  type RobotManaged,
  type RobotTelemetryPoint,
} from '@/lib/api';
import { useAuth } from '@/lib/store';
import { useDashboardStore } from '@/lib/dashboard-store';
import { pushToast } from '@/lib/toast';
import { usePreferences } from '@/lib/preferences';
import { MonitoringSection } from '@/components/dashboard/monitoring-section';
import { CreateRobotPanel } from '@/components/dashboard/create-robot-panel';
import { DashboardFleetSummary } from '@/components/dashboard/dashboard-fleet-summary';
import { RobotCardGrid } from '@/components/dashboard/robot-card-grid';
import { ControlButtonEditor } from '@/components/dashboard/control-button-editor';
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar';
import { DashboardPreview } from '@/components/dashboard/dashboard-preview';
import { DashboardTokenSection } from '@/components/dashboard/dashboard-token-section';
import { DashboardOperationsSection } from '@/components/dashboard/dashboard-operations-section';
import { DashboardAllowlistSection } from '@/components/dashboard/dashboard-allowlist-section';
import { DashboardSettingsSection } from '@/components/dashboard/dashboard-settings-section';
import {
  type RemoteActionType,
  type RoomMode,
  DASHBOARD_SECTIONS,
  detectRoomMode,
  toUpdatePayload,
  validateRobotFormSchedule,
  formFromRobot,
  buildWidgetSpec,
  draftFromControl,
} from '@/components/dashboard/types';

export default function DashboardPage() {
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
  const [pendingActionTypes, setPendingActionTypes] = useState<RemoteActionType[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [diagLogs, setDiagLogs] = useState<Array<{ ts: number; line: string }>>([]);
  const [telemetry, setTelemetry] = useState<{ latest: RobotTelemetryPoint | null; history: RobotTelemetryPoint[] }>({
    latest: null,
    history: [],
  });
  const [preview, setPreview] = useState<{ token: string; url: string } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [controlButtons, setControlButtons] = useState<ControlButtonRecord[]>([]);
  const [controlsLoading, setControlsLoading] = useState(false);
  const [creatingControl, setCreatingControl] = useState(false);
  const [controlOp, setControlOp] = useState<string | null>(null);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUserRecord[]>([]);
  const [allowlistLoading, setAllowlistLoading] = useState(false);
  const [allowlistOp, setAllowlistOp] = useState<string | null>(null);
  const [ingressCameras, setIngressCameras] = useState<RobotCameraIngress[]>([]);
  const [ingressLoading, setIngressLoading] = useState(false);
  const [ingressOp, setIngressOp] = useState<string | null>(null);
  const previousPendingActionTypesRef = useRef<RemoteActionType[]>([]);
  const previewRefreshInFlightRef = useRef(false);
  const editFormRef = useRef<HTMLFormElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const autoThumbnailAttemptedRef = useRef<Set<string>>(new Set());
  const [thumbnailOp, setThumbnailOp] = useState<'upload' | 'snapshot' | 'remove' | null>(null);

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
    if (!accessToken || !selectedRobot || editForm.roomMode !== 'ALLOWED_USERS') {
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
  }, [selectedRobot?.id, editForm.roomMode, accessToken]);

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

  useEffect(() => {
    if (!selectedRobot) {
      return;
    }

    const sectionElements = DASHBOARD_SECTIONS
      .map((entry) => document.getElementById(entry.id))
      .filter((element): element is HTMLElement => Boolean(element));

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
  }, [selectedRobot?.id]);

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
      const created = await api.createRobot(toUpdatePayload(createForm));
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
    const effectiveMode = robot.accessMode === 'LINK_ONLY' ? 'LINK_ONLY' : detectRoomMode(robot);
    const inviteSuffix =
      effectiveMode === 'LINK_ONLY' && robot.inviteCode
        ? `?invite=${encodeURIComponent(robot.inviteCode)}`
        : '';
    return `/robot/${robot.owner.username}/${robot.slug}${inviteSuffix}`;
  }, []);

  const buildSelectedRobotRoomHref = useCallback((roomMode: RoomMode = editForm.roomMode) => {
    if (!selectedRobot) {
      return '#';
    }

    const inviteSuffix =
      roomMode === 'LINK_ONLY' && selectedRobot.inviteCode
        ? `?invite=${encodeURIComponent(selectedRobot.inviteCode)}`
        : '';
    return `/robot/${selectedRobot.owner.username}/${selectedRobot.slug}${inviteSuffix}`;
  }, [editForm.roomMode, selectedRobot]);

  const buildSelectedRobotEmbedHref = useCallback(() => {
    if (!selectedRobot) {
      return '#';
    }
    return `/embed/${selectedRobot.owner.username}/${selectedRobot.slug}`;
  }, [selectedRobot]);

  const applyUpdatedRobot = useCallback((updated: RobotManaged) => {
    setRobots((prev) => prev.map((robot) => (robot.id === updated.id ? updated : robot)));
    setEditForm(formFromRobot(updated));
  }, [setEditForm]);

  const updateThumbnailFromDataUrl = useCallback(async (dataUrl: string, mode: 'upload' | 'snapshot') => {
    if (!accessToken || !selectedRobot) {
      return;
    }

    setThumbnailOp(mode);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const updated = await api.uploadRobotThumbnail(selectedRobot.id, dataUrl);
      applyUpdatedRobot(updated);
      setStatus(mode === 'snapshot' ? 'Thumbnail captured from the live preview.' : 'Thumbnail uploaded.');
      pushToast(mode === 'snapshot' ? 'Thumbnail captured.' : 'Thumbnail uploaded.', 'success', 2600);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update thumbnail';
      setError(message);
      pushToast(message, 'error', 3200);
    } finally {
      setThumbnailOp(null);
    }
  }, [accessToken, applyUpdatedRobot, selectedRobot]);

  const handleThumbnailFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      pushToast('Please choose an image file.', 'error', 2600);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      if (!result) {
        pushToast('Could not read that image file.', 'error', 2600);
        return;
      }

      const image = new window.Image();
      image.onload = () => {
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          pushToast('Could not prepare that image.', 'error', 2600);
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        void updateThumbnailFromDataUrl(canvas.toDataURL('image/jpeg', 0.82), 'upload');
      };
      image.onerror = () => {
        pushToast('Could not decode that image file.', 'error', 2600);
      };
      image.src = result;
    };
    reader.onerror = () => {
      pushToast('Could not read that image file.', 'error', 2600);
    };
    reader.readAsDataURL(file);
  }, [updateThumbnailFromDataUrl]);

  const capturePreviewThumbnail = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!selectedRobot || (selectedRobot.status !== 'ONLINE' && selectedRobot.status !== 'BUSY')) {
      if (!silent) {
        pushToast('The robot must be live to capture a snapshot.', 'error', 2600);
      }
      return;
    }

    const video = previewContainerRef.current?.querySelector('video') ?? null;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      if (!silent) {
        pushToast('No live camera frame is available yet.', 'error', 2600);
      }
      return;
    }

    const canvas = document.createElement('canvas');
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (!silent) {
        pushToast('Snapshot capture is not available in this browser.', 'error', 2600);
      }
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    await updateThumbnailFromDataUrl(dataUrl, 'snapshot');
  }, [selectedRobot, updateThumbnailFromDataUrl]);

  useEffect(() => {
    if (!selectedRobot) {
      return;
    }

    if (selectedRobot.thumbnailUrl) {
      autoThumbnailAttemptedRef.current.delete(selectedRobot.id);
      return;
    }

    if (selectedRobot.status !== 'ONLINE' && selectedRobot.status !== 'BUSY') {
      return;
    }

    if (!preview || thumbnailOp !== null || autoThumbnailAttemptedRef.current.has(selectedRobot.id)) {
      return;
    }

    autoThumbnailAttemptedRef.current.add(selectedRobot.id);
    let attempts = 0;
    const maxAttempts = 8;

    const interval = window.setInterval(() => {
      const video = previewContainerRef.current?.querySelector('video') ?? null;
      const ready = Boolean(video && video.videoWidth > 0 && video.videoHeight > 0);
      attempts += 1;

      if (ready) {
        window.clearInterval(interval);
        void capturePreviewThumbnail({ silent: true });
        return;
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [capturePreviewThumbnail, preview, selectedRobot, thumbnailOp]);

  useEffect(() => {
    if (!accessToken || !selectedRobot || editForm.roomMode !== 'LINK_ONLY' || selectedRobot.inviteCode) {
      return;
    }

    let active = true;
    api.setToken(accessToken);
    api.ensureRobotInviteCode(selectedRobot.id)
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

  const removeThumbnail = useCallback(async () => {
    if (!accessToken || !selectedRobot) {
      return;
    }

    setThumbnailOp('remove');
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const updated = await api.deleteRobotThumbnail(selectedRobot.id);
      applyUpdatedRobot(updated);
      setStatus('Thumbnail removed.');
      pushToast('Thumbnail removed.', 'success', 2400);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove thumbnail';
      setError(message);
      pushToast(message, 'error', 3200);
    } finally {
      setThumbnailOp(null);
    }
  }, [accessToken, applyUpdatedRobot, selectedRobot]);

  const regenerateInviteCode = async () => {
    if (!accessToken || !selectedRobot || editForm.roomMode !== 'LINK_ONLY') {
      return;
    }

    if (!window.confirm('Generate a new invite code? Previously shared invite links will stop working immediately.')) {
      return;
    }

    setRegeneratingInvite(true);
    setError(null);
    setStatus(null);

    try {
      api.setToken(accessToken);
      const next = await api.regenerateRobotInviteCode(selectedRobot.id);
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
      const created = await api.createRobotIngressCamera(selectedRobot.id, {
        cameraId,
        label: newIngressLabel.trim() || undefined,
        compatibilityMode: newIngressCompatibilityMode,
      });
      setIngressCameras((prev) => {
        const withoutExisting = prev.filter((entry) => entry.ingressId !== created.ingressId);
        return [...withoutExisting, created].sort((a, b) => (a.cameraId ?? '').localeCompare(b.cameraId ?? ''));
      });
      resetIngressDraft();
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
      resetControlDraft();
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
      clearControlEditDraft();
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
      resetAllowlistUsername();
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

  const createSlugOwner = username?.trim() ? username : 'your-username';

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
              Create robots, configure settings, and copy claim tokens for your Linux robot client.
            </p>
          </div>
        </div>
      </section>

      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {status && <p className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{status}</p>}

      <CreateRobotPanel
        createForm={createForm}
        setCreateForm={setCreateForm}
        onSubmit={handleCreate}
        creating={creating}
        loading={loading}
        slugOwner={createSlugOwner}
      />

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="mb-4 text-lg font-bold">My Robots</h2>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading robots...</p>
        ) : robots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
            <p className="text-base font-semibold">No robots yet</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Create your first robot using the form above, then follow these steps to go live:</p>
            <ol className="mt-4 space-y-2 text-left text-sm text-[var(--muted-foreground)] max-w-sm mx-auto">
              <li className="flex items-start gap-2"><span className="shrink-0 font-bold text-violet-400">1.</span>Create a robot profile &amp; grab the claim token.</li>
              <li className="flex items-start gap-2"><span className="shrink-0 font-bold text-violet-400">2.</span>Install the robot client on your hardware (<a href="/docs/getting-started" className="underline hover:text-[var(--foreground)]">Getting Started guide</a>).</li>
              <li className="flex items-start gap-2"><span className="shrink-0 font-bold text-violet-400">3.</span>Configure <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-xs">config.yaml</code> with your claim token &amp; start the client.</li>
              <li className="flex items-start gap-2"><span className="shrink-0 font-bold text-violet-400">4.</span>Return here — the robot will appear as Online once connected.</li>
            </ol>
          </div>
        ) : (
          <>
            <DashboardFleetSummary robots={robots} selectedId={selectedId} />
            {!selectedRobot ? (
            <RobotCardGrid robots={robots} onSelect={setSelectedId} />
          ) : (
            <div className="flex items-start gap-5">
              <DashboardSidebar
                robots={robots}
                selectedId={selectedId}
                activeSectionId={activeSectionId}
                saving={saving}
                deleting={deleting}
                editFormRef={editFormRef}
                onSelect={setSelectedId}
                onSectionSelect={(id) => {
                  setActiveSectionId(id);
                  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                onDelete={() => void handleDelete()}
              />
              <div className="min-w-0 flex-1">
                <>
                  <DashboardPreview
                    robot={selectedRobot}
                    roomHref={buildRobotRoomHref(selectedRobot)}
                    preview={preview}
                    previewVersion={previewVersion}
                    previewContainerRef={previewContainerRef}
                    onStreamStalled={() => {
                      void refreshPreview(true);
                    }}
                  />

                <form ref={editFormRef} onSubmit={handleSave} autoComplete="off" className="flex flex-col gap-3">
                  <DashboardSettingsSection
                    robot={selectedRobot}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    buildSelectedRobotRoomHref={buildSelectedRobotRoomHref}
                    copyInviteLink={copyInviteLink}
                    regenerateInviteCode={regenerateInviteCode}
                    regeneratingInvite={regeneratingInvite}
                    ingressLoading={ingressLoading}
                    ingressCameras={ingressCameras}
                    ingressOp={ingressOp}
                    newIngressCameraId={newIngressCameraId}
                    setNewIngressCameraId={setNewIngressCameraId}
                    newIngressLabel={newIngressLabel}
                    setNewIngressLabel={setNewIngressLabel}
                    newIngressCompatibilityMode={newIngressCompatibilityMode}
                    setNewIngressCompatibilityMode={setNewIngressCompatibilityMode}
                    createIngressCamera={createIngressCamera}
                    deleteIngressCamera={deleteIngressCamera}
                    copyIngressEndpoint={copyIngressEndpoint}
                    obsHelpOpen={obsHelpOpen}
                    setObsHelpOpen={setObsHelpOpen}
                    thumbnailInputRef={thumbnailInputRef}
                    handleThumbnailFileChange={handleThumbnailFileChange}
                    thumbnailOp={thumbnailOp}
                    capturePreviewThumbnail={capturePreviewThumbnail}
                    removeThumbnail={removeThumbnail}
                  />

                  <DashboardTokenSection
                    robot={selectedRobot}
                    showToken={showToken}
                    regenerating={regenerating}
                    embedCode={`<iframe src="${buildSelectedRobotEmbedHref()}" title="${selectedRobot.name} on BotParty" width="960" height="540" loading="lazy" allow="autoplay; fullscreen" style="border:0; width:100%; aspect-ratio:16 / 9;"></iframe>`}
                    onToggleVisibility={() => setShowToken((prev) => !prev)}
                    onCopyToken={() => void copyToken()}
                    onCopyEmbedCode={() => void copyEmbedCode()}
                    onRegenerate={() => void handleRegenerate()}
                  />

                  <DashboardOperationsSection
                    telemetry={telemetry}
                    opLoading={opLoading}
                    pendingActionTypes={pendingActionTypes}
                    logsLoading={logsLoading}
                    diagLogs={diagLogs}
                    onRunAction={(type, durationSec) => void runRobotAction(type, durationSec)}
                    onRefreshLogs={() => void refreshLogs()}
                  />

                  <DashboardAllowlistSection
                    visible={editForm.roomMode === 'ALLOWED_USERS'}
                    allowlistUsername={allowlistUsername}
                    allowlistOp={allowlistOp}
                    allowlistLoading={allowlistLoading}
                    allowedUsers={allowedUsers}
                    onUsernameChange={setAllowlistUsername}
                    onAdd={() => void addAllowedUser()}
                    onRemove={(user) => void removeAllowedUser(user)}
                  />

                  <ControlButtonEditor
                    controlButtons={controlButtons}
                    controlsLoading={controlsLoading}
                    controlDraft={controlDraft}
                    setControlDraft={setControlDraft}
                    controlPreset={controlPreset}
                    setControlPreset={setControlPreset}
                    editingControlId={editingControlId}
                    controlEditDraft={controlEditDraft}
                    setControlEditDraft={setControlEditDraft}
                    controlEditPreset={controlEditPreset}
                    setControlEditPreset={setControlEditPreset}
                    setEditingControlId={setEditingControlId}
                    controlOp={controlOp}
                    creatingControl={creatingControl}
                    onCreateControl={handleCreateControl}
                    onToggleControl={handleToggleControl}
                    onStartEditControl={startEditControl}
                    onSaveControlEdit={saveControlEdit}
                    onDeleteControl={handleDeleteControl}
                    onMoveControl={moveControl}
                  />

                  <MonitoringSection telemetry={telemetry} />

                  <div className="order-5 flex flex-wrap gap-2 lg:hidden">
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
              </div>
            </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
