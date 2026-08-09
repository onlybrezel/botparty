import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { RobotPublic } from '@botparty/shared';
import { PrivateRobotLoader } from '@/components/robot-view/private-robot-loader';
import { OfflineRobotView } from '@/components/robot-view/offline-robot-view';
import { OnlineRobotViewLoader } from '@/components/robot-view/online-robot-view-loader';
import {
  buildRobotDescription,
  buildRobotLookupUrl,
  canonicalRobotPath,
  parseRobotRouteParts,
  shouldRedirectToCanonical,
} from '@/lib/robot-route';
import { getServerApiUrl } from '@/lib/server-api-url';
import { isRobotPublic } from '@/lib/api-response-guards';

async function getRobot(route: {
  username: string | null;
  slug: string;
}): Promise<RobotPublic | null> {
  try {
    const res = await fetch(buildRobotLookupUrl(getServerApiUrl(), route), {
      next: { revalidate: 10 },
    });
    if (res.status === 404 || !res.ok) {
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
  const route = parseRobotRouteParts(parts);
  if (!route) {
    return { title: 'Robot not found' };
  }

  const robot = await getRobot(route);
  if (!robot) {
    return { title: 'Robot not found' };
  }

  const canonicalUrl = canonicalRobotPath(robot);
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
    title: robot.name,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${robot.name} | BotParty`,
      description,
      url: canonicalUrl,
      type: 'website',
      siteName: 'BotParty',
      images: previewImages,
    },
    twitter: {
      card: robot.thumbnailUrl ? 'summary_large_image' : 'summary',
      title: `${robot.name} | BotParty`,
      description,
      images: robot.thumbnailUrl ? [robot.thumbnailUrl] : ['/brand/og-default.png'],
    },
  };
}

export default async function RobotPage({ params }: { params: Promise<{ parts: string[] }> }) {
  const { parts } = await params;
  const route = parseRobotRouteParts(parts);
  if (!route) {
    notFound();
  }

  const robot = await getRobot(route);
  if (!robot) {
    return <PrivateRobotLoader slug={route.slug} username={route.username} />;
  }

  if (shouldRedirectToCanonical(route, robot)) {
    permanentRedirect(canonicalRobotPath(robot));
  }

  return robot.status === 'ONLINE' || robot.status === 'BUSY'
    ? <OnlineRobotViewLoader robot={robot} />
    : <OfflineRobotView robot={robot} />;
}
