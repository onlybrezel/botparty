import { TurnHandler } from './turn.handler';
import type { TurnHandlerContext } from './turn.handler';
import type { ActiveTurnState } from './gateway-types';

type TurnHandlerParameters = ConstructorParameters<typeof TurnHandler>;

const makeTurn = (input: Pick<ActiveTurnState, 'sessionId' | 'userId' | 'startedAt' | 'expiresAt'> & Partial<ActiveTurnState>): ActiveTurnState => ({
  ownerId: 'instance-a',
  fencingToken: 1,
  leaseExpiresAt: Date.now() + 15_000,
  ...input,
});

const makeContext = (
  overrides: Partial<Omit<TurnHandlerContext, 'robotClients'>> = {},
): Omit<TurnHandlerContext, 'robotClients'> & {
  activeTurns: Map<string, ActiveTurnState>;
  turnTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  robotClients: Set<string>;
} => {
  const activeTurns = new Map<string, ActiveTurnState>();
  const turnTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const robotClients = new Set<string>();

  return {
    activeTurns,
    turnTimeouts,
    robotClients,
    getActiveTurn: jest.fn(async (robotId: string) => activeTurns.get(robotId) ?? null),
    hasLocalActiveTurn: jest.fn((robotId: string) => activeTurns.has(robotId)),
    isTurnOwner: jest.fn((state: ActiveTurnState) => state.ownerId === 'instance-a'),
    acquireActiveTurn: jest.fn(async (robotId: string, state: ActiveTurnState) => {
      const acquired = makeTurn({ ...state, ownerId: 'instance-a', fencingToken: 2 });
      activeTurns.set(robotId, acquired);
      return acquired;
    }),
    clearActiveTurn: jest.fn(async (robotId: string) => {
      const current = activeTurns.get(robotId) ?? null;
      activeTurns.delete(robotId);
      return current;
    }),
    getTurnTimeout: jest.fn((robotId: string) => turnTimeouts.get(robotId)),
    setTurnTimeout: jest.fn((robotId: string, timer: ReturnType<typeof setTimeout>) => {
      turnTimeouts.set(robotId, timer);
    }),
    clearTurnTimeout: jest.fn((robotId: string) => {
      const timer = turnTimeouts.get(robotId);
      if (timer) {
        clearTimeout(timer);
      }
      turnTimeouts.delete(robotId);
    }),
    broadcastToRoom: jest.fn(),
    sendRobotStop: jest.fn(),
    revokeController: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
};

const mockRobotsService = {
  findById: jest.fn(),
  updateStatus: jest.fn().mockResolvedValue(undefined),
};

const mockSessionsService = {
  create: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  findActiveForTurnRecovery: jest.fn().mockResolvedValue(null),
};

const mockQueueService = {
  leave: jest.fn().mockResolvedValue(undefined),
};

const mockNotifications = {
  publishSafely: jest.fn().mockResolvedValue(null),
};

function createHandler(
  context: TurnHandlerParameters[0],
  robots: TurnHandlerParameters[1] = mockRobotsService,
  sessions: TurnHandlerParameters[2] = mockSessionsService,
  queue: TurnHandlerParameters[3] = mockQueueService,
  notifications: TurnHandlerParameters[4] = mockNotifications,
): TurnHandler {
  return new TurnHandler(context, robots, sessions, queue, notifications);
}

describe('TurnHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('clearTurnState', () => {
    it('is a no-op if no active turn exists', async () => {
      const ctx = makeContext();
      const handler = createHandler(ctx);

      await handler.clearTurnState('robot-1');

      expect(ctx.broadcastToRoom).not.toHaveBeenCalled();
      expect(ctx.sendRobotStop).not.toHaveBeenCalled();
    });

    it('broadcasts session end and turn end when active turn exists', async () => {
      const ctx = makeContext();
      ctx.activeTurns.set('robot-1', makeTurn({
        sessionId: 'session-1',
        userId: 'user-1',
        startedAt: Date.now() - 5000,
        expiresAt: Date.now() + 5000,
      }));

      const handler = createHandler(ctx);
      await handler.clearTurnState('robot-1', 'timeout');

      expect(ctx.sendRobotStop).toHaveBeenCalledWith('robot-1', 'Turn ended: timeout');
      expect(ctx.broadcastToRoom).toHaveBeenCalledWith('robot-1', 'session:end', expect.objectContaining({ sessionId: 'session-1' }));
      expect(ctx.broadcastToRoom).toHaveBeenCalledWith('robot-1', 'queue:turn-end', expect.objectContaining({ reason: 'timeout' }));
      expect(ctx.activeTurns.has('robot-1')).toBe(false);
    });

    it('clears turn timeout timer', async () => {
      const ctx = makeContext();
      const fakeTimer: ReturnType<typeof setTimeout> = setTimeout(() => {}, 99999);
      ctx.turnTimeouts.set('robot-1', fakeTimer);

      const handler = createHandler(ctx);
      await handler.clearTurnState('robot-1');

      expect(ctx.turnTimeouts.has('robot-1')).toBe(false);
      clearTimeout(fakeTimer);
    });
  });

  describe('syncTurnLifecycle', () => {
    it('clears turn when queue mode is DISABLED', async () => {
      const ctx = makeContext();
      ctx.activeTurns.set('robot-1', makeTurn({
        sessionId: 's1',
        userId: 'u1',
        startedAt: Date.now(),
        expiresAt: Date.now() + 1000,
      }));
      mockRobotsService.findById.mockResolvedValueOnce({ queueMode: 'DISABLED', status: 'ONLINE', maxTurnTime: 60000 });

      const handler = createHandler(ctx);
      await handler.syncTurnLifecycle('robot-1', []);

      expect(ctx.activeTurns.has('robot-1')).toBe(false);
    });

    it('clears turn when robot is in maintenance', async () => {
      const ctx = makeContext();
      ctx.robotClients.add('robot-1');
      ctx.activeTurns.set('robot-1', makeTurn({
        sessionId: 's1',
        userId: 'u1',
        startedAt: Date.now(),
        expiresAt: Date.now() + 1000,
      }));
      mockRobotsService.findById.mockResolvedValueOnce({ queueMode: 'STANDARD', status: 'MAINTENANCE', maxTurnTime: 60000 });

      const handler = createHandler(ctx);
      await handler.syncTurnLifecycle('robot-1', []);

      expect(ctx.activeTurns.has('robot-1')).toBe(false);
    });

    it('starts a new turn for the first queue entry', async () => {
      const ctx = makeContext();
      ctx.robotClients.add('robot-1');
      mockRobotsService.findById.mockResolvedValueOnce({ queueMode: 'STANDARD', status: 'ONLINE', maxTurnTime: 60000 });
      mockSessionsService.create.mockResolvedValueOnce({ id: 'new-session' });

      const handler = createHandler(ctx);
      await handler.syncTurnLifecycle('robot-1', [{ userId: 'user-1', user: { username: 'alice' } }]);

      expect(ctx.activeTurns.get('robot-1')?.userId).toBe('user-1');
      expect(ctx.broadcastToRoom).toHaveBeenCalledWith('robot-1', 'queue:turn-start', expect.objectContaining({ userId: 'user-1' }));
    });

    it('does nothing if turn already belongs to queue head', async () => {
      const ctx = makeContext();
      ctx.robotClients.add('robot-1');
      ctx.activeTurns.set('robot-1', makeTurn({
        sessionId: 's1',
        userId: 'user-1',
        startedAt: Date.now(),
        expiresAt: Date.now() + 1000,
      }));
      mockRobotsService.findById.mockResolvedValueOnce({ queueMode: 'STANDARD', status: 'ONLINE', maxTurnTime: 60000 });

      const handler = createHandler(ctx);
      await handler.syncTurnLifecycle('robot-1', [{ userId: 'user-1' }]);

      expect(mockSessionsService.create).not.toHaveBeenCalled();
      expect(ctx.acquireActiveTurn).not.toHaveBeenCalled();
    });

    it('does not take over a matching turn owned by another instance', async () => {
      const sharedTurn: ActiveTurnState = makeTurn({
        sessionId: 's1',
        userId: 'user-1',
        startedAt: Date.now() - 2000,
        expiresAt: Date.now() + 5000,
        ownerId: 'instance-b',
      });
      const ctx = makeContext({
        getActiveTurn: jest.fn().mockResolvedValue(sharedTurn),
        hasLocalActiveTurn: jest.fn().mockReturnValue(false),
      });
      ctx.robotClients.add('robot-1');
      mockRobotsService.findById.mockResolvedValueOnce({ queueMode: 'STANDARD', status: 'ONLINE', maxTurnTime: 60000 });

      const handler = createHandler(ctx);
      await handler.syncTurnLifecycle('robot-1', [{ userId: 'user-1' }]);

      expect(mockSessionsService.create).not.toHaveBeenCalled();
    });
  });

  describe('handleTurnTimeout', () => {
    it('clears turn state and removes user from queue', async () => {
      const ctx = makeContext();
      ctx.activeTurns.set('robot-1', makeTurn({
        sessionId: 's1',
        userId: 'user-1',
        startedAt: Date.now(),
        expiresAt: Date.now() - 1,
      }));

      const handler = createHandler(ctx);
      await handler.handleTurnTimeout('robot-1', 'user-1');

      expect(mockQueueService.leave).toHaveBeenCalledWith('robot-1', 'user-1');
      expect(ctx.activeTurns.has('robot-1')).toBe(false);
    });
  });
});
