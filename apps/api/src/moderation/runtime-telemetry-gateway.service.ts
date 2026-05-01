import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RuntimeTelemetryGatewayService {
  constructor(private readonly redis: RedisService) {}

  async getRobotRuntime(robotIds: string[]) {
    if (!robotIds.length) {
      return {
        heartbeats: new Map<string, number | null>(),
        telemetry: new Map<string, Record<string, unknown> | null>(),
      };
    }

    const [heartbeatRaw, telemetryRaw] = await Promise.all([
      this.redis.mget(...robotIds.map((id) => `robot:heartbeat:${id}`)),
      this.redis.mget(...robotIds.map((id) => `robot:telemetry:${id}:latest`)),
    ]);

    return {
      heartbeats: new Map<string, number | null>(
        robotIds.map((robotId, index) => {
          const raw = heartbeatRaw[index];
          const parsed = raw ? Number(raw) : NaN;
          return [robotId, Number.isFinite(parsed) ? parsed : null];
        }),
      ),
      telemetry: new Map<string, Record<string, unknown> | null>(
        robotIds.map((robotId, index) => {
          const raw = telemetryRaw[index];
          if (!raw) {
            return [robotId, null];
          }

          try {
            return [robotId, JSON.parse(raw) as Record<string, unknown>];
          } catch {
            return [robotId, null];
          }
        }),
      ),
    };
  }
}
