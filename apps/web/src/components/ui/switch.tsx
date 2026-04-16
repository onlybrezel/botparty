import type { InputHTMLAttributes } from 'react';

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  description?: string;
};

export function Switch({ label, description, className = '', ...props }: SwitchProps) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
        {description ? (
          <span className="mt-1 block text-xs text-[var(--muted-foreground)]">{description}</span>
        ) : null}
      </span>
      <span className="relative inline-flex shrink-0 items-center">
        <input {...props} type="checkbox" className="peer sr-only" />
        <span className="h-6 w-11 rounded-full bg-[var(--muted)] transition peer-checked:bg-[var(--primary)]" />
        <span className="pointer-events-none absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
