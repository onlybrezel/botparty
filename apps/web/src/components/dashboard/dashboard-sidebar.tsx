'use client';

import { Save, Trash2 } from 'lucide-react';
import type { RefObject } from 'react';
import type { RobotManaged } from '@/lib/api';
import { DASHBOARD_SECTIONS } from './types';

type Props = {
  robots: RobotManaged[];
  selectedId: string | null;
  activeSectionId: string;
  saving: boolean;
  deleting: boolean;
  editFormRef: RefObject<HTMLFormElement | null>;
  onSelect: (id: string) => void;
  onSectionSelect: (id: string) => void;
  onDelete: () => void;
};

export function DashboardSidebar({
  robots,
  selectedId,
  activeSectionId,
  saving,
  deleting,
  editFormRef,
  onSelect,
  onSectionSelect,
  onDelete,
}: Props) {
  return (
    <aside className="hidden w-[200px] shrink-0 lg:block">
      <div className="pb-1 flex flex-col gap-3">
        <div className="space-y-1.5">
          {robots.map((robot) => {
            const seed = robot.slug.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0);
            const hue = seed % 360;
            return (
              <button
                key={robot.id}
                type="button"
                onClick={() => onSelect(robot.id)}
                aria-label={`Select robot ${robot.name}`}
                className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                  selectedId === robot.id
                    ? 'border-violet-500/50 bg-violet-500/10 text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg, hsla(${hue}, 75%, 55%, 0.5), hsla(${(hue + 50) % 360}, 80%, 50%, 0.3))`,
                  }}
                >
                  {robot.name.trim().charAt(0).toUpperCase()}
                </div>
                <span className="min-w-0 flex-1 truncate font-medium">{robot.name}</span>
                {robot.status === 'ONLINE' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
              </button>
            );
          })}
        </div>

        <div className="space-y-0.5 border-t border-[var(--border)] pt-3">
          {DASHBOARD_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionSelect(section.id)}
              aria-label={`Jump to ${section.label} section`}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition ${
                activeSectionId === section.id
                  ? 'bg-violet-500/10 text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>

        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => editFormRef.current?.requestSubmit()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </aside>
  );
}
