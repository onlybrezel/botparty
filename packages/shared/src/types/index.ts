import type { z } from 'zod';
import type {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createRobotSchema,
  updateRobotSchema,
  controlCommandSchema,
  chatMessageSchema,
  queueJoinSchema,
  donationRequestSchema,
  checkoutRequestSchema,
  subscriptionCheckoutRequestSchema,
  payoutRequestSchema,
} from '../schemas/index.js';
import type { Role, RobotVisibility, RobotAccessMode, QueueMode, RobotStatus, ControlButtonAccess, TransactionType } from '../constants/index.js';

// ─── Auth ────────────────────────────────────────────
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─── Robot ───────────────────────────────────────────
export type CreateRobotInput = z.infer<typeof createRobotSchema>;
export type UpdateRobotInput = z.infer<typeof updateRobotSchema>;

// ─── Control ─────────────────────────────────────────
export type ControlCommand = z.infer<typeof controlCommandSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type QueueJoinInput = z.infer<typeof queueJoinSchema>;

// ─── Wallet & Billing ────────────────────────────────
export type DonationRequest = z.infer<typeof donationRequestSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type SubscriptionCheckoutRequest = z.infer<typeof subscriptionCheckoutRequestSchema>;
export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;

export interface WalletTransactionRecord {
  id: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  description: string | null;
  ledgerGroupId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface WalletSummary {
  balance: number;
  recentTransactions: WalletTransactionRecord[];
}

export interface WsWalletUpdatePayload {
  balance: number;
  delta: number;
  type: TransactionType;
  ledgerGroupId: string | null;
}

export interface WsInsufficientFundsPayload {
  required: number;
  balance: number;
  reason: string;
}

export interface CreditPackage {
  id: string;
  label: string;
  credits: number;
  amountCents: number;
  currency: string;
  bonus?: number;
}

export interface RecurringSubscriptionPlan {
  id: string;
  label: string;
  description: string | null;
  credits: number;
  amountCents: number;
  currency: string;
  bonus?: number;
  interval: 'month';
  intervalCount: number;
  supportedProviders: Array<'stripe'>;
}

export interface CheckoutResponse {
  provider: 'stripe' | 'paypal';
  intentId: string;
  redirectUrl: string;
  expiresAt: string;
}

export interface PayoutRequestRecord {
  id: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  destination: string;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
}

export interface CreatorEarningsSummary {
  totalEarnedCredits: number;
  donationsCredits: number;
  buttonPayoutCredits: number;
  pendingPayoutHoldCredits: number;
  availableForPayoutCredits: number;
  byRobot: Array<{
    robotId: string;
    robotName: string;
    earned: number;
    donations: number;
    buttonPayouts: number;
  }>;
}

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

export interface RobotStreamCameraConfig {
  id: string;
  label?: string;
  role?: 'primary' | 'secondary' | 'rear' | 'arm' | 'dock' | string;
  enabled?: boolean;
  publishMode?: 'always_on' | 'preview_only' | 'on_demand' | string;
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
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  timezone?: string;
  maxTurnTime: number;
  maxViewers: number;
  maxControllers: number;
  metadata?: {
    access?: {
      video?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      control?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      chat?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
      estop?: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    };
    stream?: {
      targetBitrateKbps?: number;
      activeCameraId?: string;
      cameras?: RobotStreamCameraConfig[];
    };
    recording?: {
      enabled?: boolean;
    };
  } | null;
  tags: string[];
  viewerCount: number;
  owner: UserPublic;
  createdAt: string;
}

export interface PublicRobotOverview {
  totals: {
    publicRobots: number;
    liveRobots: number;
    featuredRobots: number;
    totalViewers: number;
    queueEntries: number;
  };
  statusBreakdown: {
    online: number;
    busy: number;
    offline: number;
    maintenance: number;
  };
  featured: Array<{
    id: string;
    name: string;
    slug: string;
    status: RobotStatus;
    viewerCount: number;
    tags: string[];
    owner: Pick<UserPublic, 'username' | 'displayName'>;
  }>;
  liveNow: Array<{
    id: string;
    name: string;
    slug: string;
    status: RobotStatus;
    viewerCount: number;
    queueMode: QueueMode;
    tags: string[];
    owner: Pick<UserPublic, 'username' | 'displayName'>;
  }>;
  topTags: Array<{
    tag: string;
    count: number;
  }>;
}

// ─── Token Payloads ──────────────────────────────────
export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
  jti: string;
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

// ─── WebSocket Event Payloads ─────────────────────────
// These are the data shapes sent/received over the WebSocket gateway.
// Both API gateway and frontend consumers should use these types.

export interface WsPresenceUser {
  userId: string;
  username: string;
  displayName: string | null;
}

export interface WsPresenceJoinPayload {
  userId: string;
  username: string;
  displayName: string | null;
}

export interface WsPresenceUpdatePayload {
  viewers: WsPresenceUser[];
}

export interface WsQueueEntry {
  userId: string;
  username: string;
  displayName: string | null;
  position: number;
  joinedAt: string;
  votes?: number;
}

export interface WsQueueUpdatePayload {
  queue: WsQueueEntry[];
}

export interface WsQueueTurnStartPayload {
  userId: string;
  durationSec: number;
  expiresAt: string;
}

export interface WsRobotStatusPayload {
  status: RobotStatus;
}

export interface WsChatMessagePayload {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  content: string;
  ts: number;
  isStaff?: boolean;
  isMod?: boolean;
}

export interface WsModActionPayload {
  action: 'TIMEOUT' | 'KICK' | 'BAN' | 'UNBAN' | 'WARN';
  targetUserId: string;
  reason?: string;
  durationSec?: number;
  expiresAt?: string;
  moderatorUsername?: string;
}

export interface WsSessionStartPayload {
  userId: string;
  username: string;
  displayName: string | null;
  expiresAt: string;
}

export interface WsCrowdInputPayload {
  command: string;
  userId: string;
  username: string;
}

export interface WsControlLatencyWarningPayload {
  rttMs: number;
}

export interface WsChatSystemPayload {
  message: string;
  level?: 'info' | 'warning' | 'error';
}

