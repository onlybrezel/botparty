// Shared API response and request types for the BotParty web client.
// Imported by api.ts (ApiClient) and can be used directly in components for typed state.
import type { RobotPublic, RobotStreamCameraConfig, RobotTelemetryPoint, UserPublic } from '@botparty/shared';

export type {
  ActiveSessionRecord,
  AdminRecordingFile,
  AdminRobotRecordingStatus,
  AllowedUserRecord,
  ControlButtonRecord,
  PlatformStats,
  RobotCameraIngress,
  RobotTelemetryPoint,
  RoomAccessGrant,
} from '@botparty/shared';

export interface RobotManaged extends RobotPublic {
  claimToken: string;
  inviteCode: string | null;
  streamKey: string;
  metadata: {
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
  } | null;
  accessPassword: string | null;
  livekitRoom: string | null;
  isFeatured: boolean;
  recordSessions: boolean;
  aiAssistEnabled: boolean;
  ros2Enabled: boolean;
  updatedAt: string;
}

export interface RobotWebhookRecord {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
  lastStatusCode: number | null;
  createdAt: string;
  secretPreview: string;
}

export interface RobotWebhookCreateResponse extends RobotWebhookRecord {
  secret: string;
}

export interface UserSessionRecord {
  id: string;
  status: 'ACTIVE' | 'ENDED' | 'RECORDING';
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  recordingUrl: string | null;
  peakViewers: number;
  totalCommands: number;
  avgLatencyMs: number | null;
  robot: {
    id: string;
    name: string;
    slug: string;
    thumbnailUrl: string | null;
  };
}

export interface UserSessionDetail extends UserSessionRecord {
  metadata: Record<string, unknown> | null;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  robot: UserSessionRecord['robot'] & {
    owner: {
      id: string;
      username: string;
      displayName: string | null;
    };
  };
  replayCandidates: Array<{
    fileName: string;
    sizeBytes: number;
    modifiedAt: string;
    robotId: string | null;
    cameraId: string | null;
    recordedAt: string | null;
    playbackPath: string;
    playbackExpiresAt: string;
  }>;
}

export interface RobotMutationInput {
  name?: string;
  slug?: string;
  description?: string;
  thumbnailUrl?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  accessMode?: 'OPEN' | 'PASSWORD' | 'LINK_ONLY' | 'ALLOWED_USERS';
  queueMode?: 'FIRST_COME' | 'VOTING' | 'DISABLED';
  maxTurnTime?: number;
  maxViewers?: number;
  maxControllers?: number;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  timezone?: string;
  tags?: string[];
  acl?: {
    video: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    control: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    chat: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
    estop: 'ALL' | 'AUTHENTICATED' | 'DISABLED';
  };
  stream?: {
    targetBitrateKbps?: number;
    activeCameraId?: string;
    cameras?: RobotStreamCameraConfig[];
  };
  accessPassword?: string;
}

export interface RobotChatHistoryPage {
  messages: Array<{
    id?: string;
    userId: string;
    username: string;
    content: string;
    timestamp: number;
  }>;
  nextCursor: number | null;
  nextCursorId?: string | null;
  hasMore: boolean;
}

export interface ModRuntimeOverview {
  generatedAt: string;
  summary: {
    totalRobots: number;
    onlineRobots: number;
    busyRobots: number;
    offlineRobots: number;
    maintenanceRobots: number;
    totalViewers: number;
    queuedUsers: number;
    activeSessions: number;
    telemetryFreshRobots: number;
    controlConnectedRobots: number;
    livekitConnectedRobots: number;
    avgCpuPercent: number | null;
    avgMemoryPercent: number | null;
    totalIngressKbps: number;
    totalEgressKbps: number;
  };
  platform: {
    available: boolean;
    error: string | null;
    host: {
      cpuCores: number | null;
      memoryBytes: number | null;
      cpuPercent: number | null;
      memoryUsageBytes: number | null;
      memoryPercent: number | null;
      rxKbps: number | null;
      txKbps: number | null;
    } | null;
    containers: Array<{
      service: string;
      containerName: string | null;
      cpuPercent: number | null;
      memoryUsageBytes: number | null;
      memoryLimitBytes: number | null;
      memoryPercent: number | null;
      rxKbps: number | null;
      txKbps: number | null;
    }>;
  };
  livekit: {
    available: boolean;
    error: string | null;
    totals: {
      rooms: number;
      participants: number;
      publishers: number;
      subscribers: number;
      estimatedIngressKbps: number;
    };
    rooms: Array<{
      roomName: string;
      robotId: string | null;
      sid: string;
      participants: number;
      publishers: number;
      subscribers: number;
      activeRecording: boolean;
      createdAt: string | null;
      estimatedIngressKbps: number;
      participantNames: string[];
      participantDetails: Array<{
        identity: string;
        name: string;
        isPublisher: boolean;
        joinedAt: string | null;
        trackCount: number;
      }>;
    }>;
  };
  robots: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTENANCE';
    visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
    queueMode: 'FIRST_COME' | 'VOTING' | 'DISABLED';
    viewerCount: number;
    lastOnlineAt: string | null;
    heartbeatAgeSec: number | null;
    telemetryAgeSec: number | null;
    queueLength: number;
    queueHead: {
      id: string;
      username: string;
      displayName: string | null;
    } | null;
    activeSession: {
      id: string;
      startedAt: string;
      user: {
        id: string;
        username: string;
        displayName: string | null;
      };
    } | null;
    owner: {
      id: string;
      username: string;
      displayName: string | null;
    };
    telemetry: RobotTelemetryPoint | null;
    livekit: {
      roomName: string;
      robotId: string | null;
      sid: string;
      participants: number;
      publishers: number;
      subscribers: number;
      activeRecording: boolean;
      createdAt: string | null;
      estimatedIngressKbps: number;
      participantNames: string[];
      participantDetails: Array<{
        identity: string;
        name: string;
        isPublisher: boolean;
        joinedAt: string | null;
        trackCount: number;
      }>;
    } | null;
  }>;
}

// Re-export shared types that are used alongside API types in components
export type { UserPublic };
