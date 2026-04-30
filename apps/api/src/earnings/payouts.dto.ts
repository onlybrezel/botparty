import { IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { LIMITS } from '@botparty/shared';

export class CreatePayoutRequestDto {
  @IsInt()
  @Min(LIMITS.MIN_PAYOUT_REQUEST_CREDITS)
  @Max(LIMITS.MAX_PAYOUT_REQUEST_CREDITS)
  amount!: number;

  @IsString()
  @MaxLength(128)
  destination!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectPayoutDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
