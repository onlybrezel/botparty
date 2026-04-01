import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
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

@Module({
  imports: [
    // ─── Config ────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),

    // ─── Rate Limiting ─────────────────────────────
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL) || 60000,
        limit: Number(process.env.THROTTLE_LIMIT) || 100,
      },
    ]),

    // ─── Core ──────────────────────────────────────
    PrismaModule,
    RedisModule,

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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
