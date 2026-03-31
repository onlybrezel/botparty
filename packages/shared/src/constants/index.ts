// ─── User Roles ──────────────────────────────────────
export enum Role {
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  CREATOR = 'CREATOR',
  USER = 'USER',
}

// ─── Robot Visibility ────────────────────────────────
export enum RobotVisibility {
  PUBLIC = 'PUBLIC',
  UNLISTED = 'UNLISTED',
  PRIVATE = 'PRIVATE',
}

// ─── Robot Access Mode ───────────────────────────────
export enum RobotAccessMode {
  OPEN = 'OPEN',
  PASSWORD = 'PASSWORD',
  LINK_ONLY = 'LINK_ONLY',
  ALLOWED_USERS = 'ALLOWED_USERS',
}

// ─── Queue Mode ──────────────────────────────────────
export enum QueueMode {
  FIRST_COME = 'FIRST_COME',
  VOTING = 'VOTING',
  DISABLED = 'DISABLED',
}

// ─── Robot Status ────────────────────────────────────
export enum RobotStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  BUSY = 'BUSY',
  MAINTENANCE = 'MAINTENANCE',
}

// ─── Transaction Type ────────────────────────────────
export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  PRIORITY_QUEUE = 'PRIORITY_QUEUE',
  FEATURED_ROBOT = 'FEATURED_ROBOT',
  BATTLE_ENTRY = 'BATTLE_ENTRY',
  REWARD = 'REWARD',
}

// ─── Session Status ──────────────────────────────────
export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  RECORDING = 'RECORDING',
}

// ─── Control Input Types ─────────────────────────────
export enum ControlInputType {
  KEYBOARD = 'KEYBOARD',
  JOYSTICK = 'JOYSTICK',
  GAMEPAD = 'GAMEPAD',
  TOUCH = 'TOUCH',
  CUSTOM = 'CUSTOM',
}

// ─── WebSocket Events ────────────────────────────────
export const WS_EVENTS = {
  // Robot
  ROBOT_STATUS: 'robot:status',
  ROBOT_CLAIM: 'robot:claim',
  ROBOT_HEARTBEAT: 'robot:heartbeat',

  // Control
  CONTROL_COMMAND: 'control:command',
  CONTROL_EMERGENCY_STOP: 'control:emergency-stop',
  CONTROL_LATENCY_WARNING: 'control:latency-warning',

  // Queue
  QUEUE_JOIN: 'queue:join',
  QUEUE_LEAVE: 'queue:leave',
  QUEUE_UPDATE: 'queue:update',
  QUEUE_TURN_START: 'queue:turn-start',
  QUEUE_TURN_END: 'queue:turn-end',
  QUEUE_VOTE: 'queue:vote',

  // Chat
  CHAT_MESSAGE: 'chat:message',
  CHAT_SYSTEM: 'chat:system',

  // Session
  SESSION_START: 'session:start',
  SESSION_END: 'session:end',

  // Signaling
  SIGNAL_OFFER: 'signal:offer',
  SIGNAL_ANSWER: 'signal:answer',
  SIGNAL_ICE: 'signal:ice',
} as const;

// ─── Control Command Names ───────────────────────────
export const CONTROL_COMMANDS = {
  FORWARD: 'forward',
  BACKWARD: 'backward',
  LEFT: 'left',
  RIGHT: 'right',
  STOP: 'stop',
  CAMERA_UP: 'camera_up',
  CAMERA_DOWN: 'camera_down',
  ACTION_1: 'action_1',
  ACTION_2: 'action_2',
  ACTION_3: 'action_3',
  CUSTOM: 'custom',
} as const;

// ─── Limits ──────────────────────────────────────────
export const LIMITS = {
  MAX_TURN_TIME_MS: 300_000, // 5 min
  MIN_TURN_TIME_MS: 10_000,  // 10 sec
  DEFAULT_TURN_TIME_MS: 60_000, // 1 min
  MAX_VIEWERS: 10_000,
  MAX_CONTROLLERS: 50,
  LATENCY_WARNING_MS: 200,
  LATENCY_EMERGENCY_STOP_MS: 300,
  MAX_CHAT_MESSAGE_LENGTH: 500,
  MAX_ROBOT_NAME_LENGTH: 64,
  MAX_ROBOT_DESCRIPTION_LENGTH: 2000,
  MAX_TAGS: 10,
  MAX_TAG_LENGTH: 32,
} as const;
