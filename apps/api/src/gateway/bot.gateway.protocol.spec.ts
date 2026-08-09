import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  WS_EVENTS,
  WS_PROTOCOL_VERSION,
  WS_MIN_SUPPORTED_PROTOCOL_VERSION,
} from '@botparty/shared';
import { BotGateway } from './bot.gateway';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';
import { ControlsService } from '../controls/controls.service';
import { AuthService } from '../auth/auth.service';
import { WalletService } from '../wallet/wallet.service';
import { LivekitService } from '../livekit/livekit.service';
import { FeatureFlagsService } from '../common/feature-flags.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createWsClient } from '../test/ws-client.fixture';


describe('BotGateway protocol exchange', () => {
  let gateway: BotGateway;
  let module: TestingModule;
  let robotsService: jest.Mocked<RobotsService>;
  let queueService: jest.Mocked<QueueService>;
  let jwtService: jest.Mocked<JwtService>;
  let authService: jest.Mocked<AuthService>;

  const robotId = '550e8400-e29b-41d4-a716-446655440000';
  const robotRecord = {
    id: robotId,
    name: 'Audit Bot',
    status: 'OFFLINE',
    queueMode: 'FIRST_COME',
    maxTurnTime: 60_000,
  };

  beforeEach(async () => {
    const redisChain = {
      set: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const redisPipeline = {
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const duplicateClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      psubscribe: jest.fn().mockResolvedValue(undefined),
      punsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue('OK'),
    };

    module = await Test.createTestingModule({
      providers: [
        BotGateway,
        {
          provide: RobotsService,
          useValue: {
            findById: jest.fn().mockResolvedValue(robotRecord),
            findByIdCached: jest.fn().mockResolvedValue(robotRecord),
            resolveRoomAccessActorId: jest.fn().mockResolvedValue(null),
            validateRoomAccess: jest.fn().mockResolvedValue(true),
            validateRobotAuth: jest.fn().mockResolvedValue(true),
            setViewerCount: jest.fn().mockResolvedValue(undefined),
            getRecentChatMessages: jest.fn().mockResolvedValue([]),
            updateStatus: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SessionsService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'session-1' }),
            end: jest.fn().mockResolvedValue(undefined),
            findActive: jest.fn(),
            endAllActiveSessions: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: QueueService,
          useValue: {
            getQueue: jest.fn().mockResolvedValue([]),
            join: jest.fn(),
            leave: jest.fn().mockResolvedValue(undefined),
            getStatus: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            duplicate: jest.fn().mockReturnValue(duplicateClient),
            publish: jest.fn().mockResolvedValue(0),
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn().mockResolvedValue(null),
            del: jest.fn().mockResolvedValue(0),
            hget: jest.fn().mockResolvedValue(null),
            hset: jest.fn().mockResolvedValue(0),
            hdel: jest.fn().mockResolvedValue(0),
            sadd: jest.fn().mockResolvedValue(0),
            srem: jest.fn().mockResolvedValue(0),
            smembers: jest.fn().mockResolvedValue([]),
            zremrangebyscore: jest.fn().mockResolvedValue(0),
            zadd: jest.fn().mockResolvedValue(1),
            zcard: jest.fn().mockResolvedValue(0),
            expire: jest.fn().mockResolvedValue(1),
            eval: jest.fn().mockResolvedValue(1),
            multi: jest.fn().mockReturnValue(redisChain),
            pipeline: jest.fn().mockReturnValue(redisPipeline),
          },
        },
        {
          provide: ModerationService,
          useValue: {
            getActiveRestriction: jest.fn().mockResolvedValue(null),
            checkProfanity: jest.fn(),
            isBanned: jest.fn(),
          },
        },
        {
          provide: ControlsService,
          useValue: {
            getEnabledButtons: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
            decode: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            resolveValidAccessTokenPayload: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000'),
            getOrThrow: jest.fn().mockReturnValue('robot-secret'),
          },
        },
        {
          provide: WalletService,
          useValue: {
            transfer: jest.fn().mockResolvedValue({ status: 'ok' }),
            credit: jest.fn(),
            debit: jest.fn(),
            getBalance: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: LivekitService,
          useValue: {
            revokeController: jest.fn().mockResolvedValue(undefined),
            stopRoomRecording: jest.fn().mockResolvedValue({ active: false, outputs: [] }),
          },
        },
        {
          provide: FeatureFlagsService,
          useValue: { isEnabled: jest.fn().mockReturnValue(false) },
        },
        {
          provide: NotificationsService,
          useValue: { publishSafely: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    gateway = module.get<BotGateway>(BotGateway);
    robotsService = module.get<jest.Mocked<RobotsService>>(RobotsService);
    queueService = module.get<jest.Mocked<QueueService>>(QueueService);
    jwtService = module.get<jest.Mocked<JwtService>>(JwtService);
    authService = module.get<jest.Mocked<AuthService>>(AuthService);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('returns protocol metadata in room join responses', async () => {
    const client = createWsClient({
      id: 'viewer-1',
      send: jest.fn(),
      close: jest.fn(),
      remoteIp: '127.0.0.1',
    });

    const result = await gateway.handleRoomJoin(client, {
      robotId,
      protocolVersion: WS_PROTOCOL_VERSION,
    });

    expect(result).toEqual({
      event: WS_EVENTS.ROOM_JOIN,
      data: expect.objectContaining({
        ok: true,
        protocolVersion: WS_PROTOCOL_VERSION,
        minProtocolVersion: WS_MIN_SUPPORTED_PROTOCOL_VERSION,
        clientProtocolVersion: WS_PROTOCOL_VERSION,
      }),
    });
    expect(robotsService.validateRoomAccess).toHaveBeenCalled();
  });

  it('returns protocol metadata in robot claim responses', async () => {
    const client = createWsClient({
      id: 'robot-1',
      send: jest.fn(),
      close: jest.fn(),
    });
    jwtService.verify.mockReturnValue({
      sub: robotId,
      scope: 'robot',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 0,
    });

    const result = await gateway.handleRobotClaim(client, {
      robotAuthToken: 'robot-token',
      protocolVersion: WS_PROTOCOL_VERSION,
    });

    expect(result).toEqual({
      event: WS_EVENTS.ROBOT_CLAIM,
      data: expect.objectContaining({
        success: true,
        robotId,
        protocolVersion: WS_PROTOCOL_VERSION,
        minProtocolVersion: WS_MIN_SUPPORTED_PROTOCOL_VERSION,
        clientProtocolVersion: WS_PROTOCOL_VERSION,
      }),
    });
    expect(queueService.getQueue).toHaveBeenCalledWith(robotId);
  });

  it('replaces an existing local robot socket when the same robot reconnects', async () => {
    const existingClient = createWsClient({
      id: 'robot-1',
      send: jest.fn(),
      close: jest.fn(),
      isRobot: true,
      robotId,
    });
    const replacementClient = createWsClient({
      id: 'robot-2',
      send: jest.fn(),
      close: jest.fn(),
    });
    jwtService.verify.mockReturnValue({
      sub: robotId,
      scope: 'robot',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 0,
    });
    const internal = gateway;
    internal.registerRobotRuntimeClient(robotId, existingClient);

    const result = await gateway.handleRobotClaim(replacementClient, {
      robotAuthToken: 'robot-token',
      protocolVersion: WS_PROTOCOL_VERSION,
    });

    expect(result).toEqual({
      event: WS_EVENTS.ROBOT_CLAIM,
      data: expect.objectContaining({
        success: true,
        robotId,
      }),
    });
    expect(existingClient.close).toHaveBeenCalledWith(1012, 'Replaced by newer robot claim');
    expect(replacementClient.close).not.toHaveBeenCalled();
    expect(existingClient.close).toHaveBeenCalled();
  });

  it('closes authenticated sockets whose access token is no longer valid', async () => {
    const client = createWsClient({
      id: 'viewer-auth-1',
      send: jest.fn(),
      close: jest.fn(),
      userId: 'user-1',
      username: 'alpha',
      role: 'USER',
      authAccessToken: 'expired-token',
    });
    authService.resolveValidAccessTokenPayload.mockResolvedValueOnce(null);

    const internal = gateway;
    internal.registerRuntimeClient(client);
    await internal.revalidateAuthenticatedSockets();

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid session token' } }),
    );
    expect(client.close).toHaveBeenCalledWith(1008, 'Invalid session token');
  });
});
