import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import type { RobotPublic } from '@botparty/shared';
import RobotView from '../../[slug]/robot-view';
import PrivateRobotClient from './private-robot-client';

function buildRobotDescription(robot: RobotPublic): string {
  const fallback = `Watch and control ${robot.name} live on BotParty.`;
  const description = robot.description?.trim() || fallback;
  return description.length <= 160 ? description : `${description.slice(0, 157).trimEnd()}...`;
}

async function getRobot(username: string, slug: string): Promise<RobotPublic | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/robots/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
      {
        next: { revalidate: 10 },
      },
    );
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
  params: Promise<{ username: string; slug: string }>;
}): Promise<Metadata> {
  const { username, slug } = await params;
  const robot = await getRobot(username, slug);
  if (!robot) return { title: 'Robot not found' };

  const canonicalUrl = `/robot/${robot.owner.username}/${robot.slug}`;
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
  params: Promise<{ username: string; slug: string }>;
}) {
  const { username, slug } = await params;
  const robot = await getRobot(username, slug);

  if (!robot) {
    return <PrivateRobotClient username={username} slug={slug} />;
  }

  if (robot.owner.username !== username || robot.slug !== slug) {
    permanentRedirect(`/robot/${robot.owner.username}/${robot.slug}`);
  }

  return <RobotView robot={robot} />;
}
