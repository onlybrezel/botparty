import { Role } from '@botparty/shared';
import { ROLES_KEY } from './decorators/roles.decorator';
import { UsersController } from '../users/users.controller';
import { RobotsController } from '../robots/robots.controller';
import { BillingController } from '../billing/billing.controller';
import { PayoutsController } from '../earnings/payouts.controller';
import { ModerationController } from '../moderation/moderation.controller';

type ControllerPrototype = Record<string, (...args: never[]) => unknown>;

function roles(controller: { prototype: ControllerPrototype }, method: string): Role[] {
  const handler = controller.prototype[method];
  if (!handler) throw new Error(`Missing controller method: ${method}`);
  return Reflect.getMetadata(ROLES_KEY, handler) ?? [];
}

describe('staff capability matrix', () => {
  it.each([
    [UsersController, 'updateAdminUser'],
    [UsersController, 'deleteAdminUser'],
    [RobotsController, 'updateAsStaff'],
    [RobotsController, 'deleteAsStaff'],
    [BillingController, 'listWebhookEvents'],
    [BillingController, 'replayWebhookEvent'],
    [PayoutsController, 'listReview'],
    [PayoutsController, 'approve'],
    [PayoutsController, 'reject'],
    [PayoutsController, 'markPaid'],
    [PayoutsController, 'revealDestination'],
    [ModerationController, 'getAdminRobotRecordingStatus'],
    [ModerationController, 'startAdminRobotRecording'],
    [ModerationController, 'stopAdminRobotRecording'],
    [ModerationController, 'listAdminRecordings'],
  ])('%s.%s is restricted to administrators', (controller, method) => {
    expect(roles(controller as never, method as string)).toEqual([Role.ADMIN]);
  });

  it.each([
    [UsersController, 'getAdminUsers'],
    [ModerationController, 'getAdminOverview'],
    [ModerationController, 'getAdminRuntimeOverview'],
    [ModerationController, 'getAdminProfanityOverview'],
  ])('%s.%s remains available to the moderation role', (controller, method) => {
    expect(roles(controller as never, method as string)).toEqual([Role.ADMIN, Role.MOD]);
  });
});