  // ─── API Response Types ──────────────────────────────
  // Canonical response shapes shared between API and web.

  export interface PlatformStats {
    totalUsers: number;
    totalRobots: number;
    liveRobots: number;
    totalLiveViewers: number;
    activeQueueEntries: number;
    totalSessions: number;
    timestamp: string;
  }

  export interface RobotTelemetryPoint {
    ts: number;
    clientVersion: string | null;
    botpartyStreamerVersion?: string | null;
    gitBranch: string | null;
    gitCommit: string | null;
    gitDirty: boolean;
    pythonVersion: string | null;
    cpuPercent: number | null;
    memoryPercent: number | null;
    temperatureC: number | null;
    uptimeSec: number | null;
    controlConnected: boolean;
    livekitConnected: boolean;
    commandsReceived: number;
    cameraFrames: number;
  }

  export interface RobotCameraIngress {
    type: 'WHIP';
    ingressId: string;
    url: string;
    streamKey: string;
    endpointUrl: string;
    participantIdentity?: string;
    participantName?: string;
    enableTranscoding: boolean;
    cameraId: string | null;
    isLive: boolean;
  }

  export interface RoomAccessGrant {
    token: string;
    expiresAt: string;
  }

  export interface ActiveSessionRecord {
    id: string;
    startedAt: string;
    endedAt?: string | null;
    user: Pick<UserPublic, 'id' | 'username' | 'displayName'>;
  }

  export interface AllowedUserRecord {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    addedAt: string;
  }

  export interface ControlButtonRecord {
    id: string;
    label: string;
    command: string;
    hotKey: string | null;
    icon: string | null;
    cooldownMs: number;
    costCredits: number;
    access: ControlButtonAccess;
    position: number;
    color: string | null;
    isEnabled?: boolean;
  }

  export interface AdminRecordingFile {
    fileName: string;
    sizeBytes: number;
    modifiedAt: string;
    robotId: string | null;
    cameraId?: string | null;
    recordedAt?: string | null;
    playbackPath?: string;
    playbackExpiresAt?: string;
  }

  export interface AdminRobotRecordingStatus {
    roomName: string;
    active: boolean;
    activeCount: number;
    egressId: string | null;
    startedAt: string | null;
    sessions: Array<{
      egressId: string;
      cameraId: string | null;
      videoTrackId: string | null;
      audioTrackId: string | null;
      startedAt: string | null;
    }>;
    updatedAt: string;
  }
