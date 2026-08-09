import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { LivekitService } from '../livekit/livekit.service';
import { RobotsService } from './robots.service';
import { extractBearerToken } from '../auth/auth.cookies';
import type {
  ClaimRobotDto,
  EnqueueActionDto,
  IngestRobotLogsDto,
  PushTelemetryDto,
} from './robots.dto';

@Injectable()
export class RobotRuntimeService {
  constructor(
    private readonly robotsService: RobotsService,
    private readonly livekitService: LivekitService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async claim(body: ClaimRobotDto) {
    const robot = await this.robotsService.findByClaimToken(body.claimToken.trim());
    if (!robot) {
      throw new UnauthorizedException('Invalid claim token');
    }

    const { deviceHash } = await this.robotsService.validateOrBindRobotDevice(robot.id, body.deviceKey);
    const robotJwtOptions: JwtSignOptions = {
      secret: this.getRobotJwtSecret(),
      expiresIn: '15m',
    };
    const configuredRobotExpiry = this.configService.get<string>('ROBOT_JWT_EXPIRES_IN')?.trim();
    if (configuredRobotExpiry) {
      const match = /^(\d+)([smhd])$/.exec(configuredRobotExpiry);
      if (match) {
        const amount = Number(match[1]);
        const multiplier = match[2] === 'd'
          ? 86_400
          : match[2] === 'h'
            ? 3_600
            : match[2] === 'm'
              ? 60
              : 1;
        robotJwtOptions.expiresIn = amount * multiplier;
      }
    }

    const robotAuthToken = this.jwtService.sign(
      {
        sub: robot.id,
        scope: 'robot',
        deviceHash,
        tokenVersion: robot.deviceTokenVersion,
      },
      robotJwtOptions,
    );

    const token = await this.livekitService.generateRobotToken(robot.id, robot.name);
    const publishCameraIds = Array.isArray(body.publishCameraIds)
      ? body.publishCameraIds
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
      : [];
    const publishTokens = publishCameraIds.length
      ? await this.livekitService.generateRobotPublisherTokens(robot.id, robot.name, publishCameraIds)
      : {};
    const stream = await this.robotsService.getStreamPolicy(robot.id);
    const ingress = await this.livekitService.ensureRobotWhipIngress(robot.id, robot.name);

    return {
      robotId: robot.id,
      token,
      robotAuthToken,
      publishTokens,
      livekitUrl: this.livekitService.getLivekitUrl(),
      ingress,
      stream,
    };
  }

  async heartbeat(authorization?: string) {
    const robotId = await this.requireRobotAuth(authorization);
    await this.robotsService.touchHeartbeat(robotId);
    return { ok: true };
  }

  async enqueueAction(robotId: string, ownerId: string, body: EnqueueActionDto) {
    if (body.type !== 'set_log_stream' && body.durationSec !== undefined) {
      throw new BadRequestException('durationSec is only supported for set_log_stream');
    }
    if (
      body.type === 'set_log_stream' &&
      body.durationSec !== undefined &&
      (body.durationSec < 10 || body.durationSec > 900)
    ) {
      throw new BadRequestException('durationSec must be between 10 and 900');
    }

    return this.robotsService.enqueueAction(robotId, ownerId, {
      type: body.type,
      durationSec: body.durationSec,
    });
  }

  async getPendingActions(robotId: string, ownerId: string) {
    return this.robotsService.getPendingActions(robotId, ownerId);
  }

  async pollActions(authorization?: string) {
    return this.robotsService.consumeActionsByRobotId(await this.requireRobotAuth(authorization));
  }

  async pushLogs(authorization: string | undefined, body: IngestRobotLogsDto) {
    return this.robotsService.ingestRobotLogsByRobotId(await this.requireRobotAuth(authorization), body.lines);
  }

  async pushTelemetry(authorization: string | undefined, body: PushTelemetryDto) {
    return this.robotsService.ingestRobotTelemetryByRobotId(await this.requireRobotAuth(authorization), body);
  }

  async getLogs(robotId: string, ownerId: string) {
    const logs = await this.robotsService.getRobotLogs(robotId, ownerId);
    return { logs };
  }

  async getTelemetry(robotId: string, ownerId: string) {
    return this.robotsService.getRobotTelemetry(robotId, ownerId);
  }

  private async requireRobotAuth(authorization?: string): Promise<string> {
    const token = extractBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException('Robot authorization required');
    }

    try {
      const payload = this.jwtService.verify<{ sub?: string; scope?: string; deviceHash?: string; tokenVersion?: number }>(token, {
        secret: this.getRobotJwtSecret(),
      });
      if (payload.scope !== 'robot' || typeof payload.sub !== 'string' || !payload.sub.trim()) {
        throw new UnauthorizedException('Invalid robot authorization');
      }
      if (typeof payload.deviceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.deviceHash)) {
        throw new UnauthorizedException('Invalid robot authorization');
      }
      if (
        typeof payload.tokenVersion !== 'number'
        || !Number.isInteger(payload.tokenVersion)
        || !(await this.robotsService.validateRobotAuth(payload.sub, payload.deviceHash, payload.tokenVersion))
      ) {
        throw new UnauthorizedException('Robot authorization has been revoked');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid robot authorization');
    }
  }

  private getRobotJwtSecret() {
    return this.configService.getOrThrow<string>('ROBOT_JWT_SECRET');
  }
}
