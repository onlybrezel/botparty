'use client';

import type { RobotManaged } from '@/lib/api';

type Props = {
  robots: RobotManaged[];
  selectedId: string | null;
};

export function DashboardFleetSummary({ robots, selectedId }: Props) {
  const liveCount = robots.filter((robot) => robot.status === 'ONLINE' || robot.status === 'BUSY').length;
  const busyCount = robots.filter((robot) => robot.status === 'BUSY').length;
  const offlineCount = robots.filter((robot) => robot.status === 'OFFLINE').length;
  const totalViewers = robots.reduce((sum, robot) => sum + robot.viewerCount, 0);
  const selectedRobot = robots.find((robot) => robot.id === selectedId) ?? null;

  const cards = [
    { label: 'Total robots', value: String(robots.length) },
    { label: 'Live now', value: String(liveCount) },
    { label: 'Busy', value: String(busyCount) },
    { label: 'Offline', value: String(offlineCount) },
    { label: 'Current viewers', value: String(totalViewers) },
    { label: 'Selected robot', value: selectedRobot?.name ?? 'None selected' },
  ];

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {card.label}
          </p>
          <p className="mt-2 text-lg font-bold text-[var(--foreground)]">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
