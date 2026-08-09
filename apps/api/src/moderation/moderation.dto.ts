import { IsString, IsOptional, IsEnum, IsInt, Max, Min, MaxLength } from 'class-validator';
import { ModerationActionType } from '@botparty/shared';

export class ModerateUserDto {
  @IsString()
  @MaxLength(128)
  declare targetUserId: string;

  @IsEnum(ModerationActionType)
  declare action: ModerationActionType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Duration in seconds. Required for TIMEOUT, ignored for BAN/KICK/WARN */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  durationSec?: number;
}
