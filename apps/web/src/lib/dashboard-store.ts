'use client';

import { create } from 'zustand';
import type { ControlButtonDraft, ControlPresetKey, RobotFormState } from '@/components/dashboard/types';
import { DEFAULT_CONTROL_DRAFT, DEFAULT_CREATE_FORM, DASHBOARD_SECTIONS } from '@/components/dashboard/types';

type Updater<T> = T | ((prev: T) => T);

function resolveUpdater<T>(prev: T, next: Updater<T>) {
  return typeof next === 'function' ? (next as (value: T) => T)(prev) : next;
}

type DashboardState = {
  createForm: RobotFormState;
  selectedId: string | null;
  editForm: RobotFormState;
  showToken: boolean;
  controlDraft: ControlButtonDraft;
  controlPreset: ControlPresetKey;
  editingControlId: string | null;
  controlEditDraft: ControlButtonDraft | null;
  controlEditPreset: ControlPresetKey;
  allowlistUsername: string;
  newIngressCameraId: string;
  newIngressLabel: string;
  newIngressCompatibilityMode: boolean;
  obsHelpOpen: boolean;
  activeSectionId: string;
  setCreateForm: (next: Updater<RobotFormState>) => void;
  resetCreateForm: () => void;
  setSelectedId: (next: string | null) => void;
  setEditForm: (next: Updater<RobotFormState>) => void;
  setShowToken: (next: Updater<boolean>) => void;
  syncShowTokenWithMask: (dashboardMaskToken: boolean) => void;
  setControlDraft: (next: Updater<ControlButtonDraft>) => void;
  resetControlDraft: () => void;
  setControlPreset: (next: ControlPresetKey) => void;
  setEditingControlId: (next: string | null) => void;
  setControlEditDraft: (next: Updater<ControlButtonDraft | null>) => void;
  clearControlEditDraft: () => void;
  setControlEditPreset: (next: ControlPresetKey) => void;
  setAllowlistUsername: (next: Updater<string>) => void;
  resetAllowlistUsername: () => void;
  setNewIngressCameraId: (next: Updater<string>) => void;
  setNewIngressLabel: (next: Updater<string>) => void;
  setNewIngressCompatibilityMode: (next: Updater<boolean>) => void;
  resetIngressDraft: () => void;
  setObsHelpOpen: (next: Updater<boolean>) => void;
  setActiveSectionId: (next: Updater<string>) => void;
};

export const useDashboardStore = create<DashboardState>()((set) => ({
  createForm: DEFAULT_CREATE_FORM,
  selectedId: null,
  editForm: DEFAULT_CREATE_FORM,
  showToken: true,
  controlDraft: DEFAULT_CONTROL_DRAFT,
  controlPreset: 'ptz-pan',
  editingControlId: null,
  controlEditDraft: null,
  controlEditPreset: 'ptz-pan',
  allowlistUsername: '',
  newIngressCameraId: '',
  newIngressLabel: '',
  newIngressCompatibilityMode: false,
  obsHelpOpen: false,
  activeSectionId: DASHBOARD_SECTIONS[0].id,
  setCreateForm: (next) => set((state) => ({ createForm: resolveUpdater(state.createForm, next) })),
  resetCreateForm: () => set({ createForm: DEFAULT_CREATE_FORM }),
  setSelectedId: (next) => set({ selectedId: next }),
  setEditForm: (next) => set((state) => ({ editForm: resolveUpdater(state.editForm, next) })),
  setShowToken: (next) => set((state) => ({ showToken: resolveUpdater(state.showToken, next) })),
  syncShowTokenWithMask: (dashboardMaskToken) => set({ showToken: !dashboardMaskToken }),
  setControlDraft: (next) => set((state) => ({ controlDraft: resolveUpdater(state.controlDraft, next) })),
  resetControlDraft: () => set({ controlDraft: DEFAULT_CONTROL_DRAFT }),
  setControlPreset: (next) => set({ controlPreset: next }),
  setEditingControlId: (next) => set({ editingControlId: next }),
  setControlEditDraft: (next) => set((state) => ({ controlEditDraft: resolveUpdater(state.controlEditDraft, next) })),
  clearControlEditDraft: () => set({ controlEditDraft: null }),
  setControlEditPreset: (next) => set({ controlEditPreset: next }),
  setAllowlistUsername: (next) => set((state) => ({ allowlistUsername: resolveUpdater(state.allowlistUsername, next) })),
  resetAllowlistUsername: () => set({ allowlistUsername: '' }),
  setNewIngressCameraId: (next) => set((state) => ({ newIngressCameraId: resolveUpdater(state.newIngressCameraId, next) })),
  setNewIngressLabel: (next) => set((state) => ({ newIngressLabel: resolveUpdater(state.newIngressLabel, next) })),
  setNewIngressCompatibilityMode: (next) =>
    set((state) => ({ newIngressCompatibilityMode: resolveUpdater(state.newIngressCompatibilityMode, next) })),
  resetIngressDraft: () =>
    set({
      newIngressCameraId: '',
      newIngressLabel: '',
      newIngressCompatibilityMode: false,
    }),
  setObsHelpOpen: (next) => set((state) => ({ obsHelpOpen: resolveUpdater(state.obsHelpOpen, next) })),
  setActiveSectionId: (next) => set((state) => ({ activeSectionId: resolveUpdater(state.activeSectionId, next) })),
}));
