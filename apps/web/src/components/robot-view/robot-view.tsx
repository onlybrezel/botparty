'use client';

import dynamic from 'next/dynamic';
import type { RobotPublic } from '@botparty/shared';
import { RobotPageHeader } from '@/components/robot-view/robot-page-header';
import { RobotViewMainColumn } from '@/components/robot-view/robot-view-main-column';
import { RobotViewMobileBar } from '@/components/robot-view/robot-view-mobile-bar';
import { RobotViewSidebar } from '@/components/robot-view/robot-view-sidebar';
import { useRobotViewState } from '@/components/robot-view/use-robot-view-state';

const RoomOnboardingOverlay = dynamic(
  () =>
    import('@/components/robot-view/room-onboarding-overlay').then(
      (module) => module.RoomOnboardingOverlay,
    ),
  {
    ssr: false,
  },
);

interface Props {
  robot: RobotPublic;
}

export function RobotView({ robot }: Props) {
  const state = useRobotViewState(robot);

  return (
    <div className="safe-pb mx-auto max-w-7xl px-4 py-4 pb-24 sm:py-6 lg:pb-6">
      <RobotPageHeader
        robotName={state.robot.name}
        connected={state.connected}
        viewerLabel={state.viewerLabel}
        reconnectNotice={state.reconnectNotice}
        reconnectSeconds={state.reconnectSeconds}
        robotStatus={state.robotStatus}
        queueSummary={state.queueSummary}
      />

      {state.showRoomOnboarding && (
        <RoomOnboardingOverlay
          queueEnabled={state.queueEnabled}
          signedIn={Boolean(state.accessToken)}
          onDismiss={state.dismissRoomOnboarding}
        />
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <RobotViewMainColumn state={state} />
        <RobotViewSidebar state={state} />
      </div>

      <RobotViewMobileBar state={state} />
    </div>
  );
}

export default RobotView;
