// ─── User Roles ──────────────────────────────────────
export enum Role {
  ADMIN = 'ADMIN',
  MOD = 'MOD',
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

// ─── Control Button Access Levels ────────────────────
export enum ControlButtonAccess {
  EVERYONE = 'EVERYONE',
  QUEUE_TURN = 'QUEUE_TURN', // Only the current controller
  MODERATOR = 'MODERATOR',
  OWNER = 'OWNER',
}

// ─── Moderation Action Types ─────────────────────────
export enum ModerationActionType {
  TIMEOUT = 'TIMEOUT',
  KICK = 'KICK',
  BAN = 'BAN',
  UNBAN = 'UNBAN',
  WARN = 'WARN',
}

// ─── WebSocket Events ────────────────────────────────
export const WS_EVENTS = {
  // Robot lifecycle
  ROBOT_STATUS: 'robot:status',
  ROBOT_CLAIM: 'robot:claim',
  ROBOT_HEARTBEAT: 'robot:heartbeat',
  ROBOT_TELEMETRY: 'robot:telemetry',
  ROBOT_CONTROLS_UPDATED: 'robot:controls-updated',
  ROBOT_ACTIONS_PULL: 'robot:actions:pull',

  // Control
  CONTROL_COMMAND: 'control:command',
  CONTROL_EMERGENCY_STOP: 'control:emergency-stop',
  CONTROL_LATENCY_WARNING: 'control:latency-warning',

  // Crowd presence (broadcast to all viewers)
  PRESENCE_JOIN: 'presence:join',       // User entered the room
  PRESENCE_LEAVE: 'presence:leave',     // User left the room
  PRESENCE_UPDATE: 'presence:update',   // Full viewer list snapshot
  CROWD_INPUT: 'crowd:input',           // Someone pressed a button (visual echo)

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

  // Moderation
  MOD_TIMEOUT: 'mod:timeout',           // Temporarily mute a user
  MOD_KICK: 'mod:kick',                 // Immediate control/queue removal without a lasting restriction
  MOD_BAN: 'mod:ban',                   // Permanent robot-level ban
  MOD_UNBAN: 'mod:unban',               // Lift ban
  MOD_ACTION_BROADCAST: 'mod:action',   // Notify room of mod action

  // Session
  SESSION_START: 'session:start',
  SESSION_END: 'session:end',

  // Server lifecycle
  SERVER_SHUTDOWN: 'server:shutdown',

  // Internal event bus (server-side only, not exposed to clients)
  INTERNAL_MOD_ACTION: 'internal:mod-action',
  INTERNAL_ALERT: 'internal:alert',

  // Signaling
  SIGNAL_OFFER: 'signal:offer',
  SIGNAL_ANSWER: 'signal:answer',
  SIGNAL_ICE: 'signal:ice',

  // Generic
  ERROR: 'error',
  ROOM_JOIN: 'room:join',
  ROBOT_ACTIONS: 'robot:actions',
} as const;

export const WS_PROTOCOL_VERSION = 1;
export const WS_MIN_SUPPORTED_PROTOCOL_VERSION = 1;

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
  MAX_TURN_TIME_MS: 300_000,    // 5 min
  MIN_TURN_TIME_MS: 10_000,     // 10 sec
  DEFAULT_TURN_TIME_MS: 60_000, // 1 min
  MAX_VIEWERS: 10_000,
  MAX_CONTROLLERS: 50,
  MAX_CONTROL_COMMAND_AGE_MS: 750,
  MAX_CONTROL_CLOCK_SKEW_MS: 10_000,
  LATENCY_WARNING_MS: 200,
  LATENCY_EMERGENCY_STOP_MS: 300,
  MAX_CHAT_MESSAGE_LENGTH: 300,  // Matching Remo convention
  MAX_ROBOT_NAME_LENGTH: 64,
  MAX_ROBOT_DESCRIPTION_LENGTH: 2000,
  MAX_TAGS: 10,
  MAX_TAG_LENGTH: 32,
  MAX_CONTROL_BUTTONS: 24,
  MIN_CONTROL_COOLDOWN_MS: 50,
  DEFAULT_CONTROL_COOLDOWN_MS: 200,
  CHAT_RATE_LIMIT_MS: 900,       // Minimum ms between chat messages (normal users)
  CHAT_RATE_LIMIT_ADMIN_MS: 250, // Admins & moderators
  CHAT_HISTORY_ON_JOIN: 25,      // Messages loaded on room join
  MOD_TIMEOUT_MAX_SEC: 3600,     // Max 1-hour timeout
  WS_EVENT_RATE_WINDOW_MS: 1000, // Sliding window for generic WS event rate limiting
  WS_EVENT_RATE_LIMIT: 30,       // Max events per window (normal users & guests)
  WS_EVENT_RATE_LIMIT_ADMIN: 60, // Max events per window (admin / mod / robot)
} as const;
