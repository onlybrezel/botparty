import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayNotEmpty,
  IsIn,
  IsUrl,
  MaxLength,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

const ROBOT_WEBHOOK_EVENTS = ['robot.online', 'robot.offline', 'session.started', 'session.ended'] as const;

export class UploadThumbnailDto {
  @IsString()
  dataUrl!: string;
}

export class AddAllowedUserDto {
  @IsString()
  @MaxLength(64)
  username!: string;
}

export class CreateIngressCameraDto {
  @IsString()
  @MaxLength(64)
  cameraId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @IsOptional()
  @IsBoolean()
  compatibilityMode?: boolean;
}

export class VerifyRobotAccessDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  guestSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  inviteCode?: string;
}

export class GetChatHistoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  before?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  beforeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  roomAccessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  guestSessionId?: string;
}

export class ClaimRobotDto {
  @IsString()
  claimToken!: string;

  @IsOptional()
  @IsString()
  deviceKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  publishCameraIds?: string[];
}

export class IngestRobotLogsDto {
  @IsArray()
  @IsString({ each: true })
  @MaxLength(4096, { each: true })
  lines!: string[];
}

const ROBOT_ACTION_TYPES = ['restart_video', 'restart_control', 'restart_chat', 'update_client', 'set_log_stream'] as const;

export class EnqueueActionDto {
  @IsIn(ROBOT_ACTION_TYPES)
  type!: (typeof ROBOT_ACTION_TYPES)[number];

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(900)
  durationSec?: number;
}

export class PushTelemetryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  gitBranch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  gitCommit?: string;

  @IsOptional()
  @IsBoolean()
  gitDirty?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  botpartyStreamerVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  streamerVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pythonVersion?: string;

  @IsOptional()
  @IsNumber()
  cpuPercent?: number;

  @IsOptional()
  @IsNumber()
  memoryPercent?: number;

  @IsOptional()
  @IsNumber()
  temperatureC?: number;

  @IsOptional()
  @IsNumber()
  uptimeSec?: number;

  @IsOptional()
  @IsBoolean()
  controlConnected?: boolean;

  @IsOptional()
  @IsBoolean()
  livekitConnected?: boolean;

  @IsOptional()
  @IsNumber()
  commandsReceived?: number;

  @IsOptional()
  @IsNumber()
  cameraFrames?: number;
}

export class CreateRobotWebhookDto {
  @IsUrl({ require_tld: false })
  @MaxLength(1024)
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(ROBOT_WEBHOOK_EVENTS, { each: true })
  events!: Array<(typeof ROBOT_WEBHOOK_EVENTS)[number]>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
