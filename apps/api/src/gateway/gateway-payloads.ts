import { LIMITS, WS_MIN_SUPPORTED_PROTOCOL_VERSION } from '@botparty/shared';
import { z } from 'zod';

export const roomJoinSchema = z.object({
  robotId: z.string().uuid(),
  accessToken: z.string().min(1).optional(),
  protocolVersion: z.number().int().min(WS_MIN_SUPPORTED_PROTOCOL_VERSION).max(1024).default(WS_MIN_SUPPORTED_PROTOCOL_VERSION),
  guestSessionId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/).optional(),
  roomAccessToken: z.string().min(1).max(1024).optional(),
}).strict();

export const roomPingSchema = z.object({
  robotId: z.string().uuid(),
}).strict();

export const robotClaimSchema = z.object({
  robotAuthToken: z.string().min(1),
  protocolVersion: z.number().int().min(WS_MIN_SUPPORTED_PROTOCOL_VERSION).max(1024).default(WS_MIN_SUPPORTED_PROTOCOL_VERSION),
}).strict();

export const robotTelemetrySchema = z.object({
  clientVersion: z.string().max(64).optional(),
  gitBranch: z.string().max(128).optional(),
  gitCommit: z.string().max(64).optional(),
  gitDirty: z.boolean().optional(),
  botpartyStreamerVersion: z.string().max(64).optional(),
  streamerVersion: z.string().max(64).optional(),
  pythonVersion: z.string().max(64).optional(),
  cpuPercent: z.number().finite().optional(),
  memoryPercent: z.number().finite().optional(),
  temperatureC: z.number().finite().optional(),
  uptimeSec: z.number().finite().optional(),
  controlConnected: z.boolean().optional(),
  livekitConnected: z.boolean().optional(),
  commandsReceived: z.number().finite().optional(),
  cameraFrames: z.number().finite().optional(),
  emergencyStopVerified: z.boolean().optional(),
}).strict();

export const emergencyStopSchema = z.object({
  robotId: z.string().uuid(),
}).strict();

export const emptyPayloadSchema = z.undefined().or(z.object({}).strict());

export const WS_EVENT_TYPE_LIMITS: Record<string, { normal: number; privileged: number }> = {
  generic: { normal: LIMITS.WS_EVENT_RATE_LIMIT, privileged: LIMITS.WS_EVENT_RATE_LIMIT_ADMIN },
  'room:join': { normal: 5, privileged: 10 },
  'room:ping': { normal: 8, privileged: 16 },
  'robot:claim': { normal: 2, privileged: 4 },
  'robot:heartbeat': { normal: 6, privileged: 12 },
  'robot:telemetry': { normal: 4, privileged: 8 },
  robotActionsPull: { normal: 4, privileged: 8 },
  control: { normal: 30, privileged: 45 },
  estop: { normal: 4, privileged: 8 },
  chat: { normal: 6, privileged: 12 },
};
