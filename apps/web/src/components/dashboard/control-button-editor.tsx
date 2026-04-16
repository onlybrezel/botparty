'use client';

import React from 'react';

import { Select } from '@/components/ui/select';
import { ControlBuilderPreview } from '@/components/dashboard/control-builder-preview';
import type { ControlButtonRecord } from '@/lib/api';
import {
  type ControlButtonDraft,
  type ControlPresetKey,
  CONTROL_PRESETS,
  controlAccessOptions,
  applyControlPreset,
} from '@/components/dashboard/types';
import type { ControlButtonAccess } from '@botparty/shared';
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
  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">Controls</span>
  <div className="h-px flex-1 bg-[var(--border)]" />
</div>

<div className="order-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
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
          onClick={() => void onSaveControlEdit()}
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

    </>
  );
}
