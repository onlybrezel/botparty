import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayNotEmpty,
  IsIn,
  IsUrl,
  MaxLength,
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
