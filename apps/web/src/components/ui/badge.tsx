import type { ReactNode } from 'react';

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}
