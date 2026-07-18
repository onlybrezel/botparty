'use client';

import type { ChangeEvent } from 'react';

import { Select } from '@/components/ui/select';
import { ControlBuilderPreview } from '@/components/dashboard/control-builder-preview';
import {
  applyControlPreset,
  CONTROL_PRESETS,
  controlAccessOptions,
  type ControlButtonDraft,
  type ControlPresetKey,
} from '@/components/dashboard/types';
import type { ControlButtonAccess } from '@botparty/shared';
import { releaseFeatures } from '@/lib/release-features';

type Props = {
  draft: ControlButtonDraft;
  preset: ControlPresetKey;
  surface: 'background' | 'card';
  onDraftChange: (update: (current: ControlButtonDraft) => ControlButtonDraft) => void;
  onPresetChange: (preset: ControlPresetKey) => void;
};

export function ControlButtonFields({
  draft,
  preset,
  surface,
  onDraftChange,
  onPresetChange,
}: Props) {
  const fieldBackground = surface === 'card' ? 'bg-[var(--card)]' : 'bg-[var(--background)]';
  const inputClassName = `rounded-lg border border-[var(--border)] ${fieldBackground} px-3 py-2 text-sm`;

  function updateField<Key extends keyof ControlButtonDraft>(
    key: Key,
    value: ControlButtonDraft[Key],
  ) {
    onDraftChange((current) => ({ ...current, [key]: value }));
  }

  function updateTextField<Key extends keyof ControlButtonDraft>(key: Key) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      updateField(key, event.target.value as ControlButtonDraft[Key]);
    };
  }

  return (
    <>
      <Select
        className={fieldBackground}
        value={preset}
        onChange={(event) => onPresetChange(event.target.value as ControlPresetKey)}
      >
        {CONTROL_PRESETS.map((controlPreset) => (
          <option key={controlPreset.key} value={controlPreset.key}>
            Preset: {controlPreset.label}
          </option>
        ))}
      </Select>
      <button
        type="button"
        onClick={() => onDraftChange((current) => applyControlPreset(current, preset))}
        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
      >
        Apply preset
      </button>
      <input
        className={inputClassName}
        placeholder="Label"
        value={draft.label}
        onChange={updateTextField('label')}
      />
      <input
        className={inputClassName}
        placeholder="Command"
        value={draft.command}
        onChange={updateTextField('command')}
      />
      <input
        className={inputClassName}
        placeholder="Hotkey (optional)"
        maxLength={8}
        value={draft.hotKey}
        onChange={updateTextField('hotKey')}
      />
      <Select
        className={fieldBackground}
        value={draft.controlKind}
        onChange={(event) =>
          updateField('controlKind', event.target.value as ControlButtonDraft['controlKind'])
        }
      >
        <option value="button">Type: Button</option>
        <option value="slider">Type: Slider</option>
        <option value="xy">Type: XY Pad</option>
      </Select>
      {draft.controlKind === 'button' ? (
        <input
          className={inputClassName}
          placeholder="Icon/emoji (optional)"
          value={draft.icon}
          onChange={updateTextField('icon')}
        />
      ) : draft.controlKind === 'slider' ? (
        <>
          <input
            type="number"
            className={inputClassName}
            placeholder="Slider min"
            value={draft.sliderMin}
            onChange={updateTextField('sliderMin')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="Slider max"
            value={draft.sliderMax}
            onChange={updateTextField('sliderMax')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="Start value"
            value={draft.sliderStart}
            onChange={updateTextField('sliderStart')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="Step"
            value={draft.sliderStep}
            onChange={updateTextField('sliderStep')}
          />
          <Select
            className={fieldBackground}
            value={draft.sliderDirection}
            onChange={(event) =>
              updateField(
                'sliderDirection',
                event.target.value as ControlButtonDraft['sliderDirection'],
              )
            }
          >
            <option value="horizontal">Slider: Horizontal</option>
            <option value="vertical">Slider: Vertical</option>
          </Select>
          <Select
            className={fieldBackground}
            value={draft.widgetReturn}
            onChange={(event) =>
              updateField('widgetReturn', event.target.value as ControlButtonDraft['widgetReturn'])
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
            className={inputClassName}
            placeholder="X min"
            value={draft.xyXMin}
            onChange={updateTextField('xyXMin')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="X max"
            value={draft.xyXMax}
            onChange={updateTextField('xyXMax')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="X start"
            value={draft.xyXStart}
            onChange={updateTextField('xyXStart')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="Y min"
            value={draft.xyYMin}
            onChange={updateTextField('xyYMin')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="Y max"
            value={draft.xyYMax}
            onChange={updateTextField('xyYMax')}
          />
          <input
            type="number"
            className={inputClassName}
            placeholder="Y start"
            value={draft.xyYStart}
            onChange={updateTextField('xyYStart')}
          />
        </>
      )}
      <input
        type="number"
        min={50}
        max={10000}
        className={inputClassName}
        placeholder="Cooldown ms"
        value={draft.cooldownMs}
        onChange={updateTextField('cooldownMs')}
      />
      {releaseFeatures.paidControls ? (
        <input
          type="number"
          min={0}
          className={inputClassName}
          placeholder="Cost (cr)"
          title="Cost per press in credits (0 = free)"
          value={draft.costCredits}
          onChange={updateTextField('costCredits')}
        />
      ) : null}
      <Select
        className={fieldBackground}
        value={draft.access}
        onChange={(event) => updateField('access', event.target.value as ControlButtonAccess)}
      >
        {controlAccessOptions.map((option) => (
          <option key={option.value} value={option.value}>
            Access: {option.label}
          </option>
        ))}
      </Select>
      <input
        className={inputClassName}
        placeholder="Color (optional, e.g. #22c55e)"
        value={draft.color}
        onChange={updateTextField('color')}
      />
      <input
        type="number"
        min={100}
        className={inputClassName}
        placeholder="Auto reset after ms (optional)"
        value={draft.resetAfterMs}
        onChange={updateTextField('resetAfterMs')}
      />
      <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
        <input
          type="checkbox"
          checked={draft.resetOnQueueLoss}
          onChange={(event) => updateField('resetOnQueueLoss', event.target.checked)}
        />
        Reset on queue loss
      </label>
      <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] sm:col-span-2">
        <input
          type="checkbox"
          checked={draft.resetOnOffline}
          onChange={(event) => updateField('resetOnOffline', event.target.checked)}
        />
        Reset when robot goes offline/restarts
      </label>
      <div className="sm:col-span-2">
        <ControlBuilderPreview draft={draft} />
      </div>
    </>
  );
}
