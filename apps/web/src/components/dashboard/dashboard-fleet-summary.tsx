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

  const stats = [
    { label: 'Total robots', value: String(robots.length) },
    { label: 'Live now', value: String(liveCount) },
    { label: 'Busy', value: String(busyCount) },
    { label: 'Offline', value: String(offlineCount) },
    { label: 'Current viewers', value: String(totalViewers) },
    { label: 'Selected robot', value: selectedRobot?.name ?? 'None selected' },
  ];

  return (
    <div className="mb-5 grid grid-cols-2 border-y border-[var(--border)] sm:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => (
        <div key={stat.label} className="border-b border-[var(--border)] px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
          <p className="text-xs text-[var(--muted-foreground)]">
            {stat.label}
          </p>
          <p className="mt-1 truncate text-base font-semibold text-[var(--foreground)]">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
