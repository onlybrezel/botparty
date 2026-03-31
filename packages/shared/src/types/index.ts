import type { z } from 'zod';
import type {
  loginSchema,
  registerSchema,
  createRobotSchema,
  updateRobotSchema,
  controlCommandSchema,
  chatMessageSchema,
  queueJoinSchema,
} from '../schemas/index.js';
import type { Role, RobotVisibility, RobotAccessMode, QueueMode, RobotStatus } from '../constants/index.js';

// ─── Auth ────────────────────────────────────────────
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

// ─── Robot ───────────────────────────────────────────
export type CreateRobotInput = z.infer<typeof createRobotSchema>;
export type UpdateRobotInput = z.infer<typeof updateRobotSchema>;

// ─── Control ─────────────────────────────────────────
export type ControlCommand = z.infer<typeof controlCommandSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type QueueJoinInput = z.infer<typeof queueJoinSchema>;

// ─── API Response ────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ─── User ────────────────────────────────────────────
export interface UserPublic {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  createdAt: string;
}

// ─── Robot Public ────────────────────────────────────
export interface RobotPublic {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  status: RobotStatus;
  visibility: RobotVisibility;
  accessMode: RobotAccessMode;
  queueMode: QueueMode;
  maxTurnTime: number;
  maxViewers: number;
  maxControllers: number;
  tags: string[];
  viewerCount: number;
  owner: UserPublic;
  createdAt: string;
}

// ─── Token Payloads ──────────────────────────────────
export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
}

// ─── LiveKit ─────────────────────────────────────────
export interface LiveKitTokenRequest {
  robotId: string;
  identity: string;
  isPublisher: boolean;
}

// ─── Latency ─────────────────────────────────────────
export interface LatencyReport {
  robotId: string;
  userId: string;
  rttMs: number;
  timestamp: number;
}
