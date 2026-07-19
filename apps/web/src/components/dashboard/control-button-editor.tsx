'use client';

import React from 'react';

import { ControlButtonFields } from '@/components/dashboard/control-button-fields';
import type { ControlButtonRecord } from '@/lib/api';
import { releaseFeatures } from '@/lib/release-features';
import { type ControlButtonDraft, type ControlPresetKey } from '@/components/dashboard/types';
import { Plus } from 'lucide-react';

type Props = {
  controlButtons: ControlButtonRecord[];
  controlsLoading: boolean;
  controlDraft: ControlButtonDraft;
  setControlDraft: React.Dispatch<React.SetStateAction<ControlButtonDraft>>;
  controlPreset: ControlPresetKey;
  setControlPreset: (preset: ControlPresetKey) => void;
  editingControlId: string | null;
  controlEditDraft: ControlButtonDraft | null;
  setControlEditDraft: React.Dispatch<React.SetStateAction<ControlButtonDraft | null>>;
  controlEditPreset: ControlPresetKey;
  setControlEditPreset: (preset: ControlPresetKey) => void;
  setEditingControlId: (id: string | null) => void;
  controlOp: string | null;
  creatingControl: boolean;
  onCreateControl: () => Promise<void>;
  onToggleControl: (button: ControlButtonRecord) => Promise<void>;
  onStartEditControl: (button: ControlButtonRecord) => void;
  onSaveControlEdit: () => Promise<void>;
  onDeleteControl: (button: ControlButtonRecord) => Promise<void>;
  onMoveControl: (buttonId: string, direction: -1 | 1) => Promise<void>;
};

export function ControlButtonEditor({
  controlButtons,
  controlsLoading,
  controlDraft,
  setControlDraft,
  controlPreset,
  setControlPreset,
  editingControlId,
  controlEditDraft,
  setControlEditDraft,
  controlEditPreset,
  setControlEditPreset,
  setEditingControlId,
  controlOp,
  creatingControl,
  onCreateControl,
  onToggleControl,
  onStartEditControl,
  onSaveControlEdit,
  onDeleteControl,
  onMoveControl,
}: Props) {
  return (
    <>
      <div id="section-controls" className="order-3 scroll-mt-4 flex items-center gap-3 pt-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
          Controls
        </span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="order-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Control Buttons
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Manage the button deck shown on the public robot page.
            </p>
          </div>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {controlButtons.length} configured
          </span>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ControlButtonFields
            draft={controlDraft}
            preset={controlPreset}
            surface="card"
            onDraftChange={(update) => setControlDraft(update)}
            onPresetChange={setControlPreset}
          />
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => {
                void onCreateControl();
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
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Edit control button
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Update label, command, hotkey, cooldown, access, and color.
                </p>
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
              <ControlButtonFields
                draft={controlEditDraft}
                preset={controlEditPreset}
                surface="background"
                onDraftChange={(update) =>
                  setControlEditDraft((current) => (current ? update(current) : current))
                }
                onPresetChange={setControlEditPreset}
              />
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void onSaveControlEdit()}
                disabled={controlOp === editingControlId}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-medium text-emerald-700 disabled:opacity-60 dark:text-emerald-300"
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
                  role="group"
                  aria-label={`Control ${button.label}`}
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
                            ? 'bg-zinc-800 text-zinc-100'
                            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {button.isEnabled === false ? 'Disabled' : 'Enabled'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Access: {button.access} · Cooldown: {button.cooldownMs}ms
                      {releaseFeatures.paidControls && button.costCredits > 0
                        ? ` · Cost: ${button.costCredits} cr`
                        : ''}
                      {button.hotKey ? ` · Hotkey: ${button.hotKey}` : ''}
                      {button.icon?.startsWith('widget:') ? ` · Widget: ${button.icon}` : ''}
                      {button.color ? ` · Color: ${button.color}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onStartEditControl(button)}
                      disabled={controlOp === button.id}
                      className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void onMoveControl(button.id, -1)}
                      disabled={index === 0 || controlOp === button.id}
                      className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => void onMoveControl(button.id, 1)}
                      disabled={index === controlButtons.length - 1 || controlOp === button.id}
                      className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => void onToggleControl(button)}
                      disabled={controlOp === button.id}
                      className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {button.isEnabled === false ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteControl(button)}
                      disabled={controlOp === button.id}
                      className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-700 disabled:opacity-50 dark:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </>
  );
}
