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
}: {
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
}) {
  return (
    <>
      <section className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)]">
        <div className="grid gap-0 xl:grid-cols-[1.35fr,0.95fr]">
          <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0))] p-6 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-sky-300">Staff Console</p>
                <h1 className="mt-2 flex items-center gap-3 text-3xl font-black tracking-tight">
                  <span className="rounded-2xl border border-sky-400/30 bg-sky-400/10 p-2">
                    <Shield className="h-7 w-7 text-sky-300" />
                  </span>
                  Mod Dashboard
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-[var(--muted-foreground)]">
                  Moderation comes first. Runtime, robot admin and staff user management are separated into focused work areas.
                </p>
              </div>
              <button type="button" onClick={onRefresh} disabled={refreshing} className={secondaryButtonClass}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Updating...' : 'Update'}
              </button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overviewCards.map((card) => {
                const Icon = card.icon;
                return (
                  <article
                    key={card.key}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--background)]/90 p-4 backdrop-blur transition-transform duration-200 motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.01]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
                      <Icon className={`h-4 w-4 ${card.accent}`} />
                    </div>
                    <p className="mt-3 text-2xl font-black">{card.value}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{card.detail}</p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Action Queue</h2>
                <p className="text-sm text-[var(--muted-foreground)]">Shortcuts into the area that currently needs attention.</p>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Snapshot {generatedAt ? new Date(generatedAt).toLocaleTimeString() : '-'}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {actionItems.map((item, index) => (
                <button
                  key={`${item.title}-${index}`}
                  type="button"
                  onClick={() => onActiveViewChange(item.view)}
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-left transition hover:border-sky-400/40 hover:bg-sky-500/5 motion-safe:hover:translate-x-1"
                >
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.detail}</p>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 text-[var(--muted-foreground)]" />
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Platform traffic</p>
                <p className="mt-2 text-lg font-bold">{formatBitrate(ingressKbps)}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Ingress across tracked containers</p>
                <p className="mt-3 text-lg font-bold">{formatBitrate(egressKbps)}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Egress across tracked containers</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Current focus</p>
                <p className="mt-2 text-lg font-bold capitalize">{activeView}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {viewButtons.find((view) => view.id === activeView)?.description ?? 'No section selected.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {viewButtons.map((view) => {
            const Icon = view.icon;
            const active = activeView === view.id;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => onActiveViewChange(view.id)}
                className={`rounded-2xl border px-4 py-4 text-left transition-transform duration-200 motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.01] ${
                  active
                    ? 'border-sky-400/50 bg-sky-500/12 shadow-[0_14px_30px_rgba(14,165,233,0.12),inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'border-[var(--border)] bg-[var(--card)] hover:border-sky-400/30 hover:bg-sky-500/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded-xl p-2 ${active ? 'bg-sky-400/10 text-sky-300' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{view.label}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{view.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
