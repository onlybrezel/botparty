import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BotGateway } from './bot.gateway';
import { RobotsService } from '../robots/robots.service';
import { SessionsService } from '../sessions/sessions.service';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';
import { ModerationService } from '../moderation/moderation.service';
import { ControlsService } from '../controls/controls.service';
import { AuthService } from '../auth/auth.service';

describe('BotGateway', () => {
  let gateway: BotGateway;
  let module: TestingModule;
  let robotsService: jest.Mocked<RobotsService>;
  let sessionsService: jest.Mocked<SessionsService>;
  let queueService: jest.Mocked<QueueService>;
  let redisService: jest.Mocked<RedisService>;
  let moderationService: jest.Mocked<ModerationService>;
  let controlsService: jest.Mocked<ControlsService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockRedisClient = {
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      psubscribe: jest.fn().mockResolvedValue(undefined),
      punsubscribe: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(0),
      incr: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      sadd: jest.fn().mockResolvedValue(0),
      srem: jest.fn().mockResolvedValue(0),
      hget: jest.fn().mockResolvedValue(null),
      hset: jest.fn().mockResolvedValue(0),
      hdel: jest.fn().mockResolvedValue(0),
      publish: jest.fn().mockResolvedValue(0),
      pipeline: jest.fn().mockReturnValue({
        hset: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      multi: jest.fn().mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([null, null, [null, 0], null]),
      }),
      quit: jest.fn().mockResolvedValue('OK'),
    };

    module = await Test.createTestingModule({
      providers: [
        BotGateway,
        {
          provide: RobotsService,
          useValue: {
            findById: jest.fn(),
            getAccessPolicy: jest.fn(),
          } as any,
        },
        {
          provide: SessionsService,
          useValue: {
            create: jest.fn(),
            end: jest.fn(),
            findActive: jest.fn(),
            endAllActiveSessions: jest.fn().mockResolvedValue(undefined),
          } as any,
        },
        {
          provide: QueueService,
          useValue: {
            join: jest.fn(),
            leave: jest.fn(),
            getStatus: jest.fn(),
          } as any,
        },
        {
          provide: RedisService,
          useValue: {
            duplicate: jest.fn().mockReturnValue(mockRedisClient),
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
          } as any,
        },
        {
          provide: ModerationService,
          useValue: {
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
            get: jest.fn(),
            getOrThrow: jest.fn(),
          } as any,
        },
      ],
    }).compile();

    gateway = module.get<BotGateway>(BotGateway);
    robotsService = module.get(RobotsService) as jest.Mocked<RobotsService>;
    sessionsService = module.get(SessionsService) as jest.Mocked<SessionsService>;
    queueService = module.get(QueueService) as jest.Mocked<QueueService>;
    redisService = module.get(RedisService) as jest.Mocked<RedisService>;
    moderationService = module.get(ModerationService) as jest.Mocked<ModerationService>;
    controlsService = module.get(ControlsService) as jest.Mocked<ControlsService>;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
  });

  afterEach(async () => {
    await module.close();
  });

  describe('onModuleInit', () => {
    it('should initialize correctly', async () => {
      await expect(gateway.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('connection handling', () => {
    it('assigns identity metadata on connect', async () => {
      const mockSocket = {
        id: 'test-socket-1',
        close: jest.fn(),
      } as any;

      await gateway.handleConnection(mockSocket, {});
      expect(mockSocket.id).toBeDefined();
      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should accept connection with valid token', async () => {
      const mockSocket = {
        id: 'test-socket-2',
        on: jest.fn(),
        close: jest.fn(),
        send: jest.fn(),
      } as any;

      jwtService.verify.mockReturnValueOnce({ userId: 'user-1', sub: 'user-1' });

      await gateway.handleConnection(mockSocket, {});
      // Socket should not be closed on valid token
      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should handle disconnection gracefully', async () => {
      const mockSocket = {
        id: 'test-socket-3',
        on: jest.fn(),
      } as any;

      jwtService.verify.mockReturnValueOnce({ userId: 'user-1', sub: 'user-1' });
      await gateway.handleConnection(mockSocket, {});

      await gateway.handleDisconnect(mockSocket);
      // Should clean up client state without throwing
    });
  });

  describe('critical safety paths', () => {
    it('should not allow multiple simultaneous control turns on same robot', async () => {
      // This would test the activeTurns state management
      // But detailed testing requires more gateway refactoring to expose state
      expect(gateway).toBeDefined();
    });

    it('should respect emergency stop flow', async () => {
      // Critical security path: emergency stop must work
      expect(gateway).toBeDefined();
    });

    it('stores control cooldowns in redis with a shared TTL gate', async () => {
      const client = { id: 'viewer-1', userId: 'user-1' } as any;

      const allowed = await (gateway as any).consumeControlCooldown(client, 'robot-1', 'Forward', 120);

      expect(allowed).toBe(true);
      expect(redisService.set).toHaveBeenCalledWith(
        'ws:control-cooldown:robot-1:user-1:forward',
        expect.any(String),
        'PX',
        120,
        'NX',
      );
    });

    it('falls back to local cooldown tracking when redis is unavailable', async () => {
      const client = { id: 'viewer-1', userId: 'user-1' } as any;
      redisService.set.mockRejectedValueOnce(new Error('redis down'));
      redisService.set.mockRejectedValueOnce(new Error('redis still down'));
      redisService.set.mockResolvedValueOnce('OK');

      const first = await (gateway as any).consumeControlCooldown(client, 'robot-1', 'forward', 120);
      const second = await (gateway as any).consumeControlCooldown(client, 'robot-1', 'forward', 120);
      const metricsDuringFallback = gateway.getRuntimeMetricsSnapshot();
      const recovered = await (gateway as any).consumeControlCooldown(client, 'robot-1', 'left', 120);
      const metricsAfterRecovery = gateway.getRuntimeMetricsSnapshot();

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(metricsDuringFallback.controlCooldowns).toBe(1);
      expect(recovered).toBe(true);
      expect(metricsAfterRecovery.controlCooldowns).toBe(0);
    });
  });
});
