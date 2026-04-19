import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet, { type FastifyHelmetOptions } from '@fastify/helmet';
import type { FastifyPluginAsync } from 'fastify';
import type { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { loadFileBackedEnv } from './common/env-file';
import { initSentry } from './common/sentry';
import { initTracing, shutdownTracing } from './common/tracing';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

function readOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function collectConnectSrcOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = new Set<string>();
  for (const key of ['APP_URL', 'CORS_ORIGIN', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_URL']) {
    const raw = env[key];
    if (!raw) continue;
    for (const entry of raw.split(',')) {
      const origin = readOrigin(entry);
      if (origin) {
        origins.add(origin);
      }
    }
  }
  return [...origins];
}

function assertRequiredSecret(env: NodeJS.ProcessEnv, name: string, options?: { minLength?: number; bannedValues?: string[] }) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  if (options?.minLength && value.length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters long`);
  }
  if (options?.bannedValues?.includes(value)) {
    throw new Error(`${name} must not use an example or placeholder value`);
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  loadFileBackedEnv(process.env, logger);
  await initSentry(logger);
  await initTracing(logger);

  // ─── Security sanity checks ───────────────────────
  try {
    assertRequiredSecret(process.env, 'JWT_SECRET', {
      minLength: 32,
      bannedValues: ['CHANGE_ME_IN_PRODUCTION_min_32_chars_long!!', 'change_me_in_production_min_32_chars_long!!'],
    });
    assertRequiredSecret(process.env, 'JWT_REFRESH_SECRET', {
      minLength: 32,
      bannedValues: ['CHANGE_ME_REFRESH_SECRET_min_32_chars!!', 'change_me_refresh_secret_min_32_chars!!'],
    });
    assertRequiredSecret(process.env, 'ROBOT_JWT_SECRET', { minLength: 32 });
    assertRequiredSecret(process.env, 'LIVEKIT_API_SECRET', {
      minLength: 32,
      bannedValues: ['secret_that_is_at_least_32_characters_long'],
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    logger.warn(`Security configuration warning: ${(error as Error).message}`);
  }

  const connectSrc = ["'self'", ...collectConnectSrcOrigins(process.env)];

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: Number(process.env.FASTIFY_BODY_LIMIT ?? 5 * 1024 * 1024),
      genReqId: (req: IncomingMessage) => {
        const fromHeader = req.headers['x-correlation-id'];
        if (typeof fromHeader === 'string' && fromHeader.trim()) {
          return fromHeader.trim();
        }
        return randomUUID();
      },
      requestIdHeader: 'x-correlation-id',
      logger: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
      // Trust proxy headers from private-network addresses only (loopback,
      // Docker bridge, RFC-1918).  Override via TRUST_PROXY env var if needed.
      trustProxy: process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal',
    }),
  );

  // ─── WebSocket adapter (ws, not socket.io) ────────
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  app.getHttpAdapter().getInstance().addHook('onResponse', (request, reply, done) => {
    const correlationId = typeof request.id === 'string' ? request.id : randomUUID();
    reply.header('x-correlation-id', correlationId);
    done();
  });

  const helmetRegistration = (async (instance: Parameters<FastifyPluginAsync<FastifyHelmetOptions>>[0]) => {
    const registerHelmet = helmet as unknown as (
      appInstance: Parameters<FastifyPluginAsync<FastifyHelmetOptions>>[0],
      opts: FastifyHelmetOptions,
    ) => ReturnType<FastifyPluginAsync<FastifyHelmetOptions>>;

    await registerHelmet(instance, {
      global: true,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc,
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
    } satisfies FastifyHelmetOptions);
  }) as unknown as Parameters<typeof app.register>[0];

  await app.register(helmetRegistration);

  // ─── Global exception filter ─────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());

  // ─── Global validation ────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,      // strip unknown fields
      forbidNonWhitelisted: true,
      transform: true,      // auto-cast primitives (e.g. string -> number)
    }),
  );

  // ─── CORS (strict) ────────────────────────────────
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) ?? ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Correlation-Id'],
  });

  // ─── Global prefix ────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ─── Swagger / OpenAPI ─────────────────────────────
  const enableSwagger = process.env.NODE_ENV !== 'production' || process.env.SWAGGER_DOCS === 'true';
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('BotParty API')
      .setDescription('Real-time robot teleoperation platform API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & authorization')
      .addTag('users', 'User management')
      .addTag('robots', 'Robot management')
      .addTag('sessions', 'Session management')
      .addTag('queue', 'Queue system')
      .addTag('livekit', 'LiveKit token generation')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log('📖 Swagger docs available at /docs');
  }

  const port = process.env.PORT ?? 4000;
  await app.listen({ port: Number(port), host: '0.0.0.0' });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownTracing(logger);
    });
  }

  logger.log(`🚀 BotParty API running on http://0.0.0.0:${port}`);
  logger.log(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap();
