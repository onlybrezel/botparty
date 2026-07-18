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
          } as any,
        },
        {
          provide: SessionsService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'session-1' }),
            end: jest.fn().mockResolvedValue(undefined),
            findActive: jest.fn(),
            endAllActiveSessions: jest.fn().mockResolvedValue(undefined),
          } as any,
        },
        {
          provide: QueueService,
          useValue: {
            getQueue: jest.fn().mockResolvedValue([]),
            join: jest.fn(),
            leave: jest.fn().mockResolvedValue(undefined),
            getStatus: jest.fn(),
          } as any,
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
          } as any,
        },
        {
          provide: ModerationService,
          useValue: {
            getActiveRestriction: jest.fn().mockResolvedValue(null),
            checkProfanity: jest.fn(),
            isBanned: jest.fn(),
          } as any,
        },
        {
          provide: ControlsService,
          useValue: {
            getEnabledButtons: jest.fn(),
          } as any,
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
            decode: jest.fn(),
          } as any,
        },
        {
          provide: AuthService,
          useValue: {
            resolveValidAccessTokenPayload: jest.fn().mockResolvedValue(null),
          } as any,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000'),
            getOrThrow: jest.fn().mockReturnValue('robot-secret'),
          } as any,
        },
        {
          provide: WalletService,
          useValue: {
            transfer: jest.fn().mockResolvedValue({ status: 'ok' }),
            credit: jest.fn(),
            debit: jest.fn(),
            getBalance: jest.fn().mockResolvedValue(0),
          } as any,
        },
        {
          provide: LivekitService,
          useValue: {
            revokeController: jest.fn().mockResolvedValue(undefined),
            stopRoomRecording: jest.fn().mockResolvedValue({ active: false, outputs: [] }),
          } as any,
        },
        {
          provide: FeatureFlagsService,
          useValue: { isEnabled: jest.fn().mockReturnValue(false) } as any,
        },
        {
          provide: NotificationsService,
          useValue: { publishSafely: jest.fn().mockResolvedValue(null) } as any,
        },
      ],
    }).compile();

    gateway = module.get<BotGateway>(BotGateway);
    robotsService = module.get(RobotsService) as jest.Mocked<RobotsService>;
    queueService = module.get(QueueService) as jest.Mocked<QueueService>;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    authService = module.get(AuthService) as jest.Mocked<AuthService>;
  });

  afterEach(async () => {
    await module?.close();
  });

  it('returns protocol metadata in room join responses', async () => {
    const client = {
      id: 'viewer-1',
      send: jest.fn(),
      close: jest.fn(),
      remoteIp: '127.0.0.1',
    } as any;

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
    const client = {
      id: 'robot-1',
      send: jest.fn(),
      close: jest.fn(),
    } as any;
    jwtService.verify.mockReturnValue({
      sub: robotId,
      scope: 'robot',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 0,
    } as never);

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
    const existingClient = {
      id: 'robot-1',
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
      isRobot: true,
      robotId,
    } as any;
    const replacementClient = {
      id: 'robot-2',
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
    } as any;
    jwtService.verify.mockReturnValue({
      sub: robotId,
      scope: 'robot',
      deviceHash: 'a'.repeat(64),
      tokenVersion: 0,
    } as never);
    (gateway as any).robotClients.set(robotId, existingClient);

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
    expect((gateway as any).robotClients.get(robotId)).toBe(replacementClient);
  });

  it('closes authenticated sockets whose access token is no longer valid', async () => {
    const client = {
      id: 'viewer-auth-1',
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1,
      userId: 'user-1',
      username: 'alpha',
      role: 'USER',
      authAccessToken: 'expired-token',
    } as any;
    authService.resolveValidAccessTokenPayload.mockResolvedValueOnce(null);

    (gateway as any).clients.set(client.id, client);
    await (gateway as any)._revalidateAuthenticatedSockets();

    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({ event: WS_EVENTS.ERROR, data: { message: 'Invalid session token' } }),
    );
    expect(client.close).toHaveBeenCalledWith(1008, 'Invalid session token');
  });
});
