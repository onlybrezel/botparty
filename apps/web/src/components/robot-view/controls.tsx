'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

type SliderWidgetConfig = {
  kind: 'slider';
  min: number;
  max: number;
  start: number;
  step: number;
  direction: 'horizontal' | 'vertical';
  returnMode: 'center' | 'none';
  resetOnQueueLoss: boolean;
  resetOnOffline: boolean;
  resetAfterMs: number | null;
};

type XYWidgetConfig = {
  kind: 'xy';
  xMin: number;
  xMax: number;
  xStart: number;
  yMin: number;
  yMax: number;
  yStart: number;
  returnMode: 'center' | 'none';
  resetOnQueueLoss: boolean;
  resetOnOffline: boolean;
  resetAfterMs: number | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function SliderControl({
  label,
  command,
  config,
  color,
  cooldownMs,
  access,
  isCrowd,
  disabled,
  queueResetEpoch,
  offlineResetEpoch,
  onSendValue,
}: {
  label: string;
  command: string;
  config: SliderWidgetConfig;
  color: string | null;
  cooldownMs: number;
  access: string;
  isCrowd: boolean;
  disabled: boolean;
  queueResetEpoch: number;
  offlineResetEpoch: number;
  onSendValue: (value: number) => void;
}) {
  const [value, setValue] = useState<number>(config.start);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(config.start);
  }, [config.start, config.min, config.max, command]);

  useEffect(() => {
    if (!config.resetOnQueueLoss || queueResetEpoch === 0) return;
    setValue(config.start);
    onSendValue(config.start);
  }, [config.resetOnQueueLoss, config.start, onSendValue, queueResetEpoch]);

  useEffect(() => {
    if (!config.resetOnOffline || offlineResetEpoch === 0) return;
    setValue(config.start);
    onSendValue(config.start);
  }, [config.resetOnOffline, config.start, onSendValue, offlineResetEpoch]);

  useEffect(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (config.resetAfterMs === null || value === config.start) return;

    resetTimerRef.current = setTimeout(() => {
      setValue(config.start);
      onSendValue(config.start);
      resetTimerRef.current = null;
    }, config.resetAfterMs);

    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [config.resetAfterMs, config.start, onSendValue, value]);

  const emit = useCallback((nextValue: number) => { onSendValue(nextValue); }, [onSendValue]);

  return (
    <div
      className={`min-w-[14rem] rounded-lg border px-3 py-2 ${
        isCrowd ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--border)] bg-[var(--muted)]'
      }`}
      style={color ? { borderColor: color } : undefined}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{label}</p>
        <span className="text-[10px] text-[var(--muted-foreground)]">{value.toFixed(0)}</span>
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={config.min}
        max={config.max}
        step={config.step}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          setValue(next);
          emit(next);
        }}
        onPointerUp={() => {
          if (config.returnMode !== 'center') return;
          setValue(config.start);
          emit(config.start);
        }}
        className={`accent-[var(--primary)] ${config.direction === 'vertical' ? 'h-28 w-6 [writing-mode:vertical-lr] [-webkit-appearance:slider-vertical]' : 'w-full'}`}
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
        <span>{config.min}</span>
        <span className="opacity-80">
          {command} &middot; {access} &middot; {cooldownMs}ms{config.resetAfterMs ? ` \u00b7 reset ${config.resetAfterMs}ms` : ''}
        </span>
        <span>{config.max}</span>
      </div>
    </div>
  );
}

