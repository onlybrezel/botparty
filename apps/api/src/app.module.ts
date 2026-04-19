import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { JobsModule } from './jobs/jobs.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RobotsModule } from './robots/robots.module';
import { SessionsModule } from './sessions/sessions.module';
import { QueueModule } from './queue/queue.module';
import { LivekitModule } from './livekit/livekit.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { ControlsModule } from './controls/controls.module';
import { ModerationModule } from './moderation/moderation.module';
import { MailModule } from './mail/mail.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [
    // ─── Config ────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),

    // ─── Rate Limiting ─────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get<string>('THROTTLE_TTL') ?? '60000'),
          limit: Number(config.get<string>('THROTTLE_LIMIT') ?? '100'),
        },
      ],
    }),

    // ─── Core ──────────────────────────────────────
    PrismaModule,
    RedisModule,
    MailModule,

    // ─── Async Jobs (BullMQ) ───────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: Number(config.getOrThrow<string>('REDIS_PORT')),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    JobsModule,

    // ─── Feature Modules ───────────────────────────
    AuthModule,
    UsersModule,
    RobotsModule,
    SessionsModule,
    QueueModule,
    LivekitModule,
    GatewayModule,
    HealthModule,
    ControlsModule,
    ModerationModule,
    MaintenanceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
