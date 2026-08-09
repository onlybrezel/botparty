import type WebSocket from 'ws';

export interface WsClient extends Pick<WebSocket, 'close' | 'ping' | 'readyState' | 'send'> {
  id: string;
  userId?: string | undefined;
  username?: string | undefined;
  authAccessToken?: string | undefined;
  protocolVersion?: number | undefined;
  isGuest?: boolean | undefined;
  /** Which robot room this client is subscribed to */
  watchingRobotId?: string | undefined;
  /** True if this socket is the robot hardware client */
  isRobot?: boolean | undefined;
  robotId?: string | undefined;
  /** Timestamp of last chat message (for rate limiting) */
  lastChatAt?: number | undefined;
  /** User role (for rate-limit tier) */
  role?: string | undefined;
  remoteIp?: string | undefined;
  cookieHeader?: string | undefined;
  presenceJoinedAt?: number | undefined;
  /** Per-client generic event rate limiting */
  wsEventCount?: number | undefined;
  wsEventWindowStart?: number | undefined;
  wsEventTypeCounts?: Record<string, number> | undefined;
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
