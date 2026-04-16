import type { ReactNode } from 'react';

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl shadow-black/40"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-lg font-bold text-[var(--foreground)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
