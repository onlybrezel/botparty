import type { RedisService } from '../redis/redis.service';

const ROBOT_CLAIM_TTL_MS = 45_000;

export class RobotClaimLockHandler {
  constructor(private readonly redis: RedisService) {}

  claimKey(robotId: string) {
    return `ws:robot-claim:${robotId}`;
  }

  async acquire(robotId: string, clientId: string): Promise<boolean> {
    const lockKey = this.claimKey(robotId);
    const existingOwner = await this.redis.get(lockKey);
    if (existingOwner === clientId) {
      await this.refresh(robotId, clientId);
      return true;
    }

    const acquired = await this.redis.set(lockKey, clientId, 'PX', ROBOT_CLAIM_TTL_MS, 'NX');
    return acquired === 'OK';
  }

  async refresh(robotId: string, clientId: string): Promise<void> {
    const lockKey = this.claimKey(robotId);
    await this.redis.eval(
      `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        end
        return 0
      `,
      1,
      lockKey,
      clientId,
      String(ROBOT_CLAIM_TTL_MS),
    );
  }

  async transfer(robotId: string, fromClientId: string, toClientId: string): Promise<boolean> {
    if (fromClientId === toClientId) {
      await this.refresh(robotId, toClientId);
      return true;
    }

    const lockKey = this.claimKey(robotId);
    const transferred = await this.redis.eval(
      `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          redis.call("set", KEYS[1], ARGV[2], "PX", ARGV[3])
          return 1
        end
        return 0
      `,
      1,
      lockKey,
      fromClientId,
      toClientId,
      String(ROBOT_CLAIM_TTL_MS),
    );

    return transferred === 1 || transferred === '1';
  }

  async release(robotId: string, clientId: string): Promise<void> {
    const lockKey = this.claimKey(robotId);
    await this.redis.eval(
      `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        end
        return 0
      `,
      1,
      lockKey,
      clientId,
    );
  }
}
