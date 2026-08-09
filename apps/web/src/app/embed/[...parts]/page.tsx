import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { RobotPublic } from '@botparty/shared';
import { EmbedRobotView } from '@/components/embed-robot-view';
import { getServerApiUrl } from '@/lib/server-api-url';
import { isRobotPublic } from '@/lib/api-response-guards';

function parseParts(parts: string[]): { username: string | null; slug: string } | null {
  if (parts.length === 1) {
    return { username: null, slug: parts[0] ?? '' };
  }
  if (parts.length === 2) {
    return { username: parts[0] ?? null, slug: parts[1] ?? '' };
  }
  return null;
}

async function getRobot(username: string | null, slug: string): Promise<RobotPublic | null> {
  const apiUrl = getServerApiUrl();
  const endpoint = username
    ? `${apiUrl}/api/v1/robots/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`
    : `${apiUrl}/api/v1/robots/${encodeURIComponent(slug)}`;

  try {
    const res = await fetch(endpoint, { next: { revalidate: 10 } });
    if (!res.ok) {
      return null;
    }
    const payload: unknown = await res.json();
    return isRobotPublic(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ parts: string[] }>;
}): Promise<Metadata> {
  const { parts } = await params;
  const parsed = parseParts(parts);
  if (!parsed) {
    return { title: 'Embedded robot' };
  }

  const robot = await getRobot(parsed.username, parsed.slug);
  return {
    title: robot ? `${robot.name} embed` : 'Embedded robot',
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function EmbedRobotPage({
  params,
}: {
  params: Promise<{ parts: string[] }>;
}) {
  const { parts } = await params;
  const parsed = parseParts(parts);
  if (!parsed) {
    notFound();
  }

  const robot = await getRobot(parsed.username, parsed.slug);
  if (!robot) {
    notFound();
  }

  return <EmbedRobotView robot={robot} />;
}
