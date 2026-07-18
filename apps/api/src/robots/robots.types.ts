export type GuestAccess = 'ALL' | 'AUTHENTICATED' | 'DISABLED';

export interface RobotAccessPolicy {
  video: GuestAccess;
  control: GuestAccess;
  chat: GuestAccess;
  estop: GuestAccess;
}

export interface RobotStreamCameraDescriptor {
  id: string;
  label?: string;
  role?: string;
  enabled?: boolean;
  publishMode?: string;
}

export interface RobotStreamPolicy {
  targetBitrateKbps: number | null;
  activeCameraId?: string;
  cameras?: RobotStreamCameraDescriptor[];
}

export interface RoomAccessGrant {
  token: string;
  expiresAt: string;
}

export interface ChatHistoryMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
}

export interface ChatHistoryPage {
  messages: ChatHistoryMessage[];
  nextCursor: number | null;
  nextCursorId: string | null;
  hasMore: boolean;
}

export interface AllowedUserSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  addedAt: string;
}

export type RobotActionType =
  | 'restart_video'
  | 'restart_control'
  | 'restart_chat'
  | 'update_client'
  | 'set_log_stream';

export interface RobotActionPayload {
  type: RobotActionType;
  durationSec?: number;
}
