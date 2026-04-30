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

      {!state.connected && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium text-amber-200">
            {state.reconnectNotice?.message ??
              'Realtime connection lost. Controls and chat are temporarily unavailable.'}
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            {state.reconnectSeconds !== null
              ? `Reconnecting in about ${state.reconnectSeconds}s.`
              : 'BotParty will reconnect automatically as soon as the room is reachable again.'}
          </p>
        </div>
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
