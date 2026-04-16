'use client';

import { Check } from 'lucide-react';

const accessModeOptions: Array<{
  value: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  title: string;
  description: string;
}> = [
  { value: 'ALL', title: 'Everyone', description: 'All visitors, including guests' },
  { value: 'AUTHENTICATED', title: 'Signed-in only', description: 'Only logged-in users' },
  { value: 'DISABLED', title: 'Disabled', description: 'Nobody (except owner)' },
];

export function AclPicker({
  title,
  value,
  onChange,
}: {
  title: string;
  value: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  onChange: (value: 'ALL' | 'AUTHENTICATED' | 'DISABLED') => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</p>
      <div className="flex flex-wrap gap-2">
        {accessModeOptions.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                active
                  ? 'border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--foreground)]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title={option.description}
            >
              {active && <Check className="h-3 w-3" />}
              {option.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
