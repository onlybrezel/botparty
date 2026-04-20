'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RobotView from '../[slug]/robot-view';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { RobotRoomSkeleton } from '@/components/robot-view/robot-room-skeleton';
import type { RobotPublic } from '@botparty/shared';

function canonicalRobotPath(robot: RobotPublic): string {
  return `/robot/${robot.owner.username}/${robot.slug}`;
}

export default function PrivateRobotClient({
  username,
  slug,
}: {
  username: string | null;
  slug: string;
}) {
  const router = useRouter();
  const { accessToken, hasHydrated } = useAuth();
  const [robot, setRobot] = useState<RobotPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (!accessToken) {
      setLoading(false);
      setError('Sign in to access this private robot.');
      return;
    }

    let active = true;
    api.setToken(accessToken);

    const request = username
      ? api.robots.getPrivateRobot(username, slug)
      : api.robots.getPrivateRobotBySlug(slug);

    request
      .then((result) => {
        if (!active) return;
        setRobot(result);
        setError(null);

        const target = canonicalRobotPath(result);
        if (username !== result.owner.username || slug !== result.slug) {
          router.replace(target);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Private robot could not be loaded.');
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [accessToken, hasHydrated, router, slug, username]);

  if (loading) {
    return <RobotRoomSkeleton />;
  }

  if (!robot) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h1 className="text-xl font-bold">Private robot</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {error ?? 'This robot is not available.'}
          </p>
          {!accessToken && (
            <Link
              href="/login"
              className="mt-4 inline-flex rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    );
  }

  return <RobotView robot={robot} />;
}
