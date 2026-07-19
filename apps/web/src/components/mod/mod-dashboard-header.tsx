'use client';

import { ChevronRight, RefreshCw, Shield, type LucideIcon } from 'lucide-react';
import { formatBitrate, secondaryButtonClass } from './utils';
import type { ModView } from './mod-dashboard-model';

type OverviewCard = {
  key: string;
  label: string;
  value: string | number;
  detail: string;
  accent: string;
  icon: LucideIcon;
};

type ActionItem = { title: string; detail: string; view: ModView };
type ViewButton = { id: ModView; label: string; description: string; icon: LucideIcon };

type Props = {
  refreshing: boolean;
  onRefresh: () => void;
  overviewCards: OverviewCard[];
  actionItems: ActionItem[];
  generatedAt?: string;
  ingressKbps?: number;
  egressKbps?: number;
  activeView: ModView;
  onActiveViewChange: (view: ModView) => void;
  viewButtons: ViewButton[];
};

export function ModDashboardHeader({
  refreshing,
  onRefresh,
  overviewCards,
  actionItems,
  generatedAt,
  ingressKbps,
  egressKbps,
  activeView,
  onActiveViewChange,
  viewButtons,
}: Props) {
  return (
    <>
      <header className="mb-6 border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
              <Shield className="h-4 w-4" />
              Staff console
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Moderation</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Review reports, operate robots and manage staff access.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-[var(--muted-foreground)] sm:block">
              Updated {generatedAt ? new Date(generatedAt).toLocaleTimeString() : '-'}
            </p>
            <button type="button" onClick={onRefresh} disabled={refreshing} className={secondaryButtonClass}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Updating...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 border-y border-[var(--border)] md:grid-cols-3 xl:grid-cols-6">
          {overviewCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.key} className="border-b border-[var(--border)] px-3 py-3 md:border-r xl:border-b-0 xl:last:border-r-0">
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <Icon className={`h-3.5 w-3.5 ${card.accent}`} />
                  {card.label}
                </div>
                <p className="mt-1 text-xl font-semibold">{card.value}</p>
                <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]" title={card.detail}>{card.detail}</p>
              </div>
            );
          })}
        </div>
      </header>

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="border border-[var(--border)] bg-[var(--card)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Needs attention</h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {actionItems.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">Nothing needs immediate action.</p>
            ) : (
              actionItems.map((item, index) => (
                <button
                  key={`${item.title}-${index}`}
                  type="button"
                  onClick={() => onActiveViewChange(item.view)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{item.detail}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 border border-[var(--border)] bg-[var(--card)] lg:grid-cols-1 lg:divide-y lg:divide-[var(--border)]">
          <div className="border-r border-[var(--border)] p-4 lg:border-r-0">
            <p className="text-xs text-[var(--muted-foreground)]">Platform ingress</p>
            <p className="mt-1 text-lg font-semibold">{formatBitrate(ingressKbps)}</p>
          </div>
          <div className="p-4">
            <p className="text-xs text-[var(--muted-foreground)]">Platform egress</p>
            <p className="mt-1 text-lg font-semibold">{formatBitrate(egressKbps)}</p>
          </div>
        </div>
      </section>

      <nav aria-label="Moderation sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {viewButtons.map((view) => {
          const Icon = view.icon;
          const active = activeView === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onActiveViewChange(view.id)}
              aria-pressed={active}
              title={view.description}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                active
                  ? 'border-sky-400 text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {view.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
