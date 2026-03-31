import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
      trustProxy: true,
    }),
  );

  // ─── CORS (strict) ────────────────────────────────
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });

  // ─── Global prefix ────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ─── Swagger / OpenAPI ─────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
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
