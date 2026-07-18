import type WebSocket from 'ws';

export interface WsClient extends WebSocket {
  id: string;
  userId?: string;
  username?: string;
  authAccessToken?: string;
  protocolVersion?: number;
  isGuest?: boolean;
  /** Which robot room this client is subscribed to */
  watchingRobotId?: string;
  /** True if this socket is the robot hardware client */
  isRobot?: boolean;
  robotId?: string;
  /** Timestamp of last chat message (for rate limiting) */
  lastChatAt?: number;
  /** User role (for rate-limit tier) */
  role?: string;
  remoteIp?: string;
  cookieHeader?: string;
  presenceJoinedAt?: number;
  /** Per-client generic event rate limiting */
  wsEventCount?: number;
  wsEventWindowStart?: number;
  wsEventTypeCounts?: Record<string, number>;
}

/** Lightweight presence record broadcast to the room */
export interface PresenceRecord {
  userId: string;
  username: string;
  joinedAt: number;
}

export interface ActiveTurnState {
  sessionId: string;
  userId: string;
  startedAt: number;
  expiresAt: number;
  ownerId: string;
  fencingToken: number;
  leaseExpiresAt: number;
}

export interface CommandMetadata {
  user: {
    id: string | null;
    username: string | null;
    role: string | null;
    isGuest: boolean;
    isRobotOwner: boolean;
    isSiteAdmin: boolean;
    isSiteModerator: boolean;
  };
  robotId: string;
  source: 'gateway' | 'system';
}

export interface SharedPresenceSnapshot {
  viewerCount: number;
  focusUserConnections: number;
  presenceList: PresenceRecord[];
  cleanedStaleEntries: boolean;
}
