import type { RobotPublic } from '@botparty/shared';
import RobotView from '@/components/robot-view/robot-view';

interface Props {
  robot: RobotPublic;
}

export default function RobotRouteView({ robot }: Props) {
  return <RobotView robot={robot} />;
}
