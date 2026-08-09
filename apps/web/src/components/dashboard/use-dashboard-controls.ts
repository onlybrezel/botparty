'use client';

import { useEffect, useState } from 'react';
import { api, type AllowedUserRecord, type ControlButtonRecord } from '@/lib/api';
import { pushToast } from '@/lib/toast';
import {
  buildWidgetSpec,
  draftFromControl,
  type ControlButtonDraft,
  type ControlPresetKey,
  type RoomMode,
} from './types';

type Updater<T> = T | ((current: T) => T);

export function useDashboardControls({
  accessToken,
  selectedRobotId,
  roomMode,
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
}: {
  accessToken: string | null;
  selectedRobotId: string | null;
  roomMode: RoomMode;
  controlDraft: ControlButtonDraft;
  resetControlDraft: () => void;
  editingControlId: string | null;
  setEditingControlId: (value: string | null) => void;
  controlEditDraft: ControlButtonDraft | null;
  setControlEditDraft: (value: Updater<ControlButtonDraft | null>) => void;
  clearControlEditDraft: () => void;
  setControlEditPreset: (value: ControlPresetKey) => void;
  allowlistUsername: string;
  resetAllowlistUsername: () => void;
  setError: (value: string | null) => void;
}) {
  const [controlButtons, setControlButtons] = useState<ControlButtonRecord[]>([]);
  const [controlsLoading, setControlsLoading] = useState(false);
  const [creatingControl, setCreatingControl] = useState(false);
  const [controlOp, setControlOp] = useState<string | null>(null);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUserRecord[]>([]);
  const [allowlistLoading, setAllowlistLoading] = useState(false);
  const [allowlistOp, setAllowlistOp] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !selectedRobotId) {
      setControlButtons([]);
      return;
    }
    let active = true;
    setControlsLoading(true);
    api.setToken(accessToken);
    void api.controls.getAllControls(selectedRobotId)
      .then((buttons) => {
        if (active) setControlButtons(buttons.sort((left, right) => left.position - right.position));
      })
      .catch(() => {
        if (active) setControlButtons([]);
      })
      .finally(() => {
        if (active) setControlsLoading(false);
      });
    return () => { active = false; };
  }, [accessToken, selectedRobotId]);

  useEffect(() => {
    if (!accessToken || !selectedRobotId || roomMode !== 'ALLOWED_USERS') {
      setAllowedUsers([]);
      return;
    }
    let active = true;
    setAllowlistLoading(true);
    api.setToken(accessToken);
    void api.robots.getAllowedUsers(selectedRobotId)
      .then((rows) => {
        if (active) setAllowedUsers(rows);
      })
      .catch(() => {
        if (active) setAllowedUsers([]);
      })
      .finally(() => {
        if (active) setAllowlistLoading(false);
      });
    return () => { active = false; };
  }, [accessToken, roomMode, selectedRobotId]);

  const handleCreateControl = async () => {
    if (!accessToken || !selectedRobotId) return;
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
      const widgetSpec = buildWidgetSpec(controlDraft);
      const next = await api.controls.createControl(selectedRobotId, {
        label,
        command,
        ...(controlDraft.hotKey.trim() ? { hotKey: controlDraft.hotKey.trim() } : {}),
        ...(widgetSpec ? { icon: widgetSpec } : {}),
        cooldownMs: Number(controlDraft.cooldownMs),
        costCredits: Math.max(0, Number(controlDraft.costCredits) || 0),
        access: controlDraft.access,
        ...(controlDraft.color.trim() ? { color: controlDraft.color.trim() } : {}),
      });
      setControlButtons((current) => [...current, next].sort((left, right) => left.position - right.position));
      resetControlDraft();
      pushToast('Control button created.', 'success', 2500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create control button';
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
      const updated = await api.controls.updateControl(button.id, { isEnabled: !button.isEnabled });
      setControlButtons((current) => current.map((entry) => entry.id === button.id ? updated : entry));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to update control.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const startEditControl = (button: ControlButtonRecord) => {
    setEditingControlId(button.id);
    const draft = draftFromControl(button);
    setControlEditDraft(draft);
    if (draft.controlKind === 'xy') setControlEditPreset('arm-xy');
    else if (draft.controlKind === 'slider' && draft.sliderDirection === 'vertical') setControlEditPreset('ptz-tilt');
    else if (draft.command === 'set_speed') setControlEditPreset('drive-speed');
    else if (draft.command === 'gripper') setControlEditPreset('gripper');
    else setControlEditPreset('ptz-pan');
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
      const widgetSpec = buildWidgetSpec(controlEditDraft);
      const updated = await api.controls.updateControl(editingControlId, {
        label,
        command,
        ...(controlEditDraft.hotKey.trim() ? { hotKey: controlEditDraft.hotKey.trim() } : {}),
        ...(widgetSpec ? { icon: widgetSpec } : {}),
        cooldownMs: Number(controlEditDraft.cooldownMs),
        costCredits: Math.max(0, Number(controlEditDraft.costCredits) || 0),
        access: controlEditDraft.access,
        color: controlEditDraft.color.trim() || null,
      });
      setControlButtons((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setEditingControlId(null);
      clearControlEditDraft();
      pushToast('Control button updated.', 'success', 2200);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to update control.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const handleDeleteControl = async (button: ControlButtonRecord) => {
    if (!accessToken || !selectedRobotId || !window.confirm(`Delete control button ${button.label}?`)) return;
    setControlOp(button.id);
    try {
      api.setToken(accessToken);
      await api.controls.deleteControl(button.id);
      const next = controlButtons.filter((entry) => entry.id !== button.id).map((entry, index) => ({ ...entry, position: index }));
      setControlButtons(next);
      await api.controls.reorderControls(selectedRobotId, next.map((entry, position) => ({ id: entry.id, position })));
      pushToast('Control button deleted.', 'success', 2200);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to delete control.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const moveControl = async (buttonId: string, direction: -1 | 1) => {
    if (!accessToken || !selectedRobotId) return;
    const currentIndex = controlButtons.findIndex((entry) => entry.id === buttonId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= controlButtons.length) return;
    const next = [...controlButtons];
    const [moved] = next.splice(currentIndex, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    const normalized = next.map((entry, position) => ({ ...entry, position }));
    setControlButtons(normalized);
    setControlOp(buttonId);
    try {
      api.setToken(accessToken);
      await api.controls.reorderControls(selectedRobotId, normalized.map((entry, position) => ({ id: entry.id, position })));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to reorder controls.', 'error');
    } finally {
      setControlOp(null);
    }
  };

  const addAllowedUser = async () => {
    if (!accessToken || !selectedRobotId || !allowlistUsername.trim()) return;
    setAllowlistOp('add');
    try {
      api.setToken(accessToken);
      const added = await api.robots.addAllowedUser(selectedRobotId, allowlistUsername.trim());
      setAllowedUsers((current) => current.some((entry) => entry.id === added.id) ? current : [...current, added]);
      resetAllowlistUsername();
      pushToast('User added to allow list.', 'success', 2200);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to add user.', 'error');
    } finally {
      setAllowlistOp(null);
    }
  };

  const removeAllowedUser = async (user: AllowedUserRecord) => {
    if (!accessToken || !selectedRobotId) return;
    setAllowlistOp(user.id);
    try {
      api.setToken(accessToken);
      await api.robots.removeAllowedUser(selectedRobotId, user.id);
      setAllowedUsers((current) => current.filter((entry) => entry.id !== user.id));
      pushToast('User removed from allow list.', 'success', 2200);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to remove user.', 'error');
    } finally {
      setAllowlistOp(null);
    }
  };

  return {
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
  };
}
