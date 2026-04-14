import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { RobotPublic } from '@botparty/shared';
import RobotView from '../[slug]/robot-view';
import PrivateRobotClient from './private-robot-client';

function buildRobotDescription(robot: RobotPublic): string {
  const fallback = `Watch and control ${robot.name} live on BotParty.`;
  const description = robot.description?.trim() || fallback;
  return description.length <= 160 ? description : `${description.slice(0, 157).trimEnd()}...`;
}

function parseParts(parts: string[]): { username: string | null; slug: string } | null {
  if (parts.length === 1) {
    return { username: null, slug: parts[0] ?? '' };
  }
  if (parts.length === 2) {
    return { username: parts[0] ?? null, slug: parts[1] ?? '' };
  }
  return null;
}

function canonicalRobotPath(robot: RobotPublic): string {
  return `/robot/${robot.owner.username}/${robot.slug}`;
}

async function getRobot(username: string | null, slug: string): Promise<RobotPublic | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const endpoint = username
    ? `${apiUrl}/api/v1/robots/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`
    : `${apiUrl}/api/v1/robots/${encodeURIComponent(slug)}`;

  try {
    const res = await fetch(endpoint, { next: { revalidate: 10 } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json() as Promise<RobotPublic>;
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
  if (!parsed) return { title: 'Robot not found' };

  const robot = await getRobot(parsed.username, parsed.slug);
  if (!robot) return { title: 'Robot not found' };

  const canonicalUrl = canonicalRobotPath(robot);
  const title = robot.name;
  const description = buildRobotDescription(robot);
  const previewImages = robot.thumbnailUrl
    ? [
        {
          url: robot.thumbnailUrl,
          alt: `${robot.name} on BotParty`,
        },
      ]
    : [
        {
          url: '/brand/og-default.png',
          width: 1200,
          height: 630,
          alt: 'BotParty robot social preview',
        },
      ];

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${title} | BotParty`,
      description,
      url: canonicalUrl,
      type: 'website',
      siteName: 'BotParty',
      images: previewImages,
    },
    twitter: {
      card: robot.thumbnailUrl ? 'summary_large_image' : 'summary',
      title: `${title} | BotParty`,
      description,
      images: robot.thumbnailUrl ? [robot.thumbnailUrl] : ['/brand/og-default.png'],
    },
  };
}

export default async function RobotPage({
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
    return <PrivateRobotClient username={parsed.username} slug={parsed.slug} />;
  }

  const canonical = canonicalRobotPath(robot);
  if (parsed.username !== robot.owner.username || parsed.slug !== robot.slug) {
    permanentRedirect(canonical);
  }

  return <RobotView robot={robot} />;
}
