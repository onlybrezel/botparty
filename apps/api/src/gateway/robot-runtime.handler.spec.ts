import { WS_EVENTS } from '@botparty/shared';
import type { WsClient } from './gateway-types';
import { createWsClient } from '../test/ws-client.fixture';
import { RobotRuntimeHandler } from './robot-runtime.handler';

describe('RobotRuntimeHandler', () => {
  function createClient(): WsClient {
    return createWsClient({
      id: 'socket-1',
      send: jest.fn(),
      close: jest.fn(),
    });
  }

  function createDeps() {
    const runtime = {
      parseWsPayload: jest.fn(),
      resolveRobotSocketIdentity: jest.fn(),
      getOpenRobotClient: jest.fn(),
      transferRobotClaimLock: jest.fn().mockResolvedValue(true),
      acquireRobotClaimLock: jest.fn().mockResolvedValue(true),
      releaseRobotClaimLock: jest.fn().mockResolvedValue(undefined),
      robotClients: new Map<string, WsClient>(),
      broadcastToRoomLocally: jest.fn(),
      broadcastToRoom: jest.fn(),
      recordRobotHeartbeat: jest.fn(),
      triggerEmergencyStop: jest.fn(),
      logger: {
        warn: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    };
    const robotsService = {
      findByIdCached: jest.fn().mockResolvedValue({ id: 'robot-1', name: 'Mars Rover' }),
      validateRobotAuth: jest.fn().mockResolvedValue(true),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      touchHeartbeat: jest.fn().mockResolvedValue(undefined),
      ingestRobotTelemetryByRobotId: jest.fn().mockResolvedValue(undefined),
      consumeActionsByRobotId: jest.fn().mockResolvedValue({ items: [{ id: 'action-1' }] }),
      getAccessPolicy: jest.fn().mockResolvedValue({ estop: 'ALL' }),
    };
    const queueService = {
      getQueue: jest.fn().mockResolvedValue({ queue: [] }),
    };
    const syncTurnLifecycle = jest.fn().mockResolvedValue(undefined);

    return {
      runtime,
      runtimeMock: runtime,
      robotsService,
      robotsMock: robotsService,
      queueService,
      queueMock: queueService,
      syncTurnLifecycle,
    };
  }

  it('rejects invalid robot claims before binding the socket', async () => {
    const { runtime, runtimeMock, robotsService, queueService, syncTurnLifecycle } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({ robotAuthToken: 'bad-token', protocolVersion: 2 });
    runtimeMock.resolveRobotSocketIdentity.mockReturnValue(null);
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();

    await expect(handler.handleRobotClaim(client, {})).resolves.toBeUndefined();
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Invalid robot authorization' },
      }),
    );
    expect(client.close).toHaveBeenCalledWith(1008, 'Invalid robot authorization');
  });

  it('claims a robot socket and synchronizes the queue lifecycle', async () => {
    const {
      runtime,
      runtimeMock,
      robotsService,
      robotsMock,
      queueService,
      queueMock,
      syncTurnLifecycle,
    } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({
      robotAuthToken: 'good-token',
      protocolVersion: 2,
    });
    runtimeMock.resolveRobotSocketIdentity.mockReturnValue({
      robotId: 'robot-1',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 1,
    });
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();

    const result = await handler.handleRobotClaim(client, {});

    expect(runtimeMock.acquireRobotClaimLock).toHaveBeenCalledWith('robot-1', client.id);
    expect(robotsMock.updateStatus).toHaveBeenCalledWith('robot-1', 'ONLINE');
    expect(queueMock.getQueue).toHaveBeenCalledWith('robot-1');
    expect(syncTurnLifecycle).toHaveBeenCalledWith('robot-1', { queue: [] });
    expect(runtimeMock.broadcastToRoomLocally).toHaveBeenCalledWith(
      'robot-1',
      WS_EVENTS.QUEUE_UPDATE,
      {
        queue: { queue: [] },
      },
    );
    expect(runtimeMock.broadcastToRoom).toHaveBeenCalledWith('robot-1', WS_EVENTS.ROBOT_STATUS, {
      status: 'ONLINE',
    });
    expect(result).toEqual({
      event: WS_EVENTS.ROBOT_CLAIM,
      data: {
        success: true,
        robotId: 'robot-1',
        protocolVersion: expect.any(Number),
        minProtocolVersion: expect.any(Number),
        clientProtocolVersion: 2,
      },
    });
  });

  it('rejects duplicate claims when the cross-instance lock cannot be acquired', async () => {
    const { runtime, runtimeMock, robotsService, queueService, syncTurnLifecycle } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({
      robotAuthToken: 'good-token',
      protocolVersion: 2,
    });
    runtimeMock.resolveRobotSocketIdentity.mockReturnValue({
      robotId: 'robot-1',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 1,
    });
    runtimeMock.acquireRobotClaimLock.mockResolvedValueOnce(false);
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();

    await handler.handleRobotClaim(client, {});

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'Robot control channel is already connected' },
      }),
    );
    expect(client.close).toHaveBeenCalledWith(1008, 'Robot already connected');
  });

  it('replaces an existing robot socket when the lock transfer succeeds', async () => {
    const { runtime, runtimeMock, robotsService, queueService, syncTurnLifecycle } = createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({
      robotAuthToken: 'good-token',
      protocolVersion: 2,
    });
    runtimeMock.resolveRobotSocketIdentity.mockReturnValue({
      robotId: 'robot-1',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 1,
    });
    const existingClient = createClient();
    runtimeMock.getOpenRobotClient.mockReturnValue(existingClient);
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();

    await handler.handleRobotClaim(client, {});

    expect(runtimeMock.transferRobotClaimLock).toHaveBeenCalledWith(
      'robot-1',
      existingClient.id,
      client.id,
    );
    expect(existingClient.close).toHaveBeenCalledWith(1012, 'Replaced by newer robot claim');
    expect(runtimeMock.robotClients.get('robot-1')).toBe(client);
  });

  it('releases the claim lock when claim processing fails after a robot was bound', async () => {
    const { runtime, runtimeMock, robotsService, robotsMock, queueService, syncTurnLifecycle } =
      createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({
      robotAuthToken: 'good-token',
      protocolVersion: 2,
    });
    runtimeMock.resolveRobotSocketIdentity.mockReturnValue({
      robotId: 'robot-1',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 1,
    });
    robotsMock.findByIdCached.mockRejectedValueOnce(new Error('boom'));
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();
    client.robotId = 'robot-1';

    await expect(handler.handleRobotClaim(client, {})).resolves.toEqual({
      event: WS_EVENTS.ERROR,
      data: { message: 'Claim failed' },
    });
    expect(runtimeMock.releaseRobotClaimLock).toHaveBeenCalledWith('robot-1', client.id);
  });

  it('handles heartbeat, telemetry, action polling, and emergency stop validation', async () => {
    const { runtime, runtimeMock, robotsService, robotsMock, queueService, syncTurnLifecycle } =
      createDeps();
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();
    client.isRobot = true;
    client.robotId = 'robot-1';
    client.watchingRobotId = 'robot-1';
    client.userId = 'user-1';

    expect(handler.handleHeartbeat(client)).toEqual({
      event: WS_EVENTS.ROBOT_HEARTBEAT,
      data: { ts: expect.any(Number) },
    });
    expect(runtimeMock.recordRobotHeartbeat).toHaveBeenCalledWith('robot-1', client.id);

    runtimeMock.parseWsPayload.mockReturnValue({ battery: 95 });
    await handler.handleTelemetry(client, {});
    expect(robotsMock.ingestRobotTelemetryByRobotId).toHaveBeenCalledWith('robot-1', {
      battery: 95,
    });

    runtimeMock.parseWsPayload.mockReturnValue({});
    await handler.handleRobotActionsPull(client, {});
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ROBOT_ACTIONS,
        data: { items: [{ id: 'action-1' }] },
      }),
    );

    runtimeMock.parseWsPayload.mockReturnValue({ robotId: 'robot-1' });
    await handler.handleEmergencyStopMessage(client, {});
    expect(runtimeMock.triggerEmergencyStop).toHaveBeenCalledWith(
      'robot-1',
      'Manual E-STOP by user-1',
    );
  });

  it('blocks emergency stop when the access policy forbids it', async () => {
    const { runtime, runtimeMock, robotsService, robotsMock, queueService, syncTurnLifecycle } =
      createDeps();
    runtimeMock.parseWsPayload.mockReturnValue({ robotId: 'robot-1' });
    robotsMock.getAccessPolicy.mockResolvedValueOnce({ estop: 'DISABLED' });
    const handler = new RobotRuntimeHandler(
      runtime,
      robotsService,
      queueService,
      syncTurnLifecycle,
    );
    const client = createClient();
    client.watchingRobotId = 'robot-1';
    client.userId = 'user-1';

    await handler.handleEmergencyStopMessage(client, {});

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: WS_EVENTS.ERROR,
        data: { message: 'E-STOP is disabled for this room' },
      }),
    );
  });
});
