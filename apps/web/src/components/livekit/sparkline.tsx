'use client';

import { formatStat, getSparklineBounds, buildSparklinePath } from './stats-utils';

export function Sparkline({
  label,
  value,
  suffix,
  values,
  stroke,
  baseline = 0,
  minRange = 1,
}: {
  label: string;
  value: number | null;
  suffix: string;
  values: Array<number | null>;
  stroke: string;
  baseline?: number;
  minRange?: number;
}) {
  const width = 132;
  const height = 36;
  const bounds = getSparklineBounds(values, { baseline, minRange });
  const path = buildSparklinePath(values, width, height, bounds);

  return (
    <div className="rounded-xl border border-white/8 bg-white/4 px-2 py-2">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
        <p className="text-xs font-semibold text-white">{formatStat(value, suffix)}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full overflow-visible">
        <path
          d={`M 0 ${height} L ${width} ${height}`}
          fill="none"
          stroke="rgba(148, 163, 184, 0.22)"
          strokeWidth="1"
        />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <text x="0" y="22" fill="rgba(148, 163, 184, 0.8)" fontSize="10">
            collecting...
          </text>
        )}
      </svg>
    </div>
  );
}
