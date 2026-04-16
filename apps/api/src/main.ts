import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet, { type FastifyHelmetOptions } from '@fastify/helmet';
import type { FastifyPluginAsync } from 'fastify';
import { AppModule } from './app.module';
import { loadFileBackedEnv } from './common/env-file';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  loadFileBackedEnv(process.env, logger);

  // ─── Security sanity checks ───────────────────────
  const insecureJwtDefaults = ['CHANGE_ME_IN_PRODUCTION_min_32_chars_long!!', 'CHANGE_ME_REFRESH_SECRET_min_32_chars!!'];
  if (insecureJwtDefaults.includes(process.env.JWT_SECRET ?? '') || insecureJwtDefaults.includes(process.env.JWT_REFRESH_SECRET ?? '')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET / JWT_REFRESH_SECRET must be changed from example defaults before running in production');
    } else {
      logger.warn('⚠️  JWT secrets are using example defaults — change them before deploying to production');
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: Number(process.env.FASTIFY_BODY_LIMIT ?? 5 * 1024 * 1024),
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
          connectSrc: ["'self'"],
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
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
  logger.log(`🚀 BotParty API running on http://0.0.0.0:${port}`);
  logger.log(`🌍 Environment: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap();
