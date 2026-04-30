import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { LIMITS } from '@botparty/shared';

export class DonationDto {
  @IsUUID()
  robotId!: string;

  @IsInt()
  @Min(LIMITS.MIN_DONATION_CREDITS)
  @Max(LIMITS.MAX_DONATION_CREDITS)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}

export class AdminAdjustDto {
  @IsInt()
  delta!: number;

  @IsString()
  @MaxLength(255)
  reason!: string;
}

export class ListTransactionsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  type?: string;
}
