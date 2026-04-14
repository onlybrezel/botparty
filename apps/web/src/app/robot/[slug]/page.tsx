import { permanentRedirect } from 'next/navigation';
import type { RobotPublic } from '@botparty/shared';
import PrivateRobotClient from './private-robot-client';

async function getRobot(slug: string): Promise<RobotPublic | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots/${slug}`, {
      next: { revalidate: 10 },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json() as Promise<RobotPublic>;
  } catch {
    return null;
  }
}

export default async function RobotPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const robot = await getRobot(slug);

  if (!robot) {
    return <PrivateRobotClient slug={slug} />;
  }

  permanentRedirect(`/robot/${robot.owner.username}/${robot.slug}`);
}
