'use client';

import dynamic from 'next/dynamic';
import type { RobotPublic } from '@botparty/shared';
import { RobotRoomSkeleton } from './robot-room-skeleton';

const RobotView = dynamic(() => import('./robot-view'), {
  ssr: false,
  loading: () => <RobotRoomSkeleton />,
});

export function OnlineRobotViewLoader({ robot }: { robot: RobotPublic }) {
  return <RobotView robot={robot} />;
}
