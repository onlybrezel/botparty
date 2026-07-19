'use client';

import { useEffect, useState } from 'react';
import type { ControlButtonDraft } from './types';

interface ControlBuilderPreviewProps {
  draft: ControlButtonDraft;
}

export function ControlBuilderPreview({ draft }: ControlBuilderPreviewProps) {
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
  const colorStyle = draft.color.trim() ? { borderColor: draft.color.trim() } : undefined;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      <p className="mb-3 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">Live Preview</p>

      {draft.controlKind === 'button' ? (
        <div className="flex flex-wrap items-start gap-3">
          <button
            type="button"
            style={colorStyle}
            className="flex min-h-12 min-w-[3.25rem] items-center justify-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm font-bold transition select-none"
          >
            {draft.icon.trim() ? <span>{draft.icon.trim()}</span> : null}
            {draft.label.trim() || 'Button'}
            {draft.hotKey ? <span className="ml-1 text-xs opacity-40">[{draft.hotKey}]</span> : null}
          </button>
          <div className="text-xs text-[var(--muted-foreground)]">
            <p>{draft.command.trim() || 'command'}</p>
            <p>
              {draft.access} &middot; {draft.cooldownMs}ms
            </p>
          </div>
        </div>
      ) : draft.controlKind === 'slider' ? (
        <div
          className="min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2"
          style={colorStyle}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--foreground)]">{draft.label.trim() || 'Slider'}</p>
            <span className="text-[10px] text-[var(--muted-foreground)]">{sliderValue.toFixed(0)}</span>
          </div>
          <input
            type="range"
            min={Number.isFinite(sliderMin) ? sliderMin : -100}
            max={Number.isFinite(sliderMax) ? sliderMax : 100}
            step={sliderStep}
            value={sliderValue}
            onChange={(event) => setSliderValue(Number(event.target.value))}
            onPointerUp={() => {
              if (draft.widgetReturn === 'center') {
                setSliderValue(Number(draft.sliderStart) || 0);
              }
            }}
            className={`accent-[var(--primary)] ${
              draft.sliderDirection === 'vertical'
                ? 'h-28 w-6 [direction:rtl] [writing-mode:vertical-lr]'
                : 'w-full'
            }`}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>{draft.sliderMin}</span>
            <span className="opacity-80">
              {draft.command.trim() || 'command'} &middot; {draft.access} &middot; {draft.cooldownMs}ms
            </span>
            <span>{draft.sliderMax}</span>
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2"
          style={colorStyle}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--foreground)]">{draft.label.trim() || 'XY Pad'}</p>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              x {xyValue.x.toFixed(0)} &middot; y {xyValue.y.toFixed(0)}
            </span>
          </div>
          <div
            className="relative h-32 w-32 touch-none rounded border border-[var(--border)] bg-[var(--background)]"
            onPointerDown={(event) => {
              const target = event.currentTarget;
              const rect = target.getBoundingClientRect();
              const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
              const nextX = xMin + nx * (xMax - xMin);
              const nextY = yMax - ny * (yMax - yMin);
              setXyValue({ x: nextX, y: nextY });
            }}
            onPointerUp={() => {
              if (draft.widgetReturn === 'center') {
                setXyValue({
                  x: Number(draft.xyXStart) || 0,
                  y: Number(draft.xyYStart) || 0,
                });
              }
            }}
          >
            <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-[var(--border)]" />
            <div className="absolute left-1/2 top-1/2 h-full w-px -translate-y-1/2 bg-[var(--border)]" />
            <div
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]"
              style={{ left: `${xPercent}%`, top: `${100 - yPercent}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            {draft.command.trim() || 'command'} &middot; {draft.access} &middot; {draft.cooldownMs}ms
          </div>
        </div>
      )}
    </div>
  );
}