export function XYPadControl({
  label,
  command,
  config,
  color,
  cooldownMs,
  access,
  isCrowd,
  disabled,
  queueResetEpoch,
  offlineResetEpoch,
  onSendValue,
}: {
  label: string;
  command: string;
  config: XYWidgetConfig;
  color: string | null;
  cooldownMs: number;
  access: string;
  isCrowd: boolean;
  disabled: boolean;
  queueResetEpoch: number;
  offlineResetEpoch: number;
  onSendValue: (value: { x: number; y: number }) => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number }>({ x: config.xStart, y: config.yStart });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPoint({ x: config.xStart, y: config.yStart });
  }, [config.xStart, config.yStart, config.xMin, config.xMax, config.yMin, config.yMax, command]);

  useEffect(() => {
    if (!config.resetOnQueueLoss || queueResetEpoch === 0) return;
    const nextPoint = { x: config.xStart, y: config.yStart };
    setPoint(nextPoint);
    onSendValue(nextPoint);
  }, [config.resetOnQueueLoss, config.xStart, config.yStart, onSendValue, queueResetEpoch]);

  useEffect(() => {
    if (!config.resetOnOffline || offlineResetEpoch === 0) return;
    const nextPoint = { x: config.xStart, y: config.yStart };
    setPoint(nextPoint);
    onSendValue(nextPoint);
  }, [config.resetOnOffline, config.xStart, config.yStart, onSendValue, offlineResetEpoch]);

  useEffect(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    const isAtStart = point.x === config.xStart && point.y === config.yStart;
    if (config.resetAfterMs === null || isAtStart) return;

    resetTimerRef.current = setTimeout(() => {
      const nextPoint = { x: config.xStart, y: config.yStart };
      setPoint(nextPoint);
      onSendValue(nextPoint);
      resetTimerRef.current = null;
    }, config.resetAfterMs);

    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [config.resetAfterMs, config.xStart, config.yStart, onSendValue, point.x, point.y]);

  const toPercent = (value: number, min: number, max: number) => ((value - min) / (max - min)) * 100;

  const sendPoint = useCallback((nextPoint: { x: number; y: number }) => { onSendValue(nextPoint); }, [onSendValue]);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = padRef.current?.getBoundingClientRect();
      if (!rect) return;

      const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
      const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
      const x = config.xMin + nx * (config.xMax - config.xMin);
      const y = config.yMax - ny * (config.yMax - config.yMin);
      const nextPoint = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      setPoint(nextPoint);
      sendPoint(nextPoint);
    },
    [config.xMax, config.xMin, config.yMax, config.yMin, sendPoint],
  );

  const resetToStart = useCallback(() => {
    if (config.returnMode !== 'center') return;
    const nextPoint = { x: config.xStart, y: config.yStart };
    setPoint(nextPoint);
    sendPoint(nextPoint);
  }, [config.returnMode, config.xStart, config.yStart, sendPoint]);

  const cx = toPercent(point.x, config.xMin, config.xMax);
  const cy = 100 - toPercent(point.y, config.yMin, config.yMax);

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        isCrowd ? 'border-amber-500 bg-amber-500/10' : 'border-[var(--border)] bg-[var(--muted)]'
      }`}
      style={color ? { borderColor: color } : undefined}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">{label}</p>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          x {point.x.toFixed(0)} &middot; y {point.y.toFixed(0)}
        </span>
      </div>
      <div
        ref={padRef}
        role="slider"
        aria-label={`${label} XY pad`}
        aria-valuetext={`x ${point.x.toFixed(0)}, y ${point.y.toFixed(0)}`}
        aria-valuemin={config.xMin}
        aria-valuemax={config.xMax}
        aria-valuenow={point.x}
        tabIndex={disabled ? -1 : 0}
        className="relative h-32 w-32 touch-none rounded border border-[var(--border)] bg-[var(--background)]"
        onPointerDown={(event) => {
          if (disabled) return;
          (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (disabled) return;
          if ((event.buttons & 1) === 0) return;
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={resetToStart}
        onPointerCancel={resetToStart}
        onKeyDown={(event) => {
          if (disabled) return;
          const xStep = Math.max(1, (config.xMax - config.xMin) / 20);
          const yStep = Math.max(1, (config.yMax - config.yMin) / 20);
          let nextPoint = point;
          if (event.key === 'ArrowLeft') nextPoint = { ...point, x: clamp(point.x - xStep, config.xMin, config.xMax) };
          else if (event.key === 'ArrowRight') nextPoint = { ...point, x: clamp(point.x + xStep, config.xMin, config.xMax) };
          else if (event.key === 'ArrowDown') nextPoint = { ...point, y: clamp(point.y - yStep, config.yMin, config.yMax) };
          else if (event.key === 'ArrowUp') nextPoint = { ...point, y: clamp(point.y + yStep, config.yMin, config.yMax) };
          else if (event.key === 'Home') nextPoint = { x: config.xStart, y: config.yStart };
          else return;
          event.preventDefault();
          setPoint(nextPoint);
          sendPoint(nextPoint);
        }}
      >
        <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-[var(--border)]" />
        <div className="absolute left-1/2 top-1/2 h-full w-px -translate-y-1/2 bg-[var(--border)]" />
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)]"
          style={{ left: `${cx}%`, top: `${cy}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
        {command} &middot; {access} &middot; {cooldownMs}ms{config.resetAfterMs ? ` \u00b7 reset ${config.resetAfterMs}ms` : ''}
      </div>
    </div>
  );
}

export function ControlKey({
  label,
  hotKey,
  command,
  isDown,
  isCrowd,
  disabled,
  onPress,
  onRelease,
}: {
  label: string;
  hotKey: string;
  command: string;
  isDown: boolean;
  isCrowd: boolean;
  disabled?: boolean;
  onPress: () => void;
  onRelease?: () => void;
}) {
  const isMotionKey = ['forward', 'backward', 'left', 'right'].includes(command);
  const handleKeyboardPress = () => {
    if (!disabled) {
      onPress();
    }
  };
  const handleKeyboardRelease = () => {
    if (!disabled && isMotionKey) {
      onRelease?.();
    }
  };

  return (
    <button
      type="button"
      aria-label={`${label} control button`}
      onPointerDown={disabled ? undefined : onPress}
      onPointerUp={disabled || !isMotionKey ? undefined : onRelease}
      onPointerCancel={disabled || !isMotionKey ? undefined : onRelease}
      onPointerLeave={disabled || !isMotionKey ? undefined : onRelease}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault();
          handleKeyboardPress();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleKeyboardRelease();
        }
      }}
      title={hotKey.toUpperCase()}
      disabled={disabled}
      className={`flex h-16 w-16 touch-none items-center justify-center rounded-2xl border text-base font-bold transition select-none sm:h-14 sm:w-14 sm:rounded-xl sm:text-sm lg:h-11 lg:w-11 lg:rounded-lg lg:text-sm ${
        disabled
          ? 'cursor-not-allowed border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] opacity-50'
          : isDown
          ? 'border-[var(--primary)] bg-[var(--primary)] text-white scale-95'
          : isCrowd
          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
          : 'border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--primary)] hover:border-[var(--primary)] hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

export function formatCountdown(valueMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
