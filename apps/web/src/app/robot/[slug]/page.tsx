import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { RobotPublic } from '@botparty/shared';
import RobotView from './robot-view';

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const robot = await getRobot(slug);
  if (!robot) return { title: 'Robot not found' };
  return {
    title: robot.name,
    description: robot.description ?? `Watch and control ${robot.name} live on BotParty.`,
  };
}

export default async function RobotPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const robot = await getRobot(slug);

  if (!robot) notFound();

  return <RobotView robot={robot} />;
}


