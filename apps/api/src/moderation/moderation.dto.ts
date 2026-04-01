import { IsString, IsOptional, IsEnum, IsInt, Max, Min } from 'class-validator';
import { ModerationActionType } from '@botparty/shared';

export class ModerateUserDto {
  @IsString()
  targetUserId!: string;

  @IsEnum(ModerationActionType)
  action!: ModerationActionType;

  @IsOptional()
  @IsString()
  reason?: string;

  /** Duration in seconds. Required for TIMEOUT, ignored for BAN/KICK/WARN */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  durationSec?: number;
}
