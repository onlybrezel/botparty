import { IsString, MaxLength } from 'class-validator';

export class RejectPayoutDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class MarkPaidPayoutDto {
  @IsString()
  @MaxLength(192)
  providerRef!: string;
}
